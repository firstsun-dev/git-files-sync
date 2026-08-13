import { TFile, App, Notice } from 'obsidian';
import { GitServiceInterface, GitTreeEntry, GitFile } from '../services/git-service-interface';
import { MAX_BATCH_PUSH_SIZE } from '../services/git-service-base';
import { GitLabFilesPushSettings, getServiceName, getEffectiveSymlinkHandling, isSyncMetadataAtPath } from '../settings';
import { SyncConflictModal } from '../ui/SyncConflictModal';
import { SyncPlanModal, SyncPlanDirection } from '../ui/SyncPlanModal';
import { BatchConflictResolutionModal } from '../ui/BatchConflictResolutionModal';
import { SyncPlan, SyncPlanEntry, isSyncPlanEmpty } from '../ui/types';
import { logger } from '../utils/logger';
import { isBinaryPath, contentsEqual } from '../utils/path';
import { readLocalSymlinkTarget, createLocalSymlink } from '../utils/symlink';
import { gitBlobSha } from '../utils/git-blob-sha';
import { ensureParentDirs } from '../utils/vault-path';
import { SyncStatusService } from './sync-status-service';

/** Result of syncing one file within a batch push/pull. */
type BatchOutcome = 'done' | 'unchanged' | 'conflict';

/** A file classified as needing a push, queued for the grouped batch-commit call. */
type ToPushEntry = { path: string; name: string; repoPath: string; content: string | ArrayBuffer; existingSha?: string; existingRevision?: string };

/** A renamed file classified as a safe move, queued for the grouped batch-commit call. */
type ToMoveEntry = { path: string; name: string; repoPath: string; oldPath: string; oldRepoPath: string; content: string | ArrayBuffer; oldRevision?: string };

/** How the user chose to resolve one batch-push conflict in `BatchConflictResolutionModal`. */
export type ConflictResolution = 'keep-local' | 'keep-remote' | 'skip';

/**
 * A file whose local and remote content have both changed since the last
 * sync, detected while planning a batch push. Carries everything needed to
 * resolve it against the exact remote snapshot the plan was built from —
 * `remoteSha` (and `remoteRevision` for GitLab's optimistic lock) — without
 * re-fetching the remote tree. Remote content itself is fetched lazily (via
 * `getBlob(remoteSha, repoPath)`) only when the user asks to view the diff or
 * once "keep remote" is actually applied, so resolving a large batch of
 * conflicts via a bulk action never has to download content nobody looks at.
 */
export type BatchPushConflict = {
    path: string;
    name: string;
    repoPath: string;
    localContent: string | ArrayBuffer;
    remoteSha: string;
    remoteRevision?: string;
    resolution?: ConflictResolution;
};

/** The result of classifying a whole batch push before anything is written: what's ready to commit, and what needs a conflict decision first. */
type BatchPushPlan = {
    pushes: ToPushEntry[];
    moves: ToMoveEntry[];
    conflicts: BatchPushConflict[];
    /** Rename-safety conflicts (target already exists, or the old path moved on) — always left alone, never offered for interactive resolution. */
    autoSkipped: SyncPlanEntry[];
};

/**
 * Result of a batch push. `syncedPaths` lists every path that's now confirmed
 * synced (content just written matches what's now on the remote), with its
 * new blob sha when known. The caller uses this to mark those files' UI
 * status directly rather than re-fetching the remote tree right after a
 * write — GitHub's tree-by-branch-name read can lag a successful write by a
 * moment, so an immediate re-fetch can misreport a just-pushed file as
 * "modified" even though nothing is actually different.
 */
export type PushResults = {
    success: number;
    failed: number;
    /** Total conflicts detected (both interactively resolved and rename-safety auto-skips). */
    conflicts: number;
    /** Conflicts resolved as "keep local" or "keep remote" and applied. */
    resolvedConflicts: number;
    /** Conflicts left untouched — by explicit "skip", or a rename-safety auto-skip. */
    skippedConflicts: number;
    /** True when the user cancelled conflict resolution or the final plan review — nothing was written for the batch commit. */
    cancelled?: boolean;
    errors: Array<{ file: string; error: string }>;
    syncedPaths: Array<{ path: string; sha?: string }>;
    conflictedPaths?: string[];
};

export class SyncManager {
    private readonly app: App;
    private gitService: GitServiceInterface;
    private readonly settings: GitLabFilesPushSettings;
    private readonly onSaveSettings?: () => Promise<void>;
    private readonly isPathIgnored: (path: string) => boolean;
    readonly status: SyncStatusService;

    constructor(
        app: App,
        gitService: GitServiceInterface,
        settings: GitLabFilesPushSettings,
        onSaveSettings?: () => Promise<void>,
        isPathIgnored: (path: string) => boolean = () => false,
        status: SyncStatusService = new SyncStatusService(),
    ) {
        this.app = app;
        this.gitService = gitService;
        this.settings = settings;
        this.onSaveSettings = onSaveSettings;
        this.isPathIgnored = isPathIgnored;
        this.status = status;
    }

    private get serviceName(): string {
        return getServiceName(this.settings);
    }

    public async updateMetadata(path: string, sha: string): Promise<void> {
        this.settings.syncMetadata[path] = {
            lastSyncedSha: sha,
            lastSyncedAt: Date.now(),
            lastKnownPath: path
        };
        await this.saveSettings();
        this.status.markSynced(path, sha);
    }

    /** Drop sync metadata for a path that's been deleted, so it can't be mistaken for a rename source later. */
    public async clearMetadata(path: string): Promise<void> {
        if (!(path in this.settings.syncMetadata)) return;
        delete this.settings.syncMetadata[path];
        await this.saveSettings();
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
        const metadata = this.settings.syncMetadata[oldPath];
        if (!metadata) return;

        delete this.settings.syncMetadata[oldPath];
        const remotePath = metadata.renamedFrom ?? oldPath;

        this.settings.syncMetadata[newPath] = {
            lastSyncedSha: metadata.lastSyncedSha,
            lastSyncedAt: metadata.lastSyncedAt,
            lastKnownPath: newPath,
            ...(newPath === remotePath ? {} : { renamedFrom: remotePath }),
        };

        await this.saveSettings();
    }

    private getNormalizedPath(path: string): string {
        if (!this.settings.vaultFolder) return path;
        const folderPath = this.settings.vaultFolder + '/';
        if (path.startsWith(folderPath)) {
            return path.substring(folderPath.length);
        }
        if (path === this.settings.vaultFolder) return '';
        return path;
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
        return new Promise(resolve => {
            new SyncPlanModal(this.app, plan, direction, () => resolve(true), () => resolve(false)).open();
        });
    }

    /**
     * A missing local file at a tracked path is only weak evidence of a rename —
     * any orphaned metadata entry (e.g. from a local delete) matches it too. Only
     * report a rename once the remote content at the old path still matches the
     * content being pushed now, confirming it's really the same file that moved.
     *
     * Given a pre-fetched tree this costs no requests: the tree carries each
     * blob's sha, so one comparison against the local content's git blob sha
     * answers both "is the old path still on the remote" and "is it the same
     * bytes" (`contentsEqual` is exact equality, so the two agree). Without a
     * tree every candidate needs its own `getFile`, and a candidate the remote
     * no longer has 404s — which is why the batch push must pass its tree in
     * rather than re-probing the same dead paths once per file being pushed.
     */
    private async detectRename(
        file: TFile,
        content: string | ArrayBuffer,
        treeByFullPath?: Map<string, GitTreeEntry>
    ): Promise<string | null> {
        const candidates = Object.keys(this.settings.syncMetadata).filter(oldPath => {
            const metadata = this.settings.syncMetadata[oldPath];
            return oldPath !== file.path && isSyncMetadataAtPath(metadata, oldPath)
                && !this.app.vault.getFileByPath(oldPath);
        });
        if (candidates.length === 0) return null;

        // A single-file push (ribbon/command/context-menu/sync-view row) has no
        // prefetched tree to hand in, unlike batch push. Fetching it once here
        // (only when there's actually a candidate to check) replaces what used to
        // be one live getFile() round trip per orphaned syncMetadata entry -- a
        // silent, sequential delay that grew with however many stale entries had
        // accumulated (e.g. files deleted outside Obsidian's vault events).
        let tree = treeByFullPath;
        if (!tree) {
            try {
                const entries = await this.gitService.listFilesDetailed(this.settings.branch, false);
                tree = new Map(entries.map(e => [e.path, e]));
            } catch (e) {
                logger.warn('Failed to fetch remote tree for rename detection; falling back to per-candidate lookups', e);
            }
        }

        const localSha = tree ? await gitBlobSha(content) : undefined;
        for (const oldPath of candidates) {
            const oldRepoPath = this.getNormalizedPath(oldPath);
            const treeMatch = this.matchRenameFromTree(localSha, oldRepoPath, tree);
            if (treeMatch === true) return oldPath;
            if (treeMatch === false) continue;

            const remoteAtOldPath = await this.gitService.getFile(oldRepoPath, this.settings.branch);
            if (remoteAtOldPath.sha && this.contentsEqual(content, remoteAtOldPath.content)) return oldPath;
        }
        return null;
    }

    private matchRenameFromTree(
        localSha: string | undefined,
        oldRepoPath: string,
        treeByFullPath: Map<string, GitTreeEntry> | undefined
    ): boolean | undefined {
        if (!treeByFullPath) return undefined;
        const entry = treeByFullPath.get(this.getFullPathForTree(oldRepoPath));
        if (!entry || entry.symlink) return false;
        return entry.sha ? entry.sha === localSha : undefined;
    }

    private async performPush(file: {path: string, name: string}, content: string | ArrayBuffer, existingSha?: string, existingRevision?: string, silent = false): Promise<string | undefined> {
        const repoPath = this.getNormalizedPath(file.path);
        const result = await this.gitService.pushFile(
            repoPath,
            content,
            this.settings.branch,
            `Update ${file.name} from Obsidian`,
            existingSha,
            existingRevision
        );

        // Update metadata
        const newSha = result.sha ?? await gitBlobSha(content);
        await this.updateMetadata(file.path, newSha);

        if (!silent) new Notice(`Pushed ${file.name} to ${this.serviceName}`);
        return newSha;
    }

    /**
     * Handles pushing a local symbolic link per the configured behavior.
     * Returns true if the link was handled (pushed as a symlink, or intentionally
     * skipped); returns false to let the caller fall through to a normal content
     * push ("follow", which reads through the link).
     */
    /** `handled`: the symlink flow owns this push, caller should not fall through to a normal push. `synced`: content is now confirmed synced (false for "skip" mode, where nothing was actually written). */
    private async handleSymlinkPush(file: {path: string, name: string}, target: string, silent = false): Promise<{ handled: boolean; synced: boolean; sha?: string }> {
        const mode = getEffectiveSymlinkHandling(this.settings);
        if (mode === 'skip') {
            if (!silent) new Notice(`Skipped symlink ${file.name}.`);
            return { handled: true, synced: false };
        }
        if (mode === 'real' && this.gitService.pushSymlink) {
            const repoPath = this.getNormalizedPath(file.path);
            const result = await this.gitService.pushSymlink(repoPath, target, this.settings.branch, `Update ${file.name} from Obsidian`);
            if (result.sha) await this.updateMetadata(file.path, result.sha);
            if (!silent) new Notice(`Pushed symlink ${file.name} to ${this.serviceName}`);
            return { handled: true, synced: true, sha: result.sha };
        }
        return { handled: false, synced: false };
    }

    /** The symlink target to recreate on pull, or undefined when the remote isn't a symlink. */
    private symlinkPullTarget(remote: { isSymlink?: boolean; symlinkTarget?: string }): string | undefined {
        return remote.isSymlink ? remote.symlinkTarget ?? '' : undefined;
    }

    async pullFile(fileOrPath: TFile | string) {
        const { path, name, isString } = this.getFileInfo(fileOrPath);
        const repoPath = this.getNormalizedPath(path);

        try {
            const remote = await this.gitService.getFile(repoPath, this.settings.branch);
            if (!remote.sha) {
                new Notice(`File ${name} not found on remote.`);
                return;
            }

            const exists = await this.checkFileExists(path, isString);
            const localContent = exists ? await this.getFileContent(fileOrPath) : null;
            const lastSynced = this.settings.syncMetadata[path];

            if (exists && localContent !== null && this.contentsEqual(localContent, remote.content)) {
                // Still update metadata even if content matches
                await this.updateMetadata(path, remote.sha);
                new Notice(`${name} is already up to date.`);
                return;
            }

            // Conflict detection for pull (only if local exists)
            if (exists && remote.sha && lastSynced && !this.isSameBaseline(lastSynced.lastSyncedSha, remote)) {
                new SyncConflictModal(this.app, name, localContent ?? '', remote.content, (choice) => {
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
                }).open();
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

    private contentsEqual(a: string | ArrayBuffer, b: string | ArrayBuffer): boolean {
        return contentsEqual(a, b);
    }

    /** Check if remote baseline matches metadata, supporting lazy migration of old metadata. */
    private isSameBaseline(lastSyncedSha: string, remoteFile: GitFile): boolean {
        return lastSyncedSha === remoteFile.sha || lastSyncedSha === remoteFile.revision;
    }

    private isBinary(path: string): boolean {
        return isBinaryPath(path);
    }

    private async performPull(file: TFile | {path: string, name: string}, remoteContent: string | ArrayBuffer, remoteSha: string, silent = false, symlinkTarget?: string) {
        await ensureParentDirs(this.app.vault.adapter, file.path);

        if (symlinkTarget !== undefined) {
            // Remote blob is a symbolic link. Recreate a real OS link when the
            // setting is "real" and the platform supports it…
            if (getEffectiveSymlinkHandling(this.settings) === 'real' && createLocalSymlink(this.app, file.path, symlinkTarget)) {
                await this.updateMetadata(file.path, remoteSha);
                if (!silent) new Notice(`Pulled symlink ${file.name} from ${this.serviceName}`);
                return;
            }
            // …otherwise record where it pointed by writing the target as content.
            remoteContent = symlinkTarget;
        }

        await this.writePulledContent(file, remoteContent);
        await this.updateMetadata(file.path, remoteSha);
        if (!silent) new Notice(`Pulled ${file.name} from ${this.serviceName}`);
    }

    private async writePulledContent(file: TFile | {path: string, name: string}, remoteContent: string | ArrayBuffer): Promise<void> {
        if (typeof remoteContent !== 'string') {
            if (file instanceof TFile) {
                await this.app.vault.modifyBinary(file, remoteContent);
            } else {
                await this.app.vault.adapter.writeBinary(file.path, remoteContent);
            }
        } else if (file instanceof TFile) {
            await this.app.vault.modify(file, remoteContent);
        } else {
            await this.app.vault.adapter.write(file.path, remoteContent);
        }
    }

    private async saveSettings() {
        if (this.onSaveSettings) {
            await this.onSaveSettings();
        }
    }

    private handleError(message: string, error: unknown): void {
        logger.error(message, error);
        const detail = error instanceof Error ? error.message : String(error);
        new Notice(`${message}: ${detail}`);
    }

    /**
     * The one push pipeline for every entry point (ribbon, command palette,
     * context menu, sync-status row, "selected", "all modified") — a single
     * file is just a one-element array, never a special case. Classifies
     * every candidate first (nothing written yet), lets the user resolve any
     * conflicts and review the final plan, then commits everything that's
     * ready to push/move in one grouped call — a "keep local" conflict
     * resolution rides along in that same commit as an ordinary update, and a
     * "keep remote" resolution is only applied to the vault after that commit
     * succeeds. Cancelling either the conflict-resolution or the final-review
     * step aborts the whole batch: no commit, no local overwrite, no metadata
     * change.
     */
    async pushFiles(
        files: (TFile | string)[],
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[]
    ): Promise<PushResults> {
        const emptyResults = (): PushResults => (
            { success: 0, failed: 0, conflicts: 0, resolvedConflicts: 0, skippedConflicts: 0, errors: [], syncedPaths: [] }
        );

        const syncableFiles = files.filter(file => file && !this.isPathIgnored(this.getFileInfo(file).path));
        if (syncableFiles.length === 0) return emptyResults();

        const tree = remoteTree ?? await this.gitService.listFilesDetailed(this.settings.branch, false);
        const { plan, immediate } = await this.buildBatchPushPlan(syncableFiles, onProgress, tree);

        const results: PushResults = {
            ...emptyResults(),
            success: immediate.success,
            failed: immediate.failed,
            conflicts: plan.conflicts.length + plan.autoSkipped.length,
            errors: immediate.errors,
            syncedPaths: immediate.syncedPaths,
        };

        const skipped: BatchPushConflict[] = [];
        const keepRemote: BatchPushConflict[] = [];
        const keepLocal: BatchPushConflict[] = [];

        if (plan.conflicts.length > 0) {
            const resolved = await this.resolveBatchConflicts(plan.conflicts, syncableFiles.length, plan.pushes.length + plan.moves.length);
            if (!resolved) {
                results.cancelled = true;
                results.conflictedPaths = [...plan.conflicts.map(c => c.path), ...plan.autoSkipped.map(e => e.path)];
                await this.saveSettings();
                return results;
            }
            for (const conflict of plan.conflicts) {
                if (conflict.resolution === 'keep-local') {
                    keepLocal.push(conflict);
                    plan.pushes.push({
                        path: conflict.path,
                        name: conflict.name,
                        repoPath: conflict.repoPath,
                        content: conflict.localContent,
                        existingSha: conflict.remoteSha,
                        existingRevision: conflict.remoteRevision,
                    });
                } else if (conflict.resolution === 'keep-remote') {
                    keepRemote.push(conflict);
                } else {
                    skipped.push(conflict);
                }
            }
        }

        const reviewPlan: SyncPlan = {
            additions: plan.pushes.filter(p => !p.existingSha).map(p => ({ path: p.path, name: p.name })),
            modifications: plan.pushes.filter(p => p.existingSha).map(p => ({ path: p.path, name: p.name })),
            moves: plan.moves.map(m => ({ path: m.path, name: m.name, movedFrom: m.oldPath })),
            deletions: [],
            acceptedRemote: keepRemote.map(c => ({ path: c.path, name: c.name })),
            skippedConflicts: [
                ...skipped.map(c => ({ path: c.path, name: c.name })),
                ...plan.autoSkipped.map(e => ({ path: e.path, name: e.name })),
            ],
        };

        if (!isSyncPlanEmpty(reviewPlan) && !await this.confirmPlan(reviewPlan, 'push')) {
            results.cancelled = true;
            results.skippedConflicts = skipped.length + plan.autoSkipped.length;
            results.conflictedPaths = [...plan.conflicts.map(c => c.path), ...plan.autoSkipped.map(e => e.path)];
            await this.saveSettings();
            return results;
        }

        await this.commitResolvedBatch(plan.pushes, plan.moves, keepRemote, keepLocal, results);
        results.skippedConflicts = skipped.length + plan.autoSkipped.length;

        await this.saveSettings();
        this.notifyPushBatchResult(results);
        return results;
    }

    /**
     * Opens the batch conflict resolution modal and resolves once the user
     * clicks Continue (every conflict object in `conflicts` now carries a
     * `resolution`) or cancels (`false` — the conflicts are left untouched).
     */
    private resolveBatchConflicts(conflicts: BatchPushConflict[], totalFiles: number, safeCount: number): Promise<boolean> {
        return new Promise(resolve => {
            new BatchConflictResolutionModal(
                this.app,
                this.gitService,
                conflicts,
                totalFiles,
                safeCount,
                () => resolve(true),
                () => resolve(false),
            ).open();
        });
    }

    /**
     * Commits the resolved batch as one transaction. A "keep local" decision
     * was made against a specific remote snapshot (`remoteSha`); if the
     * remote has moved on for any of those paths since the user reviewed
     * them, the whole commit is aborted rather than silently applying a
     * stale decision — the user reviewed one version of the remote file, not
     * whatever is there now. Only once the commit (if any was needed)
     * actually succeeds are "keep remote" conflicts written to the vault —
     * a failed or aborted commit leaves both sides exactly as they were.
     */
    private async commitResolvedBatch(
        toPush: ToPushEntry[],
        toMove: ToMoveEntry[],
        keepRemote: BatchPushConflict[],
        keepLocal: BatchPushConflict[],
        results: PushResults
    ): Promise<void> {
        if (keepLocal.length > 0) {
            const stale = await this.staleResolvedConflicts(keepLocal);
            if (stale.length > 0) {
                const message = `Remote content changed since you reviewed this conflict (${stale.map(c => c.path).join(', ')}). Nothing was pushed — resolve the conflict again.`;
                for (const f of toPush) {
                    results.failed++;
                    results.errors.push({ file: f.path, error: message });
                }
                for (const f of toMove) {
                    results.failed++;
                    results.errors.push({ file: f.path, error: message });
                }
                return;
            }
        }

        const hadWork = toPush.length > 0 || toMove.length > 0;
        const failedBefore = results.failed;
        if (hadWork) {
            await this.commitPushBatch(toPush, toMove, results);
        }

        const committedOk = !hadWork || results.failed === failedBefore;
        if (!committedOk) return;

        const keepLocalPaths = new Set(keepLocal.map(c => c.path));
        results.resolvedConflicts += results.syncedPaths.filter(p => keepLocalPaths.has(p.path)).length;

        await this.applyKeepRemote(keepRemote, results);
    }

    /** Re-checks each "keep local" conflict's remote blob against the sha recorded when the plan was built, so a resolution reviewed against one remote snapshot is never silently applied to a different, newer one. */
    private async staleResolvedConflicts(keepLocal: BatchPushConflict[]): Promise<BatchPushConflict[]> {
        const stale: BatchPushConflict[] = [];
        for (const conflict of keepLocal) {
            const current = await this.gitService.getFile(conflict.repoPath, this.settings.branch);
            if (current.sha !== conflict.remoteSha) stale.push(conflict);
        }
        return stale;
    }

    /** Writes each "keep remote" conflict's reviewed content to the vault. Fetched by the exact blob sha recorded at plan time (via getBlob), not a fresh getFile, so what's applied is exactly what the user reviewed. */
    private async applyKeepRemote(keepRemote: BatchPushConflict[], results: PushResults): Promise<void> {
        for (const conflict of keepRemote) {
            try {
                const blob = await this.gitService.getBlob(conflict.remoteSha, conflict.repoPath);
                await this.performPull({ path: conflict.path, name: conflict.name }, blob.content, blob.sha, true, this.symlinkPullTarget(blob));
                results.resolvedConflicts++;
                results.syncedPaths.push({ path: conflict.path, sha: blob.sha });
            } catch (e) {
                results.failed++;
                results.errors.push({ file: conflict.path, error: e instanceof Error ? e.message : String(e) });
            }
        }
    }

    async pullAllFiles(
        files: (TFile | string)[],
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[]
    ): Promise<{ success: number; failed: number; conflicts: number; errors: Array<{ file: string; error: string }> }> {
        let tree = remoteTree;
        if (!tree) {
            try {
                tree = await this.gitService.listFilesDetailed(this.settings.branch, false);
            } catch (e) {
                logger.warn('Failed to fetch remote tree for pull; falling back to per-file fetches', e);
            }
        }
        const plan = await this.planPullBatch(files, tree);
        if (!isSyncPlanEmpty(plan) && !await this.confirmPlan(plan, 'pull')) {
            return { success: 0, failed: 0, conflicts: 0, errors: [] };
        }
        return this.processPullBatch(files, onProgress, tree);
    }

    /** Computes what a pull-all would do, without writing anything, for the plan-review modal. */
    async planPullBatch(files: (TFile | string)[], remoteTree?: GitTreeEntry[]): Promise<SyncPlan> {
        let treeByFullPath: Map<string, GitTreeEntry> | undefined;
        if (remoteTree) {
            treeByFullPath = new Map(remoteTree.map(e => [e.path, e]));
        }

        const plan: SyncPlan = { additions: [], modifications: [], deletions: [], moves: [] };
        for (const fileOrPath of files) {
            if (!fileOrPath) continue;
            const { path, name, isString } = this.getFileInfo(fileOrPath);
            try {
                const kind = await this.classifyPullForPlan(fileOrPath, path, isString, treeByFullPath);
                this.addPlanEntry(plan, kind, path, name);
            } catch (e) {
                logger.warn(`Skipping ${path} from pull plan preview`, e);
            }
        }
        return plan;
    }

    private addPlanEntry(plan: SyncPlan, kind: string, path: string, name: string, movedFrom?: string): void {
        const entry: SyncPlanEntry = { path, name, movedFrom };
        if (kind === 'addition') plan.additions.push(entry);
        else if (kind === 'modification') plan.modifications.push(entry);
        else if (kind === 'move') plan.moves.push(entry);
        // 'unchanged' / 'conflict' / 'skip' aren't part of what would be applied.
    }

    /**
     * Read-only mirror of the pull classification path, for the plan preview.
     * Only ever reads the pre-fetched tree's blob sha -- never a network
     * fetch, so a plan preview can't double the number of remote reads a
     * pull-all already makes. A symlink entry, an entry with no sha, or no
     * tree at all can't be compared locally, so those are optimistically
     * bucketed as "modification"; the real pull path (unchanged) still does
     * the authoritative check when applied.
     */
    private async classifyPullForPlan(
        fileOrPath: TFile | string,
        path: string,
        isString: boolean,
        treeByFullPath?: Map<string, GitTreeEntry>
    ): Promise<'addition' | 'modification' | 'unchanged' | 'conflict' | 'skip'> {
        const repoPath = this.getNormalizedPath(path);
        const entry = treeByFullPath?.get(this.getFullPathForTree(repoPath));
        if (treeByFullPath && !entry) return 'skip';

        if (!await this.checkFileExists(path, isString)) return 'addition';
        if (!entry?.sha || entry.symlink) return 'modification';

        const localSha = await gitBlobSha(await this.getFileContent(fileOrPath));
        if (localSha === entry.sha) return 'unchanged';
        await this.migrateGitLabLegacyBaseline(path, repoPath, entry);
        const lastSynced = this.settings.syncMetadata[path];
        if (lastSynced && entry.sha !== lastSynced.lastSyncedSha) return 'conflict';
        return 'modification';
    }

    private async processPullBatch(
        files: (TFile | string)[],
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[]
    ): Promise<{ success: number; failed: number; conflicts: number; errors: Array<{ file: string; error: string }> }> {
        const results = { success: 0, failed: 0, conflicts: 0, errors: [] as Array<{ file: string; error: string }> };

        // One tree read decides which files actually need downloading; without it
        // (a failed fetch) every file falls back to its own content request.
        let treeByFullPath: Map<string, GitTreeEntry> | undefined;
        try {
            const tree = remoteTree ?? await this.gitService.listFilesDetailed(this.settings.branch, false);
            treeByFullPath = new Map(tree.map(e => [e.path, e]));
        } catch (e) {
            logger.warn('Failed to fetch remote tree for pull; falling back to per-file fetches', e);
        }

        for (let i = 0; i < files.length; i++) {
            const fileOrPath = files[i];
            if (!fileOrPath) continue;

            const { path, name, isString } = this.getFileInfo(fileOrPath);
            onProgress?.(i + 1, files.length, name);

            try {
                const outcome = await this.processSingleBatchPull(fileOrPath, path, name, isString, treeByFullPath);
                if (outcome === 'done') results.success++;
                else if (outcome === 'conflict') results.conflicts++;
            } catch (e) {
                logger.error(`Failed to pull ${path}:`, e);
                results.failed++;
                results.errors.push({ file: path, error: e instanceof Error ? e.message : String(e) });
            }
        }

        await this.saveSettings();
        this.notifyBatchResult('pull', results.success, results.failed, results.conflicts);

        return results;
    }

    /**
     * Classifies every candidate for a batch push without writing anything
     * (except the pre-existing exception: a "real"-mode symlink push, which
     * has never gone through conflict detection and is committed immediately
     * exactly as before). Returns a `BatchPushPlan` of what's ready to push,
     * what needs a move, and what conflicts still need a resolution — plus
     * `immediate`, the outcome of anything already written during
     * classification.
     */
    private async buildBatchPushPlan(
        files: (TFile | string)[],
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[]
    ): Promise<{
        plan: BatchPushPlan;
        immediate: { success: number; failed: number; errors: Array<{ file: string; error: string }>; syncedPaths: Array<{ path: string; sha?: string }> };
    }> {
        const plan: BatchPushPlan = { pushes: [], moves: [], conflicts: [], autoSkipped: [] };
        const immediate = { success: 0, failed: 0, errors: [] as Array<{ file: string; error: string }>, syncedPaths: [] as Array<{ path: string; sha?: string }> };

        const tree = remoteTree ?? await this.gitService.listFilesDetailed(this.settings.branch, false);
        const treeByFullPath = new Map<string, GitTreeEntry>(tree.map(e => [e.path, e]));
        // Computed once per batch rather than per file: the fallback rename
        // scan is only worth running at all when some metadata entry has no
        // matching local file. Most files carry a tracked renamedFrom (set live
        // by the vault 'rename' handler) or aren't renamed at all, so this
        // avoids an Object.keys(syncMetadata) walk for every file in the batch.
        const hasOrphans = this.hasOrphanedRenameMetadata();

        for (let i = 0; i < files.length; i++) {
            const fileOrPath = files[i];
            if (!fileOrPath) continue;

            const { path, name, isString } = this.getFileInfo(fileOrPath);
            onProgress?.(i + 1, files.length, name);

            try {
                const outcome = await this.classifyPushCandidate(
                    fileOrPath, path, name, isString, treeByFullPath, plan.pushes, plan.moves, hasOrphans, plan.conflicts, plan.autoSkipped
                );
                if (outcome === 'done') {
                    immediate.success++;
                    // Symlink pushes are committed immediately outside the
                    // toPush queue, so the new sha isn't known here — the caller
                    // still gets to mark the path synced, just without a sha update.
                    immediate.syncedPaths.push({ path });
                }
                // 'unchanged'/'conflict'/'queued' don't move any of these
                // counters directly: conflicts are recorded into plan.conflicts
                // / plan.autoSkipped by classifyPushCandidate itself, and the
                // queued outcomes are resolved once the plan is committed.
            } catch (e) {
                logger.error(`Failed to push ${path}:`, e);
                immediate.failed++;
                immediate.errors.push({ file: path, error: e instanceof Error ? e.message : String(e) });
            }
        }

        return { plan, immediate };
    }

    /** Whether any syncMetadata entry no longer has a matching local file — the only case detectRename's fallback scan can find anything. */
    private hasOrphanedRenameMetadata(): boolean {
        for (const trackedPath of Object.keys(this.settings.syncMetadata)) {
            const metadata = this.settings.syncMetadata[trackedPath];
            if (!isSyncMetadataAtPath(metadata, trackedPath)) continue;
            if (!this.app.vault.getFileByPath(trackedPath)) return true;
        }
        return false;
    }

    /**
     * Classifies one file for the batch-push flow using a purely local
     * comparison (git blob sha vs. the pre-fetched remote tree's blob sha) —
     * no getFile network call. Symlinks are pushed immediately and never
     * queued; a confirmed rename is queued into `toMove` so it lands in the
     * same commit as everything else; everything else is either resolved
     * immediately ('unchanged'/'conflict') or appended to `toPush`.
     */
    private async classifyPushCandidate(
        fileOrPath: TFile | string,
        path: string,
        name: string,
        isString: boolean,
        treeByFullPath: Map<string, GitTreeEntry>,
        toPush: ToPushEntry[],
        toMove: ToMoveEntry[],
        hasOrphans: boolean,
        conflicts: BatchPushConflict[],
        autoSkipped: SyncPlanEntry[]
    ): Promise<BatchOutcome | 'queued'> {
        if (!await this.checkFileExists(path, isString)) throw new Error('File no longer exists');

        // Symbolic link handling: real → push as a symlink (GitHub), skip → ignore.
        const symlinkTarget = readLocalSymlinkTarget(this.app, path);
        if (symlinkTarget !== null) {
            const symlinkOutcome = await this.handleSymlinkPush({ path, name }, symlinkTarget, true);
            if (symlinkOutcome.handled) return symlinkOutcome.synced ? 'done' : 'unchanged';
        }

        const content = await this.getFileContent(fileOrPath);
        const repoPath = this.getNormalizedPath(path);

        const moveOutcome = await this.classifyAsMoveCandidate(fileOrPath, path, name, isString, content, treeByFullPath, toMove, hasOrphans, autoSkipped);
        if (moveOutcome) return moveOutcome;

        let treeEntry = treeByFullPath.get(this.getFullPathForTree(repoPath));
        await this.migrateGitLabLegacyBaseline(path, repoPath, treeEntry);
        const revision = await this.refreshGitLabBatchRevision(repoPath, treeEntry);
        if (revision) treeEntry = { ...treeEntry!, sha: revision.sha };
        const outcome = await this.classifyAgainstTreeEntry(path, content, treeEntry);
        if (outcome === 'conflict') {
            conflicts.push({
                path,
                name,
                repoPath,
                localContent: content,
                remoteSha: treeEntry!.sha!,
                remoteRevision: revision?.revision,
            });
            return 'conflict';
        }
        if (outcome !== 'queued') return outcome;

        toPush.push({ path, name, repoPath, content, existingSha: treeEntry?.sha, existingRevision: revision?.revision });
        return 'queued';
    }

    /**
     * `undefined` means "not a tracked rename" — the caller falls through to
     * a normal content classification. A rename-safety conflict (target
     * already exists, or the old path changed remotely) is a structural
     * block, not a case of "two versions of the same content" — there's
     * nothing to arbitrate with keep-local/keep-remote, so it's always left
     * alone rather than offered in the interactive resolution modal.
     *
     * The tracked fast path (`syncMetadata[path]?.renamedFrom`, set live by
     * the vault 'rename' handler) is keyed purely by path, not by object
     * identity, so it works whether the caller hands in a live `TFile` or
     * just its path string — every push entry point must classify a rename
     * identically regardless of which one it happens to have on hand (e.g. a
     * sync-status row with no cached `TFile` yet falls back to its path).
     * Only the content-based fallback scan (`detectRename`, for renames the
     * plugin missed tracking live) needs an actual `TFile`, so a string input
     * resolves one from the vault first.
     */
    private async classifyAsMoveCandidate(
        fileOrPath: TFile | string,
        path: string,
        name: string,
        isString: boolean,
        content: string | ArrayBuffer,
        treeByFullPath: Map<string, GitTreeEntry>,
        toMove: ToMoveEntry[],
        hasOrphans: boolean,
        autoSkipped: SyncPlanEntry[]
    ): Promise<BatchOutcome | 'queued' | undefined> {
        const trackedOldPath = this.settings.syncMetadata[path]?.renamedFrom;
        let renamedFrom = trackedOldPath ?? null;
        if (!renamedFrom && hasOrphans) {
            const file = !isString && fileOrPath instanceof TFile ? fileOrPath : this.app.vault.getFileByPath(path);
            if (file) renamedFrom = await this.detectRename(file, content, treeByFullPath);
        }
        if (!renamedFrom) return undefined;

        const outcome = await this.queueMove(path, name, renamedFrom, content, treeByFullPath, toMove);
        if (outcome === 'conflict') autoSkipped.push({ path, name });
        return outcome;
    }

    /**
     * Decides a confirmed rename's outcome purely from the pre-fetched tree —
     * no network call — and queues it for the grouped commit. Mirrors the two
     * safety checks handleRename applies to the single-file flow: a target
     * that already exists on the remote is never silently overwritten, and an
     * old path whose remote content has moved on since the last sync is never
     * silently deleted. Both surface as 'conflict' so the batch can't quietly
     * clobber either side the way a plain content push already refuses to.
     */
    private async queueMove(
        path: string,
        name: string,
        oldPath: string,
        content: string | ArrayBuffer,
        treeByFullPath: Map<string, GitTreeEntry>,
        toMove: ToMoveEntry[]
    ): Promise<BatchOutcome | 'queued'> {
        const repoPath = this.getNormalizedPath(path);
        const oldRepoPath = this.getNormalizedPath(oldPath);

        if (treeByFullPath.get(this.getFullPathForTree(repoPath))) return 'conflict';

        let oldEntry = treeByFullPath.get(this.getFullPathForTree(oldRepoPath));
        await this.migrateGitLabLegacyBaseline(oldPath, oldRepoPath, oldEntry);
        const oldRevision = await this.refreshGitLabBatchRevision(oldRepoPath, oldEntry);
        if (oldRevision) oldEntry = { ...oldEntry!, sha: oldRevision.sha };
        const metadata = this.settings.syncMetadata[path] ?? this.settings.syncMetadata[oldPath];
        const safeToDeleteOld = !oldEntry?.sha || !metadata?.lastSyncedSha || oldEntry.sha === metadata.lastSyncedSha;
        if (oldEntry?.sha && !safeToDeleteOld) return 'conflict';

        toMove.push({ path, name, repoPath, oldPath, oldRepoPath, content, oldRevision: oldRevision?.revision });
        return 'queued';
    }

    /** GitLab tree rows expose blob identity but not the commit revision needed
     * for optimistic locking. Read it during planning and compare the fresh blob
     * again before accepting the action; the stored revision then protects the
     * interval between planning and the atomic commit. */
    private async refreshGitLabBatchRevision(repoPath: string, entry: GitTreeEntry | undefined): Promise<{ sha: string; revision?: string } | undefined> {
        if (this.settings.serviceType !== 'gitlab' || !entry?.sha) return undefined;
        const remote = await this.gitService.getFile(repoPath, this.settings.branch);
        return remote.sha ? { sha: remote.sha, revision: remote.revision } : undefined;
    }

    /** Migrates a legacy GitLab last_commit_id baseline only when the current
     * file endpoint proves it still describes this tree blob. */
    private async migrateGitLabLegacyBaseline(path: string, repoPath: string, entry: GitTreeEntry | undefined): Promise<void> {
        const metadata = this.settings.syncMetadata[path];
        if (this.settings.serviceType !== 'gitlab' || !metadata?.lastSyncedSha || !entry?.sha || entry.sha === metadata.lastSyncedSha) return;
        const remote = await this.gitService.getFile(repoPath, this.settings.branch);
        if (remote.sha === entry.sha && remote.revision === metadata.lastSyncedSha) await this.updateMetadata(path, remote.sha);
    }

    /**
     * Decides a non-symlink, non-renamed file's outcome purely from a
     * pre-fetched tree entry and a locally-computed git blob sha — no network
     * call. Split out of classifyPushCandidate to keep both under the
     * cognitive-complexity limit.
     */
    private async classifyAgainstTreeEntry(
        path: string,
        content: string | ArrayBuffer,
        treeEntry: GitTreeEntry | undefined,
        dryRun = false
    ): Promise<BatchOutcome | 'queued'> {
        // Don't convert a remote symlink into a regular file.
        if (treeEntry?.symlink) return 'unchanged';

        // Skip if already in sync — compared locally, no network round trip.
        if (treeEntry?.sha) {
            const localSha = await gitBlobSha(content);
            if (localSha === treeEntry.sha) {
                if (!dryRun) await this.updateMetadata(path, treeEntry.sha);
                return 'unchanged';
            }
        }

        // Same conflict check as the single-file flow: if the remote has moved on
        // from what we last synced, overwriting it here would silently discard
        // whatever changed on the remote. Skip it instead of force-pushing so the
        // batch action can't quietly clobber changes the way a single push would
        // stop and ask about via SyncConflictModal.
        const lastSynced = this.settings.syncMetadata[path];
        if (treeEntry?.sha && lastSynced && treeEntry.sha !== lastSynced.lastSyncedSha) {
            return 'conflict';
        }

        return 'queued';
    }

    /**
     * Path relative to rootPath, matching how each git service's getFullPath
     * would resolve `repoPath` — mirrors that logic locally so pre-fetched tree
     * entries (always full repo paths) can be looked up without depending on
     * each service's protected getFullPath.
     */
    private getFullPathForTree(repoPath: string): string {
        if (repoPath.startsWith('/')) return repoPath.slice(1);
        const rootPath = this.settings.rootPath;
        if (!rootPath) return repoPath;
        const cleanRoot = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
        if (repoPath.startsWith(cleanRoot)) return repoPath;
        return cleanRoot + repoPath;
    }

    /**
     * Commits every queued file (and every queued move) in one or more
     * grouped batch-commit calls. When both are present they're chunked and
     * committed together via commitBatch, so a push-all that both edits and
     * moves files produces one commit per chunk, not one commit per kind.
     */
    private async commitPushBatch(toPush: ToPushEntry[], toMove: ToMoveEntry[], results: PushResults): Promise<void> {
        if (toMove.length === 0) {
            if (!this.gitService.pushBatch) {
                await this.pushSequentialFallback(toPush, results);
                return;
            }
            for (let i = 0; i < toPush.length; i += MAX_BATCH_PUSH_SIZE) {
                await this.commitOneChunk(toPush.slice(i, i + MAX_BATCH_PUSH_SIZE), results);
            }
            return;
        }

        if (!this.gitService.commitBatch) {
            // Sequential fallback for providers without an atomic multi-file
            // commit: each move is its own push-then-delete (mirrors the
            // single-file flow), and plain pushes go through the existing
            // sequential fallback.
            await this.moveSequentialFallback(toMove, results);
            await this.pushSequentialFallback(toPush, results);
            return;
        }

        const combined: Array<{ kind: 'push'; entry: ToPushEntry } | { kind: 'move'; entry: ToMoveEntry }> = [
            ...toPush.map(entry => ({ kind: 'push' as const, entry })),
            ...toMove.map(entry => ({ kind: 'move' as const, entry })),
        ];
        for (let i = 0; i < combined.length; i += MAX_BATCH_PUSH_SIZE) {
            await this.commitCombinedChunk(combined.slice(i, i + MAX_BATCH_PUSH_SIZE), results);
        }
    }

    /** Provider doesn't support a batch/atomic multi-file commit — fall back to
     * the same sequential per-file push used by the single-file flow. */
    private async pushSequentialFallback(toPush: ToPushEntry[], results: PushResults): Promise<void> {
        for (const f of toPush) {
            try {
                const sha = await this.performPush({ path: f.path, name: f.name }, f.content, f.existingSha, f.existingRevision, true);
                results.success++;
                results.syncedPaths.push({ path: f.path, sha });
            } catch (e) {
                results.failed++;
                results.errors.push({ file: f.path, error: e instanceof Error ? e.message : String(e) });
            }
        }
    }

    /** Provider doesn't support commitBatch — each queued move becomes its own push-then-delete commit. */
    private async moveSequentialFallback(toMove: ToMoveEntry[], results: PushResults): Promise<void> {
        for (const f of toMove) {
            try {
                const pushResult = await this.gitService.pushFile(f.repoPath, f.content, this.settings.branch, `Move ${f.oldRepoPath} to ${f.repoPath}`);
                const sha = pushResult.sha ?? await gitBlobSha(f.content);
                await this.gitService.deleteFile(f.oldRepoPath, this.settings.branch, `Remove ${f.oldRepoPath} (moved to ${f.repoPath})`);
                await this.updateMetadata(f.path, sha);
                delete this.settings.syncMetadata[f.oldPath];
                results.success++;
                results.syncedPaths.push({ path: f.path, sha });
            } catch (e) {
                results.failed++;
                results.errors.push({ file: f.path, error: e instanceof Error ? e.message : String(e) });
            }
        }
    }

    private async commitOneChunk(chunk: ToPushEntry[], results: PushResults): Promise<void> {
        try {
            const commitMessage = `Push ${chunk.length} file(s) from Obsidian`;
            const batchResults = await this.gitService.pushBatch!(
                chunk.map(f => ({ path: f.repoPath, content: f.content, existedRemotely: !!f.existingSha, revision: f.existingRevision })),
                this.settings.branch,
                commitMessage
            );
            const shaByPath = new Map(batchResults.map(r => [r.path, r.sha]));
            for (const f of chunk) {
                // GitHub's createCommitOnBranch reports only the commit oid, so
                // the provider returns no per-file sha. The content we just
                // committed hashes to exactly what the remote now holds, so
                // derive it locally — leaving the metadata stale would make the
                // next push read the remote as "moved since last sync" and skip
                // the file as a conflict.
                const sha = shaByPath.get(f.repoPath) ?? await gitBlobSha(f.content);
                await this.updateMetadata(f.path, sha);
                results.success++;
                results.syncedPaths.push({ path: f.path, sha });
            }
        } catch (e) {
            // Atomic per-provider failure: none of this chunk's files were
            // actually written, so every file in it is failed, not dropped.
            const message = e instanceof Error ? e.message : String(e);
            for (const f of chunk) {
                results.failed++;
                results.errors.push({ file: f.path, error: message });
            }
        }
    }

    private combinedChunkCommitMessage(pushCount: number, moveCount: number): string {
        if (moveCount === 0) return `Push ${pushCount} file(s) from Obsidian`;
        if (pushCount === 0) return `Move ${moveCount} file(s) from Obsidian`;
        return `Push ${pushCount} file(s) and move ${moveCount} file(s) from Obsidian`;
    }

    /** Commits a chunk mixing plain pushes and moves in one commitBatch call — one commit for the whole chunk regardless of kind. */
    private async commitCombinedChunk(
        chunk: Array<{ kind: 'push'; entry: ToPushEntry } | { kind: 'move'; entry: ToMoveEntry }>,
        results: PushResults
    ): Promise<void> {
        const pushEntries = chunk.filter((c): c is { kind: 'push'; entry: ToPushEntry } => c.kind === 'push').map(c => c.entry);
        const moveEntries = chunk.filter((c): c is { kind: 'move'; entry: ToMoveEntry } => c.kind === 'move').map(c => c.entry);

        try {
            const commitMessage = this.combinedChunkCommitMessage(pushEntries.length, moveEntries.length);

            const batchResults = await this.gitService.commitBatch!(
                pushEntries.map(f => ({ path: f.repoPath, content: f.content, existedRemotely: !!f.existingSha, revision: f.existingRevision })),
                moveEntries.map(f => ({ oldPath: f.oldRepoPath, newPath: f.repoPath, content: f.content, oldRevision: f.oldRevision })),
                this.settings.branch,
                commitMessage
            );
            const shaByPath = new Map(batchResults.map(r => [r.path, r.sha]));

            for (const f of pushEntries) {
                const sha = shaByPath.get(f.repoPath) ?? await gitBlobSha(f.content);
                await this.updateMetadata(f.path, sha);
                results.success++;
                results.syncedPaths.push({ path: f.path, sha });
            }
            for (const f of moveEntries) {
                const sha = shaByPath.get(f.repoPath) ?? await gitBlobSha(f.content);
                await this.updateMetadata(f.path, sha);
                delete this.settings.syncMetadata[f.oldPath];
                results.success++;
                results.syncedPaths.push({ path: f.path, sha });
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            for (const c of chunk) {
                results.failed++;
                results.errors.push({ file: c.entry.path, error: message });
            }
        }
    }

    private notifyBatchResult(op: 'push' | 'pull', success: number, failed: number, conflicts: number): void {
        const opName = op === 'push' ? 'Pushed' : 'Pulled';
        if (success > 0) {
            new Notice(`${opName} ${success} file(s) to ${this.serviceName}`);
        }
        if (conflicts > 0) {
            new Notice(`Skipped ${conflicts} file(s) with conflicting changes on both sides. Push or pull each one individually to resolve.`, 8000);
        }
        if (failed > 0) {
            new Notice(`Failed to ${op} ${failed} file(s). Check console for details.`);
        }
    }

    /**
     * One summary notification for a resolved batch push, distinguishing a
     * plain push from one that also resolved conflicts along the way — e.g.
     * "Pushed 19 files in one commit. 1 conflict kept remote. 1 conflict
     * skipped." Never more than one Notice per outcome kind, so resolving a
     * batch of many conflicts doesn't spam a notification per file.
     */
    private notifyPushBatchResult(results: PushResults): void {
        if (results.success > 0) {
            const commitNote = results.resolvedConflicts > 0 ? ' in one commit' : '';
            new Notice(`Pushed ${results.success} file(s) to ${this.serviceName}${commitNote}.`);
        }
        if (results.resolvedConflicts > 0) {
            new Notice(`Resolved ${results.resolvedConflicts} conflict(s).`);
        }
        if (results.skippedConflicts > 0) {
            new Notice(`Skipped ${results.skippedConflicts} conflict(s).`, 8000);
        }
        if (results.failed > 0) {
            new Notice(`Failed to push ${results.failed} file(s). Check console for details.`);
        }
    }

    private getFileInfo(fileOrPath: TFile | string) {
        const isString = typeof fileOrPath === 'string';
        const path = isString ? fileOrPath : fileOrPath.path;
        const name = isString ? path.split('/').pop() || path : fileOrPath.name;
        return { path, name, isString };
    }

    private async checkFileExists(path: string, isString: boolean): Promise<boolean> {
        if (isString) {
            return await this.app.vault.adapter.exists(path);
        }
        return !!this.app.vault.getFileByPath(path);
    }

    private async getFileContent(fileOrPath: TFile | string): Promise<string | ArrayBuffer> {
        const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
        const binary = this.isBinary(path);

        if (typeof fileOrPath === 'string') {
            return binary
                ? await this.app.vault.adapter.readBinary(fileOrPath)
                : await this.app.vault.adapter.read(fileOrPath);
        }
        try {
            return binary
                ? await this.app.vault.readBinary(fileOrPath)
                : await this.app.vault.read(fileOrPath);
        } catch (e) {
            // Obsidian's cached vault.read can fail for symlinked files (notably
            // on mobile); fall back to reading the path directly via the adapter.
            logger.warn(`vault.read failed for ${path}; falling back to adapter`, e);
            return binary
                ? await this.app.vault.adapter.readBinary(path)
                : await this.app.vault.adapter.read(path);
        }
    }

    private async processSingleBatchPull(
        fileOrPath: TFile | string,
        path: string,
        name: string,
        isString: boolean,
        treeByFullPath?: Map<string, GitTreeEntry>
    ): Promise<BatchOutcome> {
        const repoPath = this.getNormalizedPath(path);

        if (treeByFullPath) {
            const entry = treeByFullPath.get(this.getFullPathForTree(repoPath));
            if (!entry) throw new Error('File not found in remote');
            const decided = await this.classifyPullAgainstTreeEntry(fileOrPath, path, isString, entry);
            if (decided) return decided;
        }

        const remote = await this.gitService.getFile(repoPath, this.settings.branch);
        if (!remote.sha) throw new Error('File not found in remote');

        const exists = await this.checkFileExists(path, isString);
        if (exists) {
            const localContent = await this.getFileContent(fileOrPath);
            if (this.contentsEqual(localContent, remote.content)) {
                await this.updateMetadata(path, remote.sha);
                return 'unchanged';
            }

            // Same conflict check as the single-file flow (see processSingleBatchPush).
            const lastSynced = this.settings.syncMetadata[path];
            if (lastSynced && !this.isSameBaseline(lastSynced.lastSyncedSha, remote)) {
                return 'conflict';
            }
        }

        const fileRep = typeof fileOrPath === 'string' ? { path, name } : fileOrPath;
        await this.performPull(fileRep, remote.content, remote.sha, true, this.symlinkPullTarget(remote));
        return 'done';
    }

    /**
     * The outcome of a pull that's decidable from the tree entry alone, or null
     * when the file's content is genuinely needed. Downloading a file only to
     * discover it already matches costs one request per file, so an in-sync
     * "pull all" would re-fetch the whole vault; the entry's blob sha answers
     * that locally, exactly as the push side already does.
     */
    private async classifyPullAgainstTreeEntry(
        fileOrPath: TFile | string,
        path: string,
        isString: boolean,
        entry: GitTreeEntry
    ): Promise<BatchOutcome | null> {
        // A symlink's blob is its target path, and an entry without a sha can't
        // be compared — both still need the real fetch.
        if (entry.symlink || !entry.sha) return null;
        // Nothing local to compare against: it has to be written.
        if (!await this.checkFileExists(path, isString)) return null;

        const localSha = await gitBlobSha(await this.getFileContent(fileOrPath));
        if (localSha === entry.sha) {
            await this.updateMetadata(path, entry.sha);
            return 'unchanged';
        }

        await this.migrateGitLabLegacyBaseline(path, this.getNormalizedPath(path), entry);

        // Same conflict check as the content path below: local differs and the
        // remote has moved since we last synced, so pulling would discard one of
        // the two changes.
        const lastSynced = this.settings.syncMetadata[path];
        if (lastSynced && entry.sha !== lastSynced.lastSyncedSha) return 'conflict';

        return null;
    }
}
