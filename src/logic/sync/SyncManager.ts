import { TFile, App } from 'obsidian';
import { GitServiceInterface, GitTreeEntry } from '../../services/git-service-interface';
import { GitLabFilesPushSettings, getServiceName } from '../../settings';
import {
    type PushResults,
    SyncPlan,
    SyncPlanEntry,
    isSyncPlanEmpty,
} from './types';
import { logger } from '../../utils/logger';
import { contentsEqual, isBinaryPath } from '../../utils/path';
import { gitBlobSha } from '../../utils/git-blob-sha';
import { SyncStatusService } from '../sync-status-service';
import { PushExecutor } from './PushExecutor';
import { PullExecutor } from './PullExecutor';
import { SyncMetadataStore } from './SyncMetadataStore';
import { SyncScanner } from './SyncScanner';
import { ConflictResolver } from './ConflictResolver';
import { SyncExecutor } from './SyncExecutor';
import { PullCoordinator } from './PullCoordinator';
import { PushCoordinator } from './PushCoordinator';
import { SyncPlanner } from './SyncPlanner';
import {
    HeadlessSyncInteraction,
    type SyncInteractionPort,
    type SyncPlanDirection,
} from './SyncInteractionPort';

export class SyncManager {
    private readonly app: App;
    private gitService: GitServiceInterface;
    private readonly settings: GitLabFilesPushSettings;
    private readonly onSaveSettings?: () => Promise<void>;
    private readonly isPathIgnored: (path: string) => boolean;
    private readonly executor: SyncExecutor;
    private readonly metadataStore: SyncMetadataStore;
    private readonly scanner: SyncScanner;
    private readonly pullCoordinator: PullCoordinator;
    private readonly pushCoordinator: PushCoordinator;
    private readonly planner = new SyncPlanner();
    private readonly interaction: SyncInteractionPort;
    readonly status: SyncStatusService;

    constructor(
        app: App,
        gitService: GitServiceInterface,
        settings: GitLabFilesPushSettings,
        onSaveSettings?: () => Promise<void>,
        isPathIgnored: (path: string) => boolean = () => false,
        status: SyncStatusService = new SyncStatusService(),
        interaction: SyncInteractionPort = new HeadlessSyncInteraction(),
    ) {
        this.app = app;
        this.gitService = gitService;
        this.settings = settings;
        this.onSaveSettings = onSaveSettings;
        this.isPathIgnored = isPathIgnored;
        this.status = status;
        this.interaction = interaction;
        this.metadataStore = new SyncMetadataStore(this.settings, () => this.saveSettings(), this.status);
        this.scanner = new SyncScanner(this.app, this.settings);
        const pushExecutor = new PushExecutor(
            () => this.gitService,
            () => this.settings.branch,
            path => this.getNormalizedPath(path),
            (path, sha) => this.updateMetadata(path, sha),
            () => this.serviceName,
            message => this.interaction.notify(message),
            oldPath => { delete this.settings.syncMetadata[oldPath]; },
        );
        const pullExecutor = new PullExecutor(
            this.app,
            this.settings,
            (path, sha) => this.updateMetadata(path, sha),
            () => this.serviceName,
            message => this.interaction.notify(message),
        );
        const conflictResolver = new ConflictResolver(() => this.gitService, () => this.settings.branch, pullExecutor);
        this.executor = new SyncExecutor(
            pushExecutor,
            pullExecutor,
            conflictResolver,
        );
        this.pullCoordinator = new PullCoordinator({
            gitService: () => this.gitService,
            settings: this.settings,
            scanner: this.scanner,
            executor: pullExecutor,
            confirmPlan: plan => this.confirmPlan(plan, 'pull'),
            updateMetadata: (path, sha) => this.updateMetadata(path, sha),
            migrateBaseline: (path, repoPath, entry) => this.migrateGitLabLegacyBaseline(path, repoPath, entry),
            saveSettings: () => this.saveSettings(),
            notify: (message, duration) => this.interaction.notify(message, duration),
            serviceName: () => this.serviceName,
        });
        this.pushCoordinator = new PushCoordinator({
            app: this.app,
            gitService: () => this.gitService,
            settings: this.settings,
            scanner: this.scanner,
            executor: pushExecutor,
            conflicts: conflictResolver,
            isPathIgnored: path => this.isPathIgnored(path),
            confirmPlan: plan => this.confirmPlan(plan, 'push'),
            resolveConflicts: (conflicts, totalFiles, safeCount) => (
                this.interaction.resolveBatchConflicts(this.gitService, conflicts, totalFiles, safeCount)
            ),
            updateMetadata: (path, sha) => this.updateMetadata(path, sha),
            migrateBaseline: (path, repoPath, entry) => this.migrateGitLabLegacyBaseline(path, repoPath, entry),
            saveSettings: () => this.saveSettings(),
            notify: (message, duration) => this.interaction.notify(message, duration),
            serviceName: () => this.serviceName,
        });
    }

    private get serviceName(): string {
        return getServiceName(this.settings);
    }

    public async updateMetadata(path: string, sha: string): Promise<void> {
        await this.metadataStore.update(path, sha);
    }

    /** Drop sync metadata for a path that's been deleted, so it can't be mistaken for a rename source later. */
    public async clearMetadata(path: string): Promise<void> {
        await this.metadataStore.clear(path);
    }

    /**
     * Records a vault 'rename' event so a later push recognizes it as a real
     * move — no content probing or remote lookup needed, Obsidian already
     * told us the exact old path. A file with no tracked metadata was never
     * synced, so there's nothing to carry forward: it's just a new file at a
     * new name.
     *
     * A chain of renames (A→B→C) collapses to a single pending move by always
     * recording the still-unpushed remote path, not the most recent hop; and
     * renaming back to that path (B→A) cancels the pending move entirely,
     * since the file is once again exactly what's on the remote.
     */
    public async trackRename(newPath: string, oldPath: string): Promise<void> {
        await this.metadataStore.trackRename(newPath, oldPath);
    }

    private getNormalizedPath(path: string): string {
        return this.scanner.toRepoPath(path);
    }

    updateGitService(gitService: GitServiceInterface): void {
        this.gitService = gitService;
    }

    /** A plan with exactly one entry, for a single-file push/pull's confirm step. */
    private singleEntryPlan(kind: 'addition' | 'modification', path: string, name: string): SyncPlan {
        const plan: SyncPlan = { additions: [], modifications: [], deletions: [], moves: [] };
        const entry: SyncPlanEntry = { path, name };
        (kind === 'addition' ? plan.additions : plan.modifications).push(entry);
        return plan;
    }

    /**
     * Shows the plan for review and resolves once the user confirms or
     * cancels. A plan with nothing to apply (e.g. every candidate file was
     * already in sync or skipped as a conflict) resolves immediately without
     * showing anything — there is nothing to review.
     */
    private confirmPlan(plan: SyncPlan, direction: SyncPlanDirection): Promise<boolean> {
        if (isSyncPlanEmpty(plan)) return Promise.resolve(true);
        return this.interaction.confirmPlan(plan, direction);
    }

    private async performPush(file: {path: string, name: string}, content: string | ArrayBuffer, existingSha?: string, existingRevision?: string, silent = false): Promise<string | undefined> {
        return this.executor.push.push(file, content, existingSha, existingRevision, silent);
    }

    /** The symlink target to recreate on pull, or undefined when the remote isn't a symlink. */
    private symlinkPullTarget(remote: { isSymlink?: boolean; symlinkTarget?: string }): string | undefined {
        return remote.isSymlink ? remote.symlinkTarget ?? '' : undefined;
    }

    async pullFile(fileOrPath: TFile | string) {
        const { path, name } = this.getFileInfo(fileOrPath);
        const repoPath = this.getNormalizedPath(path);

        try {
            const remote = await this.gitService.getFile(repoPath, this.settings.branch);
            if (!remote.sha) {
                this.interaction.notify(`File ${name} not found on remote.`);
                return;
            }

            const exists = await this.fileExists(fileOrPath);
            const localContent = exists ? await this.getFileContent(fileOrPath) : null;
            const lastSynced = this.settings.syncMetadata[path];
            const kind = isBinaryPath(path) ? 'binary' : 'text';
            const baseline = lastSynced?.lastSyncedSha === remote.revision ? remote.sha : lastSynced?.lastSyncedSha;
            let localSha: string | undefined;
            if (localContent !== null) {
                localSha = contentsEqual(localContent, remote.content) ? remote.sha : await gitBlobSha(localContent);
            }
            const decision = this.planner.planFor('pull', {
                local: {
                    path,
                    exists,
                    blobSha: localSha,
                    kind,
                },
                remote: { path, repoPath, exists: true, blobSha: remote.sha, kind },
                base: { blobSha: baseline },
            });

            if (decision.action === 'none') {
                await this.updateMetadata(path, remote.sha);
                this.interaction.notify(`${name} is already up to date.`);
                return;
            }

            if (decision.action === 'resolve-conflict') {
                this.interaction.openConflict(name, localContent ?? '', remote.content, (choice) => {
                    void (async () => {
                        try {
                            const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
                            if (choice === 'local') {
                                await this.performPush(fileRep, localContent || '', remote.sha, remote.revision);
                            } else {
                                await this.performPull(fileRep, remote.content, remote.sha, false, this.symlinkPullTarget(remote));
                            }
                        } catch (e) {
                            this.handleError(`Failed to resolve conflict for ${name}`, e);
                        }
                    })();
                });
                return;
            }

            const confirmed = await this.confirmPlan(this.singleEntryPlan(exists ? 'modification' : 'addition', path, name), 'pull');
            if (!confirmed) return;

            const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
            await this.performPull(fileRep, remote.content, remote.sha);
        } catch (e) {
            this.handleError(`Failed to pull ${name} from ${this.serviceName}`, e);
        }
    }

    private async performPull(file: TFile | {path: string, name: string}, remoteContent: string | ArrayBuffer, remoteSha: string, silent = false, symlinkTarget?: string) {
        await this.executor.pull.pull(file, remoteContent, remoteSha, silent, symlinkTarget);
    }

    private async saveSettings() {
        if (this.onSaveSettings) {
            await this.onSaveSettings();
        }
    }

    private handleError(message: string, error: unknown): void {
        logger.error(message, error);
        const detail = error instanceof Error ? error.message : String(error);
        this.interaction.notify(`${message}: ${detail}`);
    }

    async pushFiles(
        files: (TFile | string)[],
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[]
    ): Promise<PushResults> {
        return this.pushCoordinator.pushFiles(files, onProgress, remoteTree);
    }

    async pullAllFiles(
        files: (TFile | string)[],
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[]
    ): Promise<{ success: number; failed: number; conflicts: number; errors: Array<{ file: string; error: string }> }> {
        return this.pullCoordinator.pullAllFiles(files, onProgress, remoteTree);
    }

    /** Computes what a pull-all would do, without writing anything, for the plan-review modal. */
    async planPullBatch(files: (TFile | string)[], remoteTree?: GitTreeEntry[]): Promise<SyncPlan> {
        return this.pullCoordinator.planPullBatch(files, remoteTree);
    }

    /** Migrates a legacy GitLab last_commit_id baseline only when the current
     * file endpoint proves it still describes this tree blob. */
    private async migrateGitLabLegacyBaseline(path: string, repoPath: string, entry: GitTreeEntry | undefined): Promise<void> {
        const metadata = this.settings.syncMetadata[path];
        if (this.settings.serviceType !== 'gitlab' || !metadata?.lastSyncedSha || !entry?.sha || entry.sha === metadata.lastSyncedSha) return;
        const remote = await this.gitService.getFile(repoPath, this.settings.branch);
        if (remote.sha === entry.sha && remote.revision === metadata.lastSyncedSha) await this.updateMetadata(path, remote.sha);
    }

    private getFileInfo(fileOrPath: TFile | string) {
        return this.scanner.fileInfo(fileOrPath);
    }

    private async fileExists(fileOrPath: TFile | string): Promise<boolean> {
        return typeof fileOrPath === 'string'
            ? this.scanner.pathExists(fileOrPath)
            : this.scanner.indexedFileExists(fileOrPath.path);
    }

    private async getFileContent(fileOrPath: TFile | string): Promise<string | ArrayBuffer> {
        return this.scanner.readContent(fileOrPath);
    }

}
