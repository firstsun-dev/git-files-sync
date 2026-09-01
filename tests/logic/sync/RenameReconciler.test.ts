import { describe, expect, it, vi } from 'vitest';
import { RenameReconciler } from '../../../src/logic/sync/RenameReconciler';
import type { RenameReconcilerDependencies } from '../../../src/logic/sync/RenameReconciler';
import { SyncStatusService } from '../../../src/logic/sync-status-service';
import { gitBlobSha } from '../../../src/utils/git-blob-sha';

function buildReconciler(statuses: SyncStatusService, deps: Partial<RenameReconcilerDependencies> = {}): {
    reconciler: RenameReconciler;
    trackRename: ReturnType<typeof vi.fn>;
    refreshFileStatus: ReturnType<typeof vi.fn>;
} {
    const trackRename = vi.fn().mockResolvedValue(undefined);
    const refreshFileStatus = vi.fn().mockResolvedValue(undefined);
    const base: RenameReconcilerDependencies = {
        settings: () => ({ syncMetadata: {} }) as never,
        syncManager: () => ({ trackRename }) as never,
        refreshFileStatus,
    };
    return { reconciler: new RenameReconciler({ ...base, ...deps }, statuses), trackRename, refreshFileStatus };
}

describe('RenameReconciler', () => {
    describe('reconcileOutOfBandMoves', () => {
        it('tracks a rename when exactly one orphaned tracked path matches exactly one unsynced local file by blob sha', async () => {
            const statuses = new SyncStatusService();
            const content = 'moved content';
            const sha = await gitBlobSha(content);
            statuses.set({ path: 'old.md', status: 'local-deleted' });
            statuses.set({ path: 'new.md', status: 'unsynced', localContent: content });
            const remoteMap = new Map([
                ['old.md', { path: 'old.md', sha, symlink: false }],
            ]);
            const { reconciler, trackRename, refreshFileStatus } = buildReconciler(statuses, {
                settings: () => ({ syncMetadata: { 'old.md': { lastSyncedSha: sha, lastSyncedAt: 1 } } }) as never,
            });

            await reconciler.reconcileOutOfBandMoves(remoteMap);

            expect(trackRename).toHaveBeenCalledWith('new.md', 'old.md');
            expect(statuses.has('old.md')).toBe(false);
            expect(refreshFileStatus).toHaveBeenCalledWith('new.md', undefined);
        });

        it('does nothing when a sha has more than one orphaned candidate (ambiguous match)', async () => {
            const statuses = new SyncStatusService();
            const content = 'moved content';
            const sha = await gitBlobSha(content);
            statuses.set({ path: 'old-a.md', status: 'local-deleted' });
            statuses.set({ path: 'old-b.md', status: 'local-deleted' });
            statuses.set({ path: 'new.md', status: 'unsynced', localContent: content });
            const remoteMap = new Map([
                ['old-a.md', { path: 'old-a.md', sha, symlink: false }],
                ['old-b.md', { path: 'old-b.md', sha, symlink: false }],
            ]);
            const { reconciler, trackRename } = buildReconciler(statuses, {
                settings: () => ({
                    syncMetadata: {
                        'old-a.md': { lastSyncedSha: sha, lastSyncedAt: 1 },
                        'old-b.md': { lastSyncedSha: sha, lastSyncedAt: 1 },
                    },
                }) as never,
            });

            await reconciler.reconcileOutOfBandMoves(remoteMap);

            expect(trackRename).not.toHaveBeenCalled();
        });

        it('ignores an orphan candidate that is itself a pending move source (renamedFrom set)', async () => {
            const statuses = new SyncStatusService();
            const content = 'content';
            const sha = await gitBlobSha(content);
            statuses.set({ path: 'old.md', status: 'local-deleted' });
            statuses.set({ path: 'new.md', status: 'unsynced', localContent: content });
            const remoteMap = new Map([
                ['old.md', { path: 'old.md', sha, symlink: false }],
            ]);
            const { reconciler, trackRename } = buildReconciler(statuses, {
                settings: () => ({
                    syncMetadata: { 'old.md': { lastSyncedSha: sha, lastSyncedAt: 1, renamedFrom: 'older.md' } },
                }) as never,
            });

            await reconciler.reconcileOutOfBandMoves(remoteMap);

            expect(trackRename).not.toHaveBeenCalled();
        });
    });

    describe('pendingMoveOldPaths', () => {
        it('collects every renamedFrom source path currently on record', () => {
            const statuses = new SyncStatusService();
            const { reconciler } = buildReconciler(statuses, {
                settings: () => ({
                    syncMetadata: {
                        'a.md': { lastSyncedSha: 'x', lastSyncedAt: 1, renamedFrom: 'a-old.md' },
                        'b.md': { lastSyncedSha: 'y', lastSyncedAt: 1 },
                    },
                }) as never,
            });

            expect(reconciler.pendingMoveOldPaths()).toEqual(new Set(['a-old.md']));
        });
    });
});
