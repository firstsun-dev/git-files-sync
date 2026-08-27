import { TFile, type App } from 'obsidian';
import type { GitServiceInterface, GitTreeEntry } from '../../services/git-service-interface';
import { getServiceName, type GitLabFilesPushSettings } from '../../settings';
import type { GitignoreManager } from '../gitignore-manager';
import type { FileStatus, SyncStatusService } from '../sync-status-service';
import type { PlannedPushBatch } from './PushCoordinator';
import { RemoteDeleteExecutor, type RemoteDeleteResult } from './RemoteDeleteExecutor';
import { SyncDiffService } from './SyncDiffService';
import type { SyncManager } from './SyncManager';
import type { SyncPlanDirection } from './SyncInteractionPort';
import {
    SyncStatusRefreshService,
    type SyncStatusRefreshDependencies,
    SyncStatusRefreshProgress,
    SyncStatusRefreshResult,
} from './SyncStatusRefreshService';
import type { BatchPushConflict, DeleteQueueEntry, FileDiff, MoveQueueEntry, PushQueueEntry, PushResults, SyncPlan, SyncResult } from './types';
import { ensureParentDirs } from '../../utils/vault-path';
import { buildRemoteFileUrl } from '../../utils/remote-url';

export type SyncProgress = (current: number, total: number, fileName: string) => void;
export type RemoteDeleteProgress = (current: number, path: string) => void;

export interface SyncWorkspaceInfo {
    serviceName: string;
    branch: string;
    vaultFolder: string;
}

export interface SyncWorkspace {
    getStatuses(): readonly FileStatus[];
    getInfo(): SyncWorkspaceInfo;
    getRemoteFileUrl(path: string): string | null;
    refresh(onProgress?: (progress: SyncStatusRefreshProgress) => void): Promise<SyncStatusRefreshResult>;
    push(paths: readonly string[], onProgress?: SyncProgress): Promise<PushResults>;
    pull(paths: readonly string[], onProgress?: SyncProgress): Promise<SyncResult>;
    pullOne(path: string): Promise<void>;
    deleteRemote(paths: readonly string[], onProgress?: RemoteDeleteProgress): Promise<RemoteDeleteResult>;
    deleteLocal(path: string): Promise<void>;
    moveLocal(path: string, target: string): Promise<void>;
    clearMetadata(path: string): Promise<void>;
    trackRename(newPath: string, oldPath: string): Promise<void>;
    getDiff(path: string): Promise<FileDiff>;
    /** Repo-relative path a provider mutation needs for a given vault path. */
    toRepoPath(path: string): string;
    /** Classifies and conflict-resolves a push batch without confirming or committing — for a unified Sync Plan. */
    planPush(paths: readonly string[]): Promise<PlannedPushBatch>;
    /** Computes what a pull batch would do, without writing anything — for a unified Sync Plan. */
    planPull(paths: readonly string[]): Promise<SyncPlan>;
    /** Applies an already-confirmed pull batch without showing its own confirm modal. */
    applyPull(paths: readonly string[]): Promise<SyncResult>;
    /** Commits already-planned pushes/moves/deletions as one provider mutation set. */
    commitResolvedBatch(
        pushes: PushQueueEntry[],
        moves: MoveQueueEntry[],
        deletions: DeleteQueueEntry[],
        keepRemote: BatchPushConflict[],
        keepLocal: BatchPushConflict[],
        results: PushResults,
    ): Promise<void>;
    /** Shows one review/confirm modal for a merged Sync Plan. */
    confirmPlan(plan: SyncPlan, direction: SyncPlanDirection): Promise<boolean>;
}

export interface SyncWorkspaceRuntimeDependencies {
    manager(): SyncManager;
    gitService(): GitServiceInterface;
    settings(): GitLabFilesPushSettings;
    refreshService: SyncStatusRefreshService;
    diffService: SyncDiffService;
    normalizePath(path: string): string;
    app: App;
}

interface RemoteTreeSnapshot {
    branch: string;
    rootPath: string;
    head: string;
    entries: GitTreeEntry[];
}

/** Runtime implementation of the sole domain API consumed by the sync-status UI. */
export class SyncManagerWorkspace implements SyncWorkspace {
    private remoteTreeSnapshot?: RemoteTreeSnapshot;

    constructor(private readonly dependencies: SyncWorkspaceRuntimeDependencies) {}

    getStatuses(): readonly FileStatus[] {
        return [...this.dependencies.manager().status.values()];
    }

    getInfo(): SyncWorkspaceInfo {
        const settings = this.dependencies.settings();
        return { serviceName: getServiceName(settings), branch: settings.branch, vaultFolder: settings.vaultFolder };
    }

    getRemoteFileUrl(path: string): string | null {
        return buildRemoteFileUrl(this.dependencies.settings(), this.dependencies.normalizePath(path));
    }

    async refresh(onProgress?: (progress: SyncStatusRefreshProgress) => void): Promise<SyncStatusRefreshResult> {
        const result = await this.dependencies.refreshService.refresh(onProgress);
        const settings = this.dependencies.settings();
        this.remoteTreeSnapshot = result.remoteHead
            ? { branch: settings.branch, rootPath: settings.rootPath, head: result.remoteHead, entries: result.remoteEntries }
            : undefined;
        return result;
    }

    async push(paths: readonly string[], onProgress?: SyncProgress): Promise<PushResults> {
        const remoteTree = await this.reusableRemoteTree();
        if (!onProgress && !remoteTree) return this.dependencies.manager().pushFiles([...paths]);
        return this.dependencies.manager().pushFiles([...paths], onProgress, remoteTree);
    }

    async pull(paths: readonly string[], onProgress?: SyncProgress): Promise<SyncResult> {
        const remoteTree = await this.reusableRemoteTree();
        if (!onProgress && !remoteTree) return this.dependencies.manager().pullAllFiles([...paths]);
        return this.dependencies.manager().pullAllFiles([...paths], onProgress, remoteTree);
    }

    async pullOne(path: string): Promise<void> {
        await this.dependencies.manager().pullFile(path);
    }

    async deleteRemote(paths: readonly string[], onProgress?: RemoteDeleteProgress): Promise<RemoteDeleteResult> {
        const executor = new RemoteDeleteExecutor(
            this.dependencies.gitService(),
            this.dependencies.settings().branch,
        );
        const result = await executor.execute(
            paths.map(path => ({ path, repoPath: this.dependencies.normalizePath(path) })),
            (current, target) => onProgress?.(current, target.path),
        );
        // Both sides are now gone for these paths: drop tracked metadata so a
        // future remote file at the same path isn't mistaken for a rename
        // source / misclassified as `local-deleted`, and drop the row from
        // the live status map instead of leaving a stale `local-deleted`
        // entry until the next full refresh.
        for (const path of result.deletedPaths) {
            await this.clearMetadata(path);
            this.dependencies.manager().status.delete(path);
        }
        return result;
    }

    async deleteLocal(path: string): Promise<void> {
        const file = this.dependencies.app.vault.getFileByPath(path);
        if (file instanceof TFile) await this.dependencies.app.fileManager.trashFile(file);
        else await this.dependencies.app.vault.adapter.remove(path);
        await this.clearMetadata(path);
    }

    async moveLocal(path: string, target: string): Promise<void> {
        await ensureParentDirs(this.dependencies.app.vault.adapter, target);
        const file = this.dependencies.app.vault.getFileByPath(path);
        if (file instanceof TFile) await this.dependencies.app.fileManager.renameFile(file, target);
        else {
            await this.dependencies.app.vault.adapter.rename(path, target);
            await this.trackRename(target, path);
        }
    }

    clearMetadata(path: string): Promise<void> {
        return this.dependencies.manager().clearMetadata(path);
    }

    trackRename(newPath: string, oldPath: string): Promise<void> {
        return this.dependencies.manager().trackRename(newPath, oldPath);
    }

    getDiff(path: string): Promise<FileDiff> {
        return this.dependencies.diffService.getDiff(path);
    }

    toRepoPath(path: string): string {
        return this.dependencies.normalizePath(path);
    }

    async planPush(paths: readonly string[]): Promise<PlannedPushBatch> {
        const remoteTree = await this.reusableRemoteTree();
        return this.dependencies.manager().planSyncBatch([...paths], undefined, remoteTree);
    }

    async planPull(paths: readonly string[]): Promise<SyncPlan> {
        const remoteTree = await this.reusableRemoteTree();
        return this.dependencies.manager().planPullBatch([...paths], remoteTree);
    }

    async applyPull(paths: readonly string[]): Promise<SyncResult> {
        const remoteTree = await this.reusableRemoteTree();
        return this.dependencies.manager().applyPullBatch([...paths], undefined, remoteTree);
    }

    commitResolvedBatch(
        pushes: PushQueueEntry[],
        moves: MoveQueueEntry[],
        deletions: DeleteQueueEntry[],
        keepRemote: BatchPushConflict[],
        keepLocal: BatchPushConflict[],
        results: PushResults,
    ): Promise<void> {
        return this.dependencies.manager().commitResolvedBatch(pushes, moves, deletions, keepRemote, keepLocal, results);
    }

    confirmPlan(plan: SyncPlan, direction: SyncPlanDirection): Promise<boolean> {
        return this.dependencies.manager().confirmPlan(plan, direction);
    }

    private async reusableRemoteTree(): Promise<GitTreeEntry[] | undefined> {
        const snapshot = this.remoteTreeSnapshot;
        const settings = this.dependencies.settings();
        const gitService = this.dependencies.gitService();
        if (!snapshot || !gitService.getBranchHead
            || snapshot.branch !== settings.branch
            || snapshot.rootPath !== settings.rootPath) return undefined;
        try {
            return await gitService.getBranchHead(snapshot.branch) === snapshot.head ? snapshot.entries : undefined;
        } catch {
            return undefined;
        }
    }
}

/** Test-only boundary adapter retained for focused workspace wiring tests. */
export class BoundarySyncWorkspace implements SyncWorkspace {
    constructor(
        private readonly getManager: () => SyncManager,
        private readonly boundaries: {
            refresh(): Promise<SyncStatusRefreshResult>;
            deleteRemote(paths: readonly string[]): Promise<RemoteDeleteResult>;
            getDiff(path: string): Promise<FileDiff>;
        },
    ) {}

    getStatuses(): readonly FileStatus[] { return [...this.getManager().status.values()]; }
    getInfo(): SyncWorkspaceInfo { return { serviceName: '', branch: '', vaultFolder: '' }; }
    getRemoteFileUrl(): string | null { return null; }
    refresh(): Promise<SyncStatusRefreshResult> { return this.boundaries.refresh(); }
    push(paths: readonly string[]): Promise<PushResults> { return this.getManager().pushFiles([...paths]); }
    pull(paths: readonly string[]): Promise<SyncResult> { return this.getManager().pullAllFiles([...paths]); }
    pullOne(path: string): Promise<void> { return this.getManager().pullFile(path); }
    deleteRemote(paths: readonly string[]): Promise<RemoteDeleteResult> { return this.boundaries.deleteRemote(paths); }
    async deleteLocal(path: string): Promise<void> { await this.getManager().clearMetadata(path); }
    moveLocal(path: string, target: string): Promise<void> { return this.getManager().trackRename(target, path); }
    clearMetadata(path: string): Promise<void> { return this.getManager().clearMetadata(path); }
    trackRename(newPath: string, oldPath: string): Promise<void> { return this.getManager().trackRename(newPath, oldPath); }
    getDiff(path: string): Promise<FileDiff> { return this.boundaries.getDiff(path); }
    toRepoPath(path: string): string { return path; }
    planPush(paths: readonly string[]): Promise<PlannedPushBatch> { return this.getManager().planSyncBatch([...paths]); }
    planPull(paths: readonly string[]): Promise<SyncPlan> { return this.getManager().planPullBatch([...paths]); }
    applyPull(paths: readonly string[]): Promise<SyncResult> { return this.getManager().applyPullBatch([...paths]); }
    commitResolvedBatch(
        pushes: PushQueueEntry[],
        moves: MoveQueueEntry[],
        deletions: DeleteQueueEntry[],
        keepRemote: BatchPushConflict[],
        keepLocal: BatchPushConflict[],
        results: PushResults,
    ): Promise<void> {
        return this.getManager().commitResolvedBatch(pushes, moves, deletions, keepRemote, keepLocal, results);
    }
    confirmPlan(plan: SyncPlan, direction: SyncPlanDirection): Promise<boolean> { return this.getManager().confirmPlan(plan, direction); }
}

export type SyncFile = TFile | string;

interface SyncRuntimeHost {
    settings: GitLabFilesPushSettings;
    gitService: GitServiceInterface;
    sync: SyncManager;
    syncWorkspace?: SyncWorkspace;
    syncStatusRefresh?: SyncStatusRefreshService;
    gitignoreManager?: GitignoreManager;
    filterFilesByVaultFolder?(files: TFile[]): TFile[];
    filterPathByVaultFolder?(path: string): boolean;
    getNormalizedPath(path: string): string;
    getVaultPath?(path: string): string;
}

/** Supplies the runtime boundary to lightweight tests and older hosts that do not construct it during startup. */
export function ensureSyncWorkspaceRuntime(
    app: App,
    host: SyncRuntimeHost,
    statuses: SyncStatusService,
): { workspace: SyncWorkspace; refreshService: SyncStatusRefreshService } {
    if (host.syncWorkspace && host.syncStatusRefresh) {
        return { workspace: host.syncWorkspace, refreshService: host.syncStatusRefresh };
    }
    const fallbackGitignore = {
        loadGitignores: () => Promise.resolve(),
        isIgnored: () => false,
    } as unknown as GitignoreManager;
    const refreshDependencies: SyncStatusRefreshDependencies = {
        app,
        settings: () => host.settings,
        gitService: () => host.gitService,
        gitignoreManager: () => host.gitignoreManager ?? fallbackGitignore,
        syncManager: () => host.sync,
        filterFilesByVaultFolder: files => host.filterFilesByVaultFolder?.(files) ?? files,
        filterPathByVaultFolder: path => host.filterPathByVaultFolder?.(path) ?? true,
        getNormalizedPath: path => host.getNormalizedPath(path),
        getVaultPath: path => host.getVaultPath?.(path) ?? path,
    };
    const refreshService = new SyncStatusRefreshService(refreshDependencies, statuses);
    const workspace = new SyncManagerWorkspace({
        manager: () => host.sync,
        gitService: () => host.gitService,
        settings: () => host.settings,
        refreshService,
        diffService: new SyncDiffService(statuses, (sha, path) => host.gitService.getBlob(sha, path)),
        normalizePath: path => host.getNormalizedPath(path),
        app,
    });
    return { workspace, refreshService };
}
