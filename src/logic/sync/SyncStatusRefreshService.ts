import { type App, TFile } from 'obsidian';
import type { GitLabFilesPushSettings } from '../../settings';
import type { GitignoreManager } from '../gitignore-manager';
import { type FileStatus, SyncStatusService } from '../sync-status-service';
import type { GitServiceInterface, GitTreeEntry } from '../../services/git-service-interface';
import { gitBlobSha } from '../../utils/git-blob-sha';
import { logger } from '../../utils/logger';
import { isBinaryPath } from '../../utils/path';
import type { SyncManager } from './SyncManager';
import { SyncFileDiscovery } from './SyncFileDiscovery';
import { SyncStatusResolver } from './SyncStatusResolver';
import { RenameReconciler } from './RenameReconciler';

export interface SyncStatusRefreshDependencies {
    app: App;
    settings: () => GitLabFilesPushSettings;
    gitService: () => GitServiceInterface;
    gitignoreManager: () => GitignoreManager;
    syncManager: () => SyncManager;
    filterFilesByVaultFolder(files: TFile[]): TFile[];
    filterPathByVaultFolder(path: string): boolean;
    getNormalizedPath(path: string): string;
    getVaultPath(path: string): string;
}

export interface SyncStatusRefreshProgress {
    current: number;
    total: number;
}

export interface SyncStatusRefreshResult {
    localCount: number;
    remoteCount: number;
    remoteHead?: string;
    remoteEntries: GitTreeEntry[];
}

/**
 * Orchestrates a full status refresh — discovery → resolve → reconcile
 * renames → publish — and owns the incremental create/modify/delete/rename
 * handlers used between full refreshes. Discovery, status resolution, and
 * rename reconciliation each live in their own collaborator; this class
 * deliberately exposes no rendering or notification concepts.
 */
export class SyncStatusRefreshService {
    private readonly discovery: SyncFileDiscovery;
    private readonly resolver: SyncStatusResolver;
    private readonly renameReconciler: RenameReconciler;

    /** Per-path monotonic revision ordering async content writes (create read vs a raced modify). */
    private readonly contentRevisions = new Map<string, number>();

    constructor(
        private readonly dependencies: SyncStatusRefreshDependencies,
        private readonly statuses: SyncStatusService,
    ) {
        this.discovery = new SyncFileDiscovery(dependencies, statuses);
        this.resolver = new SyncStatusResolver(dependencies, statuses);
        this.renameReconciler = new RenameReconciler(
            {
                settings: dependencies.settings,
                syncManager: dependencies.syncManager,
                refreshFileStatus: (path, remoteEntry) => this.resolver.refreshFileStatus(path, remoteEntry),
            },
            statuses,
        );
    }

    async refresh(onProgress?: (progress: SyncStatusRefreshProgress) => void): Promise<SyncStatusRefreshResult> {
        this.statuses.clear();
        const files = await this.discovery.discoverFiles();
        this.discovery.initializeFileStatuses(files.local);
        for (const hiddenPath of files.hiddenLocalPaths) {
            this.statuses.set(hiddenPath, { path: hiddenPath, status: 'checking' });
        }
        const extra = await this.discovery.identifyExtraFiles(
            files.remoteMap,
            files.localMap,
            files.allMap,
            this.renameReconciler.pendingMoveOldPaths(),
        );
        this.addExtraToStatuses(extra);

        const filesToCheck = this.discovery.getCheckableFiles(files.local, extra, files.hiddenLocalPaths);
        await this.resolver.performStatusCheck(filesToCheck, files.remoteMap, onProgress);
        await this.renameReconciler.reconcileOutOfBandMoves(files.remoteMap);

        return {
            localCount: files.local.length + files.hiddenLocalPaths.size,
            remoteCount: files.remoteMap.size,
            remoteHead: files.remoteHead,
            remoteEntries: files.remoteEntries,
        };
    }

    /**
     * Handles an out-of-band local create so a brand-new file appears in the
     * Source Control view immediately rather than waiting for the next full
     * refresh. The file is published in two resilient steps:
     *
     * 1. The `unsynced` (local-only) row is published *immediately* without
     *    content, so the row is visible even if the subsequent read fails
     *    (its stat stays pending — never cached — until content lands).
     * 2. The file content is read asynchronously; on success the row is
     *    republished with `localContent` so its `+N` stat can compute, on
     *    failure only a warning is logged (a later modify/full refresh
     *    retries the read).
     *
     * A per-path async revision guards the republish against racing
     * create → modify/delete/rename events: the read's result is applied
     * only if the path still exists in the map under the same file object
     * (a delete/rename re-keys or removes it) and is still the newest
     * pending read for that path, so an old read cannot clobber a newer
     * one's content.
     *
     * No-op when the path is already tracked (a `modify`/`rename` event will
     * have handled it) or falls outside the configured vault folder. Returns
     * whether the status map changed, so a caller can skip a republish.
     */
    async handleFileCreated(file: TFile): Promise<boolean> {
        if (this.statuses.has(file.path) || !this.dependencies.filterPathByVaultFolder(file.path)) return false;
        const revision = this.bumpContentRevision(file.path);
        this.statuses.set(file.path, {
            file,
            path: file.path,
            status: this.statuses.classify({ localExists: true, remoteExists: false }),
        });
        void this.resolver.readFileContent(file, isBinaryPath(file.path), false).then(localContent => {
            const current = this.statuses.get(file.path);
            if (!current
                || current.file !== file
                || this.contentRevisions.get(file.path) !== revision) return;
            this.statuses.set(file.path, { ...current, localContent });
        }).catch(error => {
            logger.warn(`Failed to read created file ${file.path}; its row stays pending until the next refresh`, error);
        });
        return true;
    }

    async handleFileModified(file: TFile): Promise<boolean> {
        const existing = this.statuses.get(file.path);
        if (!existing || !['synced', 'modified', 'unsynced', 'moved'].includes(existing.status)) return false;
        const revision = this.bumpContentRevision(file.path);
        const localContent = await this.resolver.readFileContent(file, isBinaryPath(file.path), false);
        // A create's slow async read may still be in flight behind this
        // modify; only the newest read may write.
        if (this.contentRevisions.get(file.path) !== revision) return true;
        // Re-read AFTER the await: a full refresh may have completed while
        // the read was pending and replaced the row's remoteSha/
        // remoteContent/isSymlink/movedFrom. Classifying from the stale
        // pre-await snapshot would write that old state back over the fresh
        // refresh result; the row may even no longer exist (deleted/renamed
        // away while pending) — in both cases the snapshot must be abandoned.
        const current = this.statuses.get(file.path);
        if (!current || current.file !== file) return true;
        let status: FileStatus['status'] = current.status;
        if (current.status !== 'moved') {
            const remoteSha = current.remoteSha;
            if (remoteSha === undefined) {
                status = this.statuses.classify({ localExists: true, remoteExists: false });
            } else {
                const localSha = await gitBlobSha(localContent);
                status = this.statuses.classify({
                    localExists: true,
                    remoteExists: true,
                    contentsEqual: localSha === remoteSha,
                    ...this.resolver.diffDirection(file.path, localSha, remoteSha),
                });
            }
        }
        this.statuses.set(file.path, { ...current, status, localContent });
        return true;
    }

    handleFileRenamed(file: TFile, oldPath: string): boolean {
        const existing = this.statuses.get(oldPath);
        this.contentRevisions.delete(oldPath);
        if (!existing || existing.status === 'checking') return false;
        this.statuses.delete(oldPath);
        if (!this.dependencies.filterPathByVaultFolder(file.path)) return true;

        const renamedFrom = this.dependencies.settings().syncMetadata?.[file.path]?.renamedFrom;
        if (renamedFrom !== undefined) {
            this.statuses.set(file.path, {
                file,
                path: file.path,
                status: this.statuses.classify({ movedFrom: renamedFrom }),
                movedFrom: renamedFrom,
                remoteSha: existing.remoteSha,
                localContent: existing.localContent,
                isSymlink: existing.isSymlink,
            });
        } else {
            this.statuses.set(file.path, { ...existing, file, path: file.path });
        }
        return true;
    }

    /**
     * Handles an out-of-band local delete of a previously known file so the
     * Source Control view reflects it immediately rather than waiting for the
     * next full refresh.
     *
     * - A *tracked* file removed locally (`synced`/`modified`) is marked
     *   `local-deleted`: the remote still holds it, so this is a potential
     *   remote deletion, distinct from a never-tracked `remote-only` file.
     * - A *local-only* (`unsynced`) file simply drops out of the status map —
     *   nothing on the remote to delete or restore, so there's no change to
     *   surface.
     * - A tracked *move* (`moved`) abandons its move: the row is dropped and a
     *   later refresh reconciles the old remote path (still on the remote,
     *   metadata relocated by `trackRename`) as `remote-only`/`local-deleted`.
     * - A `remote-only`/`local-deleted`/`checking` row is left untouched
     *   (nothing local existed to delete, or it's still resolving).
     *
     * Returns whether the status map changed, so a caller can skip a
     * republish when nothing moved.
     */
    handleFileDeleted(path: string): boolean {
        const existing = this.statuses.get(path);
        this.contentRevisions.delete(path);
        if (!existing || existing.status === 'checking' || existing.status === 'remote-only' || existing.status === 'local-deleted') return false;
        if (existing.status === 'moved') {
            this.statuses.delete(path);
            return true;
        }
        if (existing.status === 'unsynced') {
            this.statuses.delete(path);
            return true;
        }
        // synced / modified: tracked, remote still holds this path -> local-deleted.
        this.statuses.set(path, { ...existing, status: 'local-deleted', localContent: undefined });
        return true;
    }

    /** Monotonic per-path counter ordering async content reads so only the newest one may write. */
    private bumpContentRevision(path: string): number {
        const next = (this.contentRevisions.get(path) ?? 0) + 1;
        this.contentRevisions.set(path, next);
        return next;
    }

    private addExtraToStatuses(extra: Array<TFile | string>): void {
        for (const item of extra) {
            const path = typeof item === 'string' ? item : item.path;
            this.statuses.set(path, {
                file: typeof item === 'string' ? undefined : item,
                path,
                status: 'checking',
            });
        }
    }
}
