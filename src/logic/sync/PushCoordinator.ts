import { App, TFile } from 'obsidian';
import type { GitServiceInterface, GitTreeEntry } from '../../services/git-service-interface';
import { getEffectiveSymlinkHandling, isSyncMetadataAtPath, type GitLabFilesPushSettings } from '../../settings';
import { gitBlobSha } from '../../utils/git-blob-sha';
import { logger } from '../../utils/logger';
import { contentsEqual, isBinaryPath } from '../../utils/path';
import { readLocalSymlinkTarget } from '../../utils/symlink';
import { t } from '../../i18n';
import type { ConflictResolver } from './ConflictResolver';
import type { PushExecutor } from './PushExecutor';
import type { SyncScanner } from './SyncScanner';
import { SyncPlanner } from './SyncPlanner';
import {
    type BatchPushConflict,
    type MoveQueueEntry,
    type PushQueueEntry,
    type PushResults,
    type SyncPlan,
    type SyncPlanEntry,
    isSyncPlanEmpty,
} from './types';

type BatchOutcome = 'done' | 'unchanged' | 'conflict';

interface BatchPushPlan {
    pushes: PushQueueEntry[];
    moves: MoveQueueEntry[];
    conflicts: BatchPushConflict[];
    autoSkipped: SyncPlanEntry[];
}

interface PushCoordinatorDependencies {
    app: App;
    gitService(): GitServiceInterface;
    settings: GitLabFilesPushSettings;
    scanner: SyncScanner;
    executor: PushExecutor;
    conflicts: ConflictResolver;
    isPathIgnored(path: string): boolean;
    confirmPlan(plan: SyncPlan): Promise<boolean>;
    resolveConflicts(conflicts: BatchPushConflict[], totalFiles: number, safeCount: number): Promise<boolean>;
    updateMetadata(path: string, sha: string): Promise<void>;
    migrateBaseline(path: string, repoPath: string, entry: GitTreeEntry | undefined): Promise<void>;
    saveSettings(): Promise<void>;
    notify(message: string, duration?: number): void;
    serviceName(): string;
}

/** Owns the complete batch-push use case while SyncManager remains a compatibility facade. */
export class PushCoordinator {
    private readonly planner = new SyncPlanner();

    constructor(private readonly dependencies: PushCoordinatorDependencies) {}

    async pushFiles(
        files: Array<TFile | string>,
        onProgress?: (current: number, total: number, fileName: string) => void,
        remoteTree?: GitTreeEntry[],
    ): Promise<PushResults> {
        const syncableFiles = files.filter(file => file && !this.dependencies.isPathIgnored(this.fileInfo(file).path));
        if (syncableFiles.length === 0) return this.emptyResults();

        const tree = remoteTree ?? await this.dependencies.gitService().listFilesDetailed(this.dependencies.settings.branch, false);
        const { plan, immediate } = await this.buildPlan(syncableFiles, onProgress, tree);
        const results: PushResults = {
            ...this.emptyResults(),
            success: immediate.success,
            updated: immediate.updated,
            failed: immediate.failed,
            conflicts: plan.conflicts.length + plan.autoSkipped.length,
            errors: immediate.errors,
            syncedPaths: immediate.syncedPaths,
        };
        const skipped: BatchPushConflict[] = [];
        const keepRemote: BatchPushConflict[] = [];
        const keepLocal: BatchPushConflict[] = [];

        if (!await this.resolvePlanConflicts(plan, syncableFiles.length, results, skipped, keepRemote, keepLocal)) {
            return results;
        }

        const reviewPlan = this.buildReviewPlan(plan, skipped, keepRemote);
        if (!isSyncPlanEmpty(reviewPlan) && !await this.dependencies.confirmPlan(reviewPlan)) {
            results.cancelled = true;
            results.skippedConflicts = skipped.length + plan.autoSkipped.length;
            results.conflictedPaths = this.conflictedPaths(plan);
            await this.dependencies.saveSettings();
            return results;
        }

        await this.commitResolvedBatch(plan.pushes, plan.moves, keepRemote, keepLocal, results);
        results.skippedConflicts = skipped.length + plan.autoSkipped.length;
        await this.dependencies.saveSettings();
        this.notifyResult(results);
        return results;
    }

    private emptyResults(): PushResults {
        return { success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, resolvedConflicts: 0, skippedConflicts: 0, errors: [], syncedPaths: [] };
    }

    private async resolvePlanConflicts(
        plan: BatchPushPlan,
        totalFiles: number,
        results: PushResults,
        skipped: BatchPushConflict[],
        keepRemote: BatchPushConflict[],
        keepLocal: BatchPushConflict[],
    ): Promise<boolean> {
        if (plan.conflicts.length === 0) return true;
        const resolved = await this.dependencies.resolveConflicts(
            plan.conflicts,
            totalFiles,
            plan.pushes.length + plan.moves.length,
        );
        if (!resolved) {
            results.cancelled = true;
            results.conflictedPaths = this.conflictedPaths(plan);
            await this.dependencies.saveSettings();
            return false;
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
        return true;
    }

    private buildReviewPlan(
        plan: BatchPushPlan,
        skipped: BatchPushConflict[],
        keepRemote: BatchPushConflict[],
    ): SyncPlan {
        return {
            additions: plan.pushes.filter(item => !item.existingSha).map(item => ({ path: item.path, name: item.name })),
            modifications: plan.pushes.filter(item => item.existingSha).map(item => ({ path: item.path, name: item.name })),
            moves: plan.moves.map(item => ({ path: item.path, name: item.name, movedFrom: item.oldPath })),
            deletions: [],
            acceptedRemote: keepRemote.map(item => ({ path: item.path, name: item.name })),
            skippedConflicts: [
                ...skipped.map(item => ({ path: item.path, name: item.name })),
                ...plan.autoSkipped,
            ],
        };
    }

    private conflictedPaths(plan: BatchPushPlan): string[] {
        return [...plan.conflicts.map(conflict => conflict.path), ...plan.autoSkipped.map(entry => entry.path)];
    }

    private async commitResolvedBatch(
        pushes: PushQueueEntry[],
        moves: MoveQueueEntry[],
        keepRemote: BatchPushConflict[],
        keepLocal: BatchPushConflict[],
        results: PushResults,
    ): Promise<void> {
        const stale = keepLocal.length > 0 ? await this.dependencies.conflicts.findStale(keepLocal) : [];
        if (stale.length > 0) {
            this.recordStaleFailure(pushes, moves, stale, results);
            return;
        }

        const hadWork = pushes.length > 0 || moves.length > 0;
        const failedBefore = results.failed;
        if (hadWork) await this.dependencies.executor.commitBatch(pushes, moves, results);
        if (hadWork && results.failed !== failedBefore) return;

        const keepLocalPaths = new Set(keepLocal.map(conflict => conflict.path));
        results.resolvedConflicts += results.syncedPaths.filter(path => keepLocalPaths.has(path.path)).length;
        await this.dependencies.conflicts.applyRemote(keepRemote, results);
    }

    private recordStaleFailure(
        pushes: PushQueueEntry[],
        moves: MoveQueueEntry[],
        stale: BatchPushConflict[],
        results: PushResults,
    ): void {
        const message = `Remote content changed since you reviewed this conflict (${stale.map(conflict => conflict.path).join(', ')}). Nothing was pushed — resolve the conflict again.`;
        for (const item of [...pushes, ...moves]) {
            results.failed += 1;
            results.errors.push({ file: item.path, error: message });
        }
    }

    private async buildPlan(
        files: Array<TFile | string>,
        onProgress: ((current: number, total: number, fileName: string) => void) | undefined,
        remoteTree: GitTreeEntry[],
    ): Promise<{
        plan: BatchPushPlan;
        immediate: { success: number; updated: number; failed: number; errors: Array<{ file: string; error: string }>; syncedPaths: Array<{ path: string; sha?: string }> };
    }> {
        const plan: BatchPushPlan = { pushes: [], moves: [], conflicts: [], autoSkipped: [] };
        const immediate = { success: 0, updated: 0, failed: 0, errors: [] as Array<{ file: string; error: string }>, syncedPaths: [] as Array<{ path: string; sha?: string }> };
        const tree = new Map(remoteTree.map(entry => [entry.path, entry]));
        const hasOrphans = this.hasOrphanedRenameMetadata();

        for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            if (!file) continue;
            const info = this.fileInfo(file);
            onProgress?.(index + 1, files.length, info.name);
            try {
                const outcome = await this.classifyCandidate(file, info, tree, plan, hasOrphans);
                if (outcome === 'done') {
                    immediate.success += 1;
                    immediate.updated += 1;
                    immediate.syncedPaths.push({ path: info.path });
                }
            } catch (error) {
                logger.error(`Failed to push ${info.path}:`, error);
                immediate.failed += 1;
                immediate.errors.push({ file: info.path, error: this.errorMessage(error) });
            }
        }
        return { plan, immediate };
    }

    private hasOrphanedRenameMetadata(): boolean {
        for (const trackedPath of Object.keys(this.dependencies.settings.syncMetadata)) {
            const metadata = this.dependencies.settings.syncMetadata[trackedPath];
            if (isSyncMetadataAtPath(metadata, trackedPath) && !this.dependencies.app.vault.getFileByPath(trackedPath)) return true;
        }
        return false;
    }

    private async classifyCandidate(
        file: TFile | string,
        info: ReturnType<SyncScanner['fileInfo']>,
        tree: Map<string, GitTreeEntry>,
        plan: BatchPushPlan,
        hasOrphans: boolean,
    ): Promise<BatchOutcome | 'queued'> {
        if (!await this.fileExists(file)) throw new Error('File no longer exists');
        const symlinkTarget = readLocalSymlinkTarget(this.dependencies.app, info.path);
        if (symlinkTarget !== null) {
            const outcome = await this.dependencies.executor.pushSymlink(
                { path: info.path, name: info.name },
                symlinkTarget,
                getEffectiveSymlinkHandling(this.dependencies.settings),
                true,
            );
            if (outcome.handled) return outcome.synced ? 'done' : 'unchanged';
        }

        const content = await this.dependencies.scanner.readContent(file);
        const moveOutcome = await this.classifyMove(file, info, content, tree, plan.moves, hasOrphans, plan.autoSkipped);
        if (moveOutcome) return moveOutcome;

        const repoPath = this.dependencies.scanner.toRepoPath(info.path);
        let entry = tree.get(this.dependencies.scanner.toTreePath(repoPath));
        await this.dependencies.migrateBaseline(info.path, repoPath, entry);
        const revision = await this.refreshGitLabRevision(repoPath, entry);
        if (revision) entry = { ...entry!, sha: revision.sha };
        const outcome = await this.classifyAgainstTree(info.path, content, entry);
        if (outcome === 'conflict') {
            plan.conflicts.push({
                path: info.path,
                name: info.name,
                repoPath,
                localContent: content,
                remoteSha: entry!.sha!,
                remoteRevision: revision?.revision,
            });
            return outcome;
        }
        if (outcome === 'queued') {
            plan.pushes.push({
                path: info.path,
                name: info.name,
                repoPath,
                content,
                existingSha: entry?.sha,
                existingRevision: revision?.revision,
            });
        }
        return outcome;
    }

    private async classifyMove(
        file: TFile | string,
        info: ReturnType<SyncScanner['fileInfo']>,
        content: string | ArrayBuffer,
        tree: Map<string, GitTreeEntry>,
        moves: MoveQueueEntry[],
        hasOrphans: boolean,
        autoSkipped: SyncPlanEntry[],
    ): Promise<BatchOutcome | 'queued' | undefined> {
        let oldPath = this.dependencies.settings.syncMetadata[info.path]?.renamedFrom ?? null;
        if (!oldPath && hasOrphans) {
            const vaultFile = !info.isString && file instanceof TFile ? file : this.dependencies.app.vault.getFileByPath(info.path);
            if (vaultFile) oldPath = await this.detectRename(vaultFile, content, tree);
        }
        if (!oldPath) return undefined;
        const outcome = await this.queueMove(info.path, info.name, oldPath, content, tree, moves);
        if (outcome === 'conflict') autoSkipped.push({ path: info.path, name: info.name });
        return outcome;
    }

    private async detectRename(
        file: TFile,
        content: string | ArrayBuffer,
        tree?: Map<string, GitTreeEntry>,
    ): Promise<string | null> {
        const candidates = Object.keys(this.dependencies.settings.syncMetadata).filter(oldPath => {
            const metadata = this.dependencies.settings.syncMetadata[oldPath];
            return oldPath !== file.path && isSyncMetadataAtPath(metadata, oldPath)
                && !this.dependencies.app.vault.getFileByPath(oldPath);
        });
        if (candidates.length === 0) return null;

        let availableTree = tree;
        if (!availableTree) {
            try {
                const entries = await this.dependencies.gitService().listFilesDetailed(this.dependencies.settings.branch, false);
                availableTree = new Map(entries.map(entry => [entry.path, entry]));
            } catch (error) {
                logger.warn('Failed to fetch remote tree for rename detection; falling back to per-candidate lookups', error);
            }
        }
        const localSha = availableTree ? await gitBlobSha(content) : undefined;
        for (const oldPath of candidates) {
            const repoPath = this.dependencies.scanner.toRepoPath(oldPath);
            const match = this.matchRename(localSha, repoPath, availableTree);
            if (match === true) return oldPath;
            if (match === false) continue;
            const remote = await this.dependencies.gitService().getFile(repoPath, this.dependencies.settings.branch);
            if (remote.sha && contentsEqual(content, remote.content)) return oldPath;
        }
        return null;
    }

    private matchRename(
        localSha: string | undefined,
        repoPath: string,
        tree: Map<string, GitTreeEntry> | undefined,
    ): boolean | undefined {
        if (!tree) return undefined;
        const entry = tree.get(this.dependencies.scanner.toTreePath(repoPath));
        if (!entry || entry.symlink) return false;
        return entry.sha ? entry.sha === localSha : undefined;
    }

    private async queueMove(
        path: string,
        name: string,
        oldPath: string,
        content: string | ArrayBuffer,
        tree: Map<string, GitTreeEntry>,
        moves: MoveQueueEntry[],
    ): Promise<BatchOutcome | 'queued'> {
        const repoPath = this.dependencies.scanner.toRepoPath(path);
        const oldRepoPath = this.dependencies.scanner.toRepoPath(oldPath);
        const destination = tree.get(this.dependencies.scanner.toTreePath(repoPath));
        let oldEntry = tree.get(this.dependencies.scanner.toTreePath(oldRepoPath));
        const revision = await this.refreshGitLabRevision(oldRepoPath, oldEntry);
        if (revision) oldEntry = { ...oldEntry!, sha: revision.sha };
        const kind = isBinaryPath(path) ? 'binary' : 'text';
        const decision = this.planner.planMove({
            local: { path, exists: true, blobSha: await gitBlobSha(content), kind },
            source: { path: oldPath, repoPath: oldRepoPath, exists: oldEntry !== undefined, blobSha: oldEntry?.sha, kind },
            destination: { path, repoPath, exists: destination !== undefined, blobSha: destination?.sha, kind },
        });
        if (decision.action === 'resolve-conflict') return 'conflict';

        moves.push({ path, name, repoPath, oldPath, oldRepoPath, content, oldRevision: revision?.revision });
        return 'queued';
    }

    private async refreshGitLabRevision(
        repoPath: string,
        entry: GitTreeEntry | undefined,
    ): Promise<{ sha: string; revision?: string } | undefined> {
        if (this.dependencies.settings.serviceType !== 'gitlab' || !entry?.sha) return undefined;
        const remote = await this.dependencies.gitService().getFile(repoPath, this.dependencies.settings.branch);
        return remote.sha ? { sha: remote.sha, revision: remote.revision } : undefined;
    }

    private async classifyAgainstTree(
        path: string,
        content: string | ArrayBuffer,
        entry: GitTreeEntry | undefined,
    ): Promise<BatchOutcome | 'queued'> {
        if (entry?.symlink) return 'unchanged';
        const localKind = isBinaryPath(path) ? 'binary' : 'text';
        const lastSynced = this.dependencies.settings.syncMetadata[path];
        const decision = this.planner.planFor('push', {
            local: { path, exists: true, blobSha: await gitBlobSha(content), kind: localKind },
            remote: {
                path,
                repoPath: this.dependencies.scanner.toRepoPath(path),
                exists: entry !== undefined,
                blobSha: entry?.sha,
                kind: localKind,
            },
            base: { blobSha: lastSynced?.lastSyncedSha },
        });
        if (decision.action === 'none' && entry?.sha) {
            await this.dependencies.updateMetadata(path, entry.sha);
            return 'unchanged';
        }
        if (decision.action === 'resolve-conflict') return 'conflict';
        return 'queued';
    }

    private notifyResult(results: PushResults): void {
        if (results.success > 0) {
            const commitNote = results.resolvedConflicts > 0 ? t('sync.notice.pushCommitNote') : '';
            const service = this.dependencies.serviceName();
            const key = this.pushSummaryKey(results.added, results.updated);
            this.dependencies.notify(t(key, { service, added: results.added, updated: results.updated, commitNote }));
        }
        if (results.resolvedConflicts > 0) this.dependencies.notify(`Resolved ${results.resolvedConflicts} conflict(s).`);
        if (results.skippedConflicts > 0) this.dependencies.notify(`Skipped ${results.skippedConflicts} conflict(s).`, 8000);
        if (results.failed > 0) this.dependencies.notify(`Failed to push ${results.failed} file(s). Check console for details.`);
    }

    private pushSummaryKey(added: number, updated: number): 'sync.notice.pushSummary' | 'sync.notice.pushAddedOnly' | 'sync.notice.pushUpdatedOnly' {
        if (added > 0 && updated > 0) return 'sync.notice.pushSummary';
        return added > 0 ? 'sync.notice.pushAddedOnly' : 'sync.notice.pushUpdatedOnly';
    }

    private fileInfo(file: TFile | string): ReturnType<SyncScanner['fileInfo']> {
        return this.dependencies.scanner.fileInfo(file);
    }

    private fileExists(file: TFile | string): Promise<boolean> | boolean {
        return typeof file === 'string'
            ? this.dependencies.scanner.pathExists(file)
            : this.dependencies.scanner.indexedFileExists(file.path);
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
