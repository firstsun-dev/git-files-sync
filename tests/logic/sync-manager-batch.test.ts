/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { SyncManager, BatchPushConflict, ConflictResolution } from '../../src/logic/sync-manager';
import { App, DataAdapter, TFile } from 'obsidian';
import { GitLabFilesPushSettings } from '../../src/settings';
import { GitServiceInterface } from '../../src/services/git-service-interface';
import { gitBlobSha } from '../../src/utils/git-blob-sha';
import { SyncPlanModal, SyncPlanDirection } from '../../src/ui/SyncPlanModal';
import { BatchConflictResolutionModal } from '../../src/ui/BatchConflictResolutionModal';

vi.mock('obsidian');
// Every push/pull-all now shows a plan for review before applying;
// auto-confirm it here since these tests exercise batch mechanics, not the modal.
vi.mock('../../src/ui/SyncPlanModal');
vi.mock('../../src/ui/BatchConflictResolutionModal');

describe('SyncManager Batch Operations', () => {
    let manager: SyncManager;
    let mockApp: Mocked<App>;
    let mockGitService: Mocked<GitServiceInterface>;
    let mockSettings: GitLabFilesPushSettings;
    /** How the mocked BatchConflictResolutionModal resolves each conflict by default; override per-test. Defaults to 'skip', matching the old silent-skip behavior for tests that don't care about conflict resolution specifics. */
    let conflictResolver: (conflict: BatchPushConflict) => ConflictResolution;

    beforeEach(() => {
        vi.clearAllMocks();
        conflictResolver = () => 'skip';
        vi.mocked(SyncPlanModal).mockImplementation(function (
            this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, onConfirm: () => void
        ) {
            onConfirm();
            return this;
        } as never);
        vi.mocked(BatchConflictResolutionModal).mockImplementation(function (
            this: BatchConflictResolutionModal,
            _app: unknown,
            _gitService: unknown,
            conflicts: BatchPushConflict[],
            _totalFiles: number,
            _safeCount: number,
            onResolve: () => void,
            _onCancel: () => void,
        ) {
            for (const conflict of conflicts) conflict.resolution = conflictResolver(conflict);
            onResolve();
            return this;
        } as never);

        const mockAdapter = {
            exists: vi.fn(),
            read: vi.fn(),
            write: vi.fn(),
            readBinary: vi.fn(),
            writeBinary: vi.fn(),
        } as unknown as Mocked<DataAdapter>;

        mockApp = {
            vault: {
                read: vi.fn(),
                modify: vi.fn(),
                getFileByPath: vi.fn(),
                adapter: mockAdapter,
            },
            workspace: {
                getActiveFile: vi.fn(),
                detachLeavesOfType: vi.fn(),
            }
        } as unknown as Mocked<App>;

        mockGitService = {
            pushFile: vi.fn(),
            getFile: vi.fn(),
            getBlob: vi.fn(),
            testConnection: vi.fn(),
            listFiles: vi.fn(),
            listFilesDetailed: vi.fn().mockResolvedValue([]),
            deleteFile: vi.fn(),
            getRepoGitignores: vi.fn(),
            updateConfig: vi.fn(),
        } as unknown as Mocked<GitServiceInterface>;

        mockSettings = {
            serviceType: 'github',
            githubToken: 'token',
            githubOwner: 'owner',
            githubRepo: 'repo',
            branch: 'main',
            syncMetadata: {},
        } as unknown as GitLabFilesPushSettings;

        manager = new SyncManager(mockApp, mockGitService, mockSettings);
        // @ts-ignore - accessing private for test
        manager.saveSettings = vi.fn().mockResolvedValue(undefined);
    });

    describe('pushAllFiles', () => {
        it('should push multiple files correctly (strings and TFiles)', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'file2.md', name: 'file2.md' });
            const files = ['file1.md', mockFile];
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('content1');
            vi.mocked(mockApp.vault.read).mockResolvedValue('content2');
            vi.mocked(mockApp.vault.getFileByPath).mockReturnValue(mockFile);
            
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'diff', sha: 'old-sha' });
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: 'path', sha: 'new-sha' });

            const results = await manager.pushAllFiles(files);

            expect(results.success).toBe(2);
            expect(vi.mocked(mockGitService.pushFile)).toHaveBeenCalledTimes(2);
        });

        it('should handle failures during batch push', async () => {
            const files = ['good.md', 'bad.md'];
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('content');
            
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'diff', sha: 'old-sha' });
            
            vi.mocked(mockGitService.pushFile)
                .mockResolvedValueOnce({ path: 'path', sha: 'new-sha' })
                .mockRejectedValueOnce(new Error('Push failed'));

            const results = await manager.pushAllFiles(files);

            expect(results.success).toBe(1);
            expect(results.failed).toBe(1);
            expect(results.errors[0]!.file).toBe('bad.md');
        });
    });

    describe('batch commit via gitService.pushBatch', () => {
        it('groups all queued files into one pushBatch call when the provider supports it', async () => {
            const files = ['a.md', 'b.md'];
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockImplementation(async (p) => (p === 'a.md' ? 'content-a' : 'content-b'));
            // No tree entries: both files are new, so both are queued.
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([]);
            mockGitService.pushBatch = vi.fn().mockResolvedValue([
                { path: 'a.md', sha: 'sha-a' },
                { path: 'b.md', sha: 'sha-b' },
            ]);

            const results = await manager.pushAllFiles(files);

            expect(results.success).toBe(2);
            expect(results.failed).toBe(0);
            expect(mockGitService.pushBatch).toHaveBeenCalledTimes(1);
            expect(mockGitService.pushFile).not.toHaveBeenCalled();
            const [items] = vi.mocked(mockGitService.pushBatch).mock.calls[0]!;
            expect(items).toEqual([
                { path: 'a.md', content: 'content-a', existedRemotely: false },
                { path: 'b.md', content: 'content-b', existedRemotely: false },
            ]);
            // syncedPaths lets the caller mark these files synced directly, without
            // a follow-up remote read that could race a provider's eventual
            // consistency window (see SyncStatusView's use of this field).
            expect(results.syncedPaths).toEqual([
                { path: 'a.md', sha: 'sha-a' },
                { path: 'b.md', sha: 'sha-b' },
            ]);
        });

        it('reads and forwards GitLab revision for an existing batch update', async () => {
            const path = 'locked.md';
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            mockSettings.serviceType = 'gitlab';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'remote-blob', lastSyncedAt: 0, lastKnownPath: path }
            };
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('local edit');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([{ path, symlink: false, sha: 'remote-blob' }]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'remote original', sha: 'remote-blob', revision: 'remote-commit' });
            mockGitService.pushBatch = vi.fn().mockResolvedValue([{ path, sha: 'new-blob' }]);

            const results = await manager.pushAllFiles([path]);

            expect(results.success).toBe(1);
            expect(mockGitService.pushBatch).toHaveBeenCalledWith([
                { path, content: 'local edit', existedRemotely: true, revision: 'remote-commit' },
            ], 'main', expect.any(String));
        });

        it('reports syncedPaths via the sequential fallback when the provider has no pushBatch', async () => {
            const files = ['a.md', 'b.md'];
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockImplementation(async (p) => (p === 'a.md' ? 'content-a' : 'content-b'));
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([]);
            mockGitService.pushBatch = undefined;
            vi.mocked(mockGitService.pushFile).mockImplementation(async (path) => ({ path, sha: `sha-${path}` }));

            const results = await manager.pushAllFiles(files);

            expect(results.success).toBe(2);
            expect(mockGitService.pushFile).toHaveBeenCalledTimes(2);
            expect(results.syncedPaths).toEqual([
                { path: 'a.md', sha: 'sha-a.md' },
                { path: 'b.md', sha: 'sha-b.md' },
            ]);
        });

        it('handles a mixed binary + text batch, computing blob shas for both', async () => {
            const files = ['note.md', 'image.png'];
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('text content');
            vi.mocked(adapter.readBinary).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([]);
            mockGitService.pushBatch = vi.fn().mockResolvedValue([
                { path: 'note.md', sha: 'sha-note' },
                { path: 'image.png', sha: 'sha-image' },
            ]);

            const results = await manager.pushAllFiles(files);

            expect(results.success).toBe(2);
            expect(mockGitService.pushBatch).toHaveBeenCalledTimes(1);
        });

        it('marks every file in a failed chunk as failed, not dropped', async () => {
            const files = ['a.md', 'b.md'];
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('content');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([]);
            mockGitService.pushBatch = vi.fn().mockRejectedValue(new Error('commit failed'));

            const results = await manager.pushAllFiles(files);

            expect(results.success).toBe(0);
            expect(results.failed).toBe(2);
            expect(results.errors).toEqual([
                { file: 'a.md', error: 'commit failed' },
                { file: 'b.md', error: 'commit failed' },
            ]);
            expect(results.syncedPaths).toEqual([]);
        });

        it('skips both getFile and pushBatch when the local blob sha already matches the tree', async () => {
            const path = 'unchanged.md';
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('same content');

            // Compute the real git blob sha for the content so it matches the tree entry.
            const { gitBlobSha } = await import('../../src/utils/git-blob-sha');
            const sha = await gitBlobSha('same content');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([{ path, symlink: false, sha }]);
            mockGitService.pushBatch = vi.fn();

            const results = await manager.pushAllFiles([path]);

            expect(results.success).toBe(0);
            expect(results.conflicts).toBe(0);
            expect(results.failed).toBe(0);
            expect(mockGitService.getFile).not.toHaveBeenCalled();
            expect(mockGitService.pushBatch).not.toHaveBeenCalled();
            expect(mockSettings.syncMetadata[path]?.lastSyncedSha).toBe(sha);
        });
    });

    describe('batch push metadata', () => {
        it('records the local blob sha when the provider returns no per-file sha', async () => {
            // GitHub's createCommitOnBranch reports only the commit oid, so
            // pushBatch resolves with { path } alone. Skipping the metadata
            // update there leaves lastSyncedSha at the pre-push value, and the
            // next push then reads the remote as moved and skips the file as a
            // conflict.
            const path = 'note.md';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'sha-before-push', lastSyncedAt: 0, lastKnownPath: path }
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('edited content');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path, symlink: false, sha: 'sha-before-push' }
            ]);
            mockGitService.pushBatch = vi.fn().mockResolvedValue([{ path }]);

            const results = await manager.pushAllFiles([path]);

            expect(results.success).toBe(1);
            expect(mockSettings.syncMetadata[path]?.lastSyncedSha).toBe(await gitBlobSha('edited content'));
        });
    });

    describe('pullAllAllFiles', () => {
        it('should pull multiple files correctly (strings and TFiles)', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'file2.md', name: 'file2.md' });
            const files = ['file1.md', mockFile];
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'remote content', sha: 'new-sha' });
            vi.mocked(adapter.exists).mockResolvedValue(true);
            // Tree entries without a sha, so the pull still goes through content.
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path: 'file1.md', symlink: false }, { path: 'file2.md', symlink: false }
            ]);

            const results = await manager.pullAllFiles(files);

            expect(results.success).toBe(2);
            expect(vi.mocked(adapter.write)).toHaveBeenCalledWith('file1.md', 'remote content');
            expect(vi.mocked(mockApp.vault.modify)).toHaveBeenCalledWith(mockFile, 'remote content');
        });

        it('skips downloading a file whose tree sha already matches the local content', async () => {
            // An in-sync "pull all" used to fetch every file's content just to
            // discover nothing changed — one request per file, whole vault.
            const path = 'unchanged.md';
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('same content');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path, symlink: false, sha: await gitBlobSha('same content') }
            ]);

            const results = await manager.pullAllFiles([path]);

            expect(results.success).toBe(0);
            expect(results.failed).toBe(0);
            expect(mockGitService.getFile).not.toHaveBeenCalled();
            expect(adapter.write).not.toHaveBeenCalled();
            expect(mockSettings.syncMetadata[path]?.lastSyncedSha).toBe(await gitBlobSha('same content'));
        });

        it('reports a diverged local file as a conflict without downloading it', async () => {
            const path = 'conflicted.md';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'sha-at-last-sync', lastSyncedAt: 0, lastKnownPath: path }
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('local edit');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path, symlink: false, sha: 'sha-changed-on-remote' }
            ]);

            const results = await manager.pullAllFiles([path]);

            expect(results.conflicts).toBe(1);
            expect(mockGitService.getFile).not.toHaveBeenCalled();
            expect(adapter.write).not.toHaveBeenCalled();
        });

        it('migrates a legacy GitLab last_commit_id baseline instead of creating a false pull conflict', async () => {
            const path = 'legacy.md';
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            mockSettings.serviceType = 'gitlab';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'legacy-last-commit', lastSyncedAt: 0, lastKnownPath: path }
            };
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('local old copy');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([{ path, symlink: false, sha: 'remote-blob' }]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'remote current copy', sha: 'remote-blob', revision: 'legacy-last-commit' });

            const results = await manager.pullAllFiles([path]);

            expect(results.conflicts).toBe(0);
            expect(results.success).toBe(1);
            expect(mockSettings.syncMetadata[path]?.lastSyncedSha).toBe('remote-blob');
        });

        it('still downloads when the local file differs and the remote has not moved', async () => {
            const path = 'stale.md';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'remote-sha', lastSyncedAt: 0, lastKnownPath: path }
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('older local copy');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path, symlink: false, sha: 'remote-sha' }
            ]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'remote content', sha: 'remote-sha' });

            const results = await manager.pullAllFiles([path]);

            expect(results.success).toBe(1);
            expect(mockGitService.getFile).toHaveBeenCalledWith(path, 'main');
            expect(adapter.write).toHaveBeenCalledWith(path, 'remote content');
        });

        it('falls back to per-file fetches when the tree read fails', async () => {
            const path = 'file.md';
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('local');
            vi.mocked(mockGitService.listFilesDetailed).mockRejectedValue(new Error('network down'));
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'remote content', sha: 'remote-sha' });

            const results = await manager.pullAllFiles([path]);

            expect(results.success).toBe(1);
            expect(mockGitService.getFile).toHaveBeenCalledWith(path, 'main');
        });

        it('should handle missing remote files during batch pull', async () => {
            const files = ['exists.md', 'missing.md'];

            vi.mocked(mockGitService.getFile)
                .mockResolvedValueOnce({ content: 'content', sha: 'sha' })
                .mockResolvedValueOnce({ content: '', sha: '' });
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path: 'exists.md', symlink: false }
            ]);

            const results = await manager.pullAllFiles(files);

            expect(results.success).toBe(1);
            expect(results.failed).toBe(1);
            expect(results.errors[0]!.error).toContain('File not found in remote');
        });
    });

    describe('onProgress callback', () => {
        it('should call onProgress for each file processed', async () => {
            const files = ['file1.md', 'file2.md', 'file3.md'];
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('content');
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'diff', sha: 'sha' });
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: 'path', sha: 'new' });

            const onProgress = vi.fn();
            await manager.pushAllFiles(files, onProgress);

            expect(onProgress).toHaveBeenCalledTimes(3);
            expect(onProgress).toHaveBeenCalledWith(1, 3, 'file1.md');
            expect(onProgress).toHaveBeenCalledWith(2, 3, 'file2.md');
            expect(onProgress).toHaveBeenCalledWith(3, 3, 'file3.md');
        });
    });

    describe('batch conflict detection', () => {
        it('should skip (not overwrite) a push when the remote has moved on since last sync', async () => {
            const path = 'conflicted.md';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'sha-at-last-sync', lastSyncedAt: 0, lastKnownPath: path }
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('local edit');
            // Remote tree entry's sha differs from what we last synced.
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path, symlink: false, sha: 'sha-changed-on-remote' }
            ]);

            const results = await manager.pushAllFiles([path]);

            expect(results.success).toBe(0);
            expect(results.conflicts).toBe(1);
            expect(results.failed).toBe(0);
            expect(mockGitService.pushFile).not.toHaveBeenCalled();
            expect(mockGitService.getFile).not.toHaveBeenCalled();
        });

        it('should skip (not overwrite) a pull when the local file has diverged since last sync', async () => {
            const path = 'conflicted.md';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'sha-at-last-sync', lastSyncedAt: 0, lastKnownPath: path }
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('local edit');
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'remote edit', sha: 'sha-changed-on-remote' });
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([{ path, symlink: false }]);

            const results = await manager.pullAllFiles([path]);

            expect(results.success).toBe(0);
            expect(results.conflicts).toBe(1);
            expect(results.failed).toBe(0);
            expect(mockApp.vault.adapter.write).not.toHaveBeenCalled();
        });

        it('should still push normally when there is no prior sync metadata (not a conflict)', async () => {
            const path = 'new-file.md';
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;

            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('local content');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path, symlink: false, sha: 'some-sha' }
            ]);
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path, sha: 'new-sha' });

            const results = await manager.pushAllFiles([path]);

            expect(results.success).toBe(1);
            expect(results.conflicts).toBe(0);
            expect(mockGitService.pushFile).toHaveBeenCalledWith(path, 'local content', 'main', expect.any(String), 'some-sha', undefined);
        });
    });

    describe('batch conflict resolution', () => {
        it('merges a "keep local" conflict into the single atomic commit, and applies "keep remote" locally only after it succeeds, leaving a skipped conflict untouched', async () => {
            const safePath = 'safe.md';
            const localPath = 'local-wins.md';
            const remotePath = 'remote-wins.md';
            const skipPath = 'left-alone.md';

            mockSettings.syncMetadata = {
                [localPath]: { lastSyncedSha: 'base-local', lastSyncedAt: 0, lastKnownPath: localPath },
                [remotePath]: { lastSyncedSha: 'base-remote', lastSyncedAt: 0, lastKnownPath: remotePath },
                [skipPath]: { lastSyncedSha: 'base-skip', lastSyncedAt: 0, lastKnownPath: skipPath },
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockImplementation(async (p) => {
                if (p === safePath) return 'new safe content';
                if (p === localPath) return 'local edit';
                if (p === remotePath) return 'local stale edit';
                return 'local skip edit';
            });
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path: localPath, symlink: false, sha: 'remote-moved-local' },
                { path: remotePath, symlink: false, sha: 'remote-moved-remote' },
                { path: skipPath, symlink: false, sha: 'remote-moved-skip' },
            ]);
            // The pre-commit snapshot re-check reads this for the "keep local" path.
            vi.mocked(mockGitService.getFile).mockImplementation(async (repoPath) => (
                repoPath === localPath ? { content: '', sha: 'remote-moved-local' } : { content: '', sha: '' }
            ));
            vi.mocked(mockGitService.getBlob).mockResolvedValue({ content: 'remote reviewed content', sha: 'remote-moved-remote' });
            mockGitService.pushBatch = vi.fn().mockResolvedValue([
                { path: safePath, sha: 'sha-safe' },
                { path: localPath, sha: 'sha-local' },
            ]);

            conflictResolver = (c) => {
                if (c.path === localPath) return 'keep-local';
                if (c.path === remotePath) return 'keep-remote';
                return 'skip';
            };

            const results = await manager.pushAllFiles([safePath, localPath, remotePath, skipPath]);

            // Exactly one atomic remote commit, containing the safe file and the
            // "keep local" resolution -- never a separate commit for conflicts.
            expect(mockGitService.pushBatch).toHaveBeenCalledTimes(1);
            const [items] = vi.mocked(mockGitService.pushBatch).mock.calls[0]!;
            expect(items).toHaveLength(2);
            expect(items).toEqual(expect.arrayContaining([
                { path: safePath, content: 'new safe content', existedRemotely: false },
                { path: localPath, content: 'local edit', existedRemotely: true, revision: undefined },
            ]));

            // "Keep remote" is written locally only after that commit succeeded.
            expect(mockApp.vault.adapter.write).toHaveBeenCalledWith(remotePath, 'remote reviewed content');
            expect(mockSettings.syncMetadata[remotePath]?.lastSyncedSha).toBe('remote-moved-remote');

            // The skipped conflict is left exactly as it was.
            expect(mockSettings.syncMetadata[skipPath]?.lastSyncedSha).toBe('base-skip');

            expect(results.success).toBe(2);
            expect(results.resolvedConflicts).toBe(2);
            expect(results.skippedConflicts).toBe(1);
            expect(results.failed).toBe(0);
            expect(results.cancelled).toBeUndefined();
        });

        it('"Keep Local for All" turns every conflict into an ordinary batch update -- one commit, zero single-file pushes', async () => {
            const paths = ['a.md', 'b.md', 'c.md'];
            mockSettings.syncMetadata = Object.fromEntries(
                paths.map(p => [p, { lastSyncedSha: `base-${p}`, lastSyncedAt: 0, lastKnownPath: p }])
            );
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockImplementation(async (p) => `local-${p}`);
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue(
                paths.map(p => ({ path: p, symlink: false, sha: `remote-${p}` }))
            );
            vi.mocked(mockGitService.getFile).mockImplementation(async (repoPath) => ({ content: '', sha: `remote-${repoPath}` }));
            mockGitService.pushBatch = vi.fn().mockResolvedValue(paths.map(p => ({ path: p, sha: `new-${p}` })));

            conflictResolver = () => 'keep-local';

            const results = await manager.pushAllFiles(paths);

            expect(mockGitService.pushBatch).toHaveBeenCalledTimes(1);
            expect(mockGitService.pushFile).not.toHaveBeenCalled();
            expect(results.success).toBe(3);
            expect(results.resolvedConflicts).toBe(3);
            expect(results.skippedConflicts).toBe(0);
        });

        it('"Keep Remote for All" never adds the conflicts as remote modifications, applies their reviewed content locally, and advances metadata to the reviewed sha', async () => {
            const paths = ['a.md', 'b.md'];
            mockSettings.syncMetadata = Object.fromEntries(
                paths.map(p => [p, { lastSyncedSha: `base-${p}`, lastSyncedAt: 0, lastKnownPath: p }])
            );
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockImplementation(async (p) => `local-${p}`);
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue(
                paths.map(p => ({ path: p, symlink: false, sha: `remote-${p}` }))
            );
            vi.mocked(mockGitService.getBlob).mockImplementation(async (sha) => ({ content: `content-for-${sha}`, sha }));

            conflictResolver = () => 'keep-remote';

            const results = await manager.pushAllFiles(paths);

            // Nothing to push remotely -- no pushBatch/pushFile call at all.
            expect(mockGitService.pushBatch).toBeUndefined();
            expect(mockGitService.pushFile).not.toHaveBeenCalled();
            for (const p of paths) {
                expect(mockApp.vault.adapter.write).toHaveBeenCalledWith(p, `content-for-remote-${p}`);
                expect(mockSettings.syncMetadata[p]?.lastSyncedSha).toBe(`remote-${p}`);
            }
            expect(results.resolvedConflicts).toBe(2);
            expect(results.success).toBe(0);
        });

        it('"Skip All" leaves every conflict untouched on both sides while still committing normal changes once', async () => {
            const safePath = 'safe.md';
            const paths = ['a.md', 'b.md'];
            mockSettings.syncMetadata = Object.fromEntries(
                paths.map(p => [p, { lastSyncedSha: `base-${p}`, lastSyncedAt: 0, lastKnownPath: p }])
            );
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockImplementation(async (p) => (p === safePath ? 'new safe content' : `local-${p}`));
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue(
                paths.map(p => ({ path: p, symlink: false, sha: `remote-${p}` }))
            );
            mockGitService.pushBatch = vi.fn().mockResolvedValue([{ path: safePath, sha: 'sha-safe' }]);

            conflictResolver = () => 'skip';

            const results = await manager.pushAllFiles([safePath, ...paths]);

            expect(mockGitService.pushBatch).toHaveBeenCalledTimes(1);
            const [items] = vi.mocked(mockGitService.pushBatch).mock.calls[0]!;
            expect(items).toEqual([{ path: safePath, content: 'new safe content', existedRemotely: false }]);
            for (const p of paths) {
                expect(mockSettings.syncMetadata[p]?.lastSyncedSha).toBe(`base-${p}`);
            }
            expect(mockApp.vault.adapter.write).not.toHaveBeenCalled();
            expect(results.skippedConflicts).toBe(2);
            expect(results.success).toBe(1);
        });

        it('cancelling the conflict resolution modal makes zero writes anywhere', async () => {
            const path = 'conflicted.md';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'base', lastSyncedAt: 0, lastKnownPath: path }
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('local edit');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path, symlink: false, sha: 'remote-moved' }
            ]);
            mockGitService.pushBatch = vi.fn();

            vi.mocked(BatchConflictResolutionModal).mockImplementation(function (
                this: BatchConflictResolutionModal,
                _app: unknown, _git: unknown, _conflicts: unknown, _total: unknown, _safe: unknown,
                _onResolve: () => void, onCancel: () => void
            ) {
                onCancel();
                return this;
            } as never);

            const results = await manager.pushAllFiles([path]);

            expect(mockGitService.pushBatch).not.toHaveBeenCalled();
            expect(mockGitService.pushFile).not.toHaveBeenCalled();
            expect(mockApp.vault.adapter.write).not.toHaveBeenCalled();
            expect(mockSettings.syncMetadata[path]?.lastSyncedSha).toBe('base');
            expect(results.cancelled).toBe(true);
            expect(SyncPlanModal).not.toHaveBeenCalled();
        });

        it('cancelling the final resolved-plan review makes zero writes anywhere', async () => {
            const path = 'conflicted.md';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'base', lastSyncedAt: 0, lastKnownPath: path }
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('local edit');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path, symlink: false, sha: 'remote-moved' }
            ]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: '', sha: 'remote-moved' });
            mockGitService.pushBatch = vi.fn();

            conflictResolver = () => 'keep-local';
            vi.mocked(SyncPlanModal).mockImplementation(function (
                this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, _onConfirm: () => void, onCancel?: () => void
            ) {
                onCancel?.();
                return this;
            } as never);

            const results = await manager.pushAllFiles([path]);

            expect(mockGitService.pushBatch).not.toHaveBeenCalled();
            expect(mockSettings.syncMetadata[path]?.lastSyncedSha).toBe('base');
            expect(results.cancelled).toBe(true);
        });

        it('a failed atomic commit leaves the accompanying "keep remote" conflict unapplied and metadata unchanged', async () => {
            const failingPath = 'fails.md';
            const remotePath = 'kept-remote.md';
            mockSettings.syncMetadata = {
                [failingPath]: { lastSyncedSha: 'base-fail', lastSyncedAt: 0, lastKnownPath: failingPath },
                [remotePath]: { lastSyncedSha: 'base-remote', lastSyncedAt: 0, lastKnownPath: remotePath },
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockImplementation(async (p) => (p === failingPath ? 'new content' : 'stale local'));
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path: remotePath, symlink: false, sha: 'remote-current' }
            ]);
            vi.mocked(mockGitService.getBlob).mockResolvedValue({ content: 'reviewed remote content', sha: 'remote-current' });
            mockGitService.pushBatch = vi.fn().mockRejectedValue(new Error('commit failed'));

            conflictResolver = (c) => (c.path === remotePath ? 'keep-remote' : 'skip');

            const results = await manager.pushAllFiles([failingPath, remotePath]);

            expect(mockApp.vault.adapter.write).not.toHaveBeenCalled();
            expect(mockSettings.syncMetadata[remotePath]?.lastSyncedSha).toBe('base-remote');
            expect(results.failed).toBeGreaterThan(0);
        });

        it('resolves a binary conflict without assuming text content', async () => {
            const path = 'image.png';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'base', lastSyncedAt: 0, lastKnownPath: path }
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            const localBuffer = new Uint8Array([1, 2, 3]).buffer;
            vi.mocked(adapter.readBinary).mockResolvedValue(localBuffer);
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path, symlink: false, sha: 'remote-moved' }
            ]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: '', sha: 'remote-moved' });
            mockGitService.pushBatch = vi.fn().mockResolvedValue([{ path, sha: 'new-sha' }]);

            conflictResolver = () => 'keep-local';

            const results = await manager.pushAllFiles([path]);

            expect(mockGitService.pushBatch).toHaveBeenCalledTimes(1);
            const [items] = vi.mocked(mockGitService.pushBatch).mock.calls[0]!;
            expect(items[0]!.content).toBe(localBuffer);
            expect(results.resolvedConflicts).toBe(1);
        });

        it('aborts safely, without committing, when the remote moved again after the conflict was reviewed', async () => {
            const path = 'reviewed.md';
            mockSettings.syncMetadata = {
                [path]: { lastSyncedSha: 'base', lastSyncedAt: 0, lastKnownPath: path }
            };
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('local edit');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path, symlink: false, sha: 'remote-at-plan-time' }
            ]);
            // Between planning and commit, the remote moved on again.
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: '', sha: 'remote-moved-again' });
            mockGitService.pushBatch = vi.fn();

            conflictResolver = () => 'keep-local';

            const results = await manager.pushAllFiles([path]);

            expect(mockGitService.pushBatch).not.toHaveBeenCalled();
            expect(mockSettings.syncMetadata[path]?.lastSyncedSha).toBe('base');
            expect(results.failed).toBeGreaterThan(0);
        });
    });

    describe('batch push avoids remote 404 probes', () => {
        it('skips stale rename metadata when the prefetched tree has no matching old path', async () => {
            const oldPath = 'src/content/blog/.agents/skills/blog-master/SKILL.md';
            const newPath = 'new.md';
            const mockFile = Object.assign(new TFile(), { path: newPath, name: newPath });
            mockSettings.syncMetadata = {
                [oldPath]: { lastSyncedSha: 'stale', lastSyncedAt: 0, lastKnownPath: oldPath },
            };
            vi.mocked(mockApp.vault.getFileByPath).mockImplementation(path => path === oldPath ? null : mockFile);
            vi.mocked(mockApp.vault.read).mockResolvedValue('new content');
            vi.mocked(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: newPath, sha: 'new-sha' });
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([]);

            await manager.pushAllFiles([mockFile]);

            expect(mockGitService.getFile).not.toHaveBeenCalled();
            expect(mockGitService.pushFile).toHaveBeenCalledWith(newPath, 'new content', 'main', expect.any(String), undefined, undefined);
        });
    });

    describe('batch push with rename detection', () => {
        it('should detect and handle rename during batch push', async () => {
            const oldPath = 'old.md';
            const newPath = 'new.md';
            const mockFile = Object.assign(new TFile(), { path: newPath, name: 'new.md' });
            mockSettings.syncMetadata = {
                [oldPath]: { lastSyncedSha: 'sha', lastSyncedAt: 0, lastKnownPath: oldPath }
            };

            vi.mocked(mockApp.vault.getFileByPath).mockImplementation(p => p === oldPath ? null : mockFile);
            vi.mocked(mockApp.vault.read).mockResolvedValue('content');
            vi.mocked(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: newPath, sha: 'new-sha' });
            const oldSha = await gitBlobSha('content');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([{ path: oldPath, symlink: false, sha: oldSha }]);
            vi.mocked(mockGitService.getFile).mockImplementation(async (path) => {
                // The old path is now confirmed by the pre-fetched tree; this mock is only used for the new path.
                if (path === oldPath) return { content: 'content', sha: 'sha' };
                // New path does not exist on the remote yet.
                return { content: '', sha: '' };
            });
            // Tree entry without a sha (a provider whose listing omits it), so the
            // rename is confirmed by the content probe above.
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([{ path: oldPath, symlink: false }]);

            const results = await manager.pushAllFiles([mockFile]);

            // A real move (mockGitService has no commitBatch, so this is the
            // sequential push-then-delete fallback): the new path is pushed
            // and the old path is removed, in one logical "move" step.
            expect(results.success).toBe(1);
            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                newPath, 'content', 'main', `Move ${oldPath} to ${newPath}`
            );
            expect(mockGitService.deleteFile).toHaveBeenCalledWith(
                oldPath, 'main', `Remove ${oldPath} (moved to ${newPath})`
            );
        });

        it('never silently overwrites when the rename target already exists remotely — surfaces a conflict instead', async () => {
            const oldPath = 'old.md';
            const newPath = 'new.md';
            const mockFile = Object.assign(new TFile(), { path: newPath, name: 'new.md' });
            mockSettings.syncMetadata = {
                [oldPath]: { lastSyncedSha: 'sha', lastSyncedAt: 0, lastKnownPath: oldPath }
            };

            vi.mocked(mockApp.vault.getFileByPath).mockImplementation(p => p === oldPath ? null : mockFile);
            vi.mocked(mockApp.vault.read).mockResolvedValue('content');
            vi.mocked(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            const oldSha = await gitBlobSha('content');
            // The tree confirms the rename (old path, matching content sha) and
            // also shows a different file already sitting at the new path.
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path: oldPath, symlink: false, sha: oldSha },
                { path: newPath, symlink: false, sha: 'remote-existing-sha' },
            ]);

            const results = await manager.pushAllFiles([mockFile]);

            expect(results.conflicts).toBe(1);
            expect(results.success).toBe(0);
            expect(mockGitService.pushFile).not.toHaveBeenCalled();
            expect(mockGitService.deleteFile).not.toHaveBeenCalled();
        });

        it('confirms a rename from the tree sha alone, without probing the old path', async () => {
            // The tree already carries every blob's sha, and contentsEqual is exact
            // equality, so a sha match is the same answer the content probe gives.
            const oldPath = 'old.md';
            const newPath = 'new.md';
            const mockFile = Object.assign(new TFile(), { path: newPath, name: 'new.md' });
            const contentSha = await gitBlobSha('content');
            mockSettings.syncMetadata = {
                // Matches the tree's current sha at the old path: the remote
                // hasn't moved on since the last sync, so deleting it is safe.
                [oldPath]: { lastSyncedSha: contentSha, lastSyncedAt: 0, lastKnownPath: oldPath }
            };

            vi.mocked(mockApp.vault.getFileByPath).mockImplementation(p => p === oldPath ? null : mockFile);
            vi.mocked(mockApp.vault.read).mockResolvedValue('content');
            vi.mocked(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: newPath, sha: 'new-sha' });
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: '', sha: '' });
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path: oldPath, symlink: false, sha: contentSha }
            ]);

            const results = await manager.pushAllFiles([mockFile]);

            expect(results.success).toBe(1);
            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                newPath, 'content', 'main', `Move ${oldPath} to ${newPath}`
            );
            expect(mockGitService.deleteFile).toHaveBeenCalledWith(
                oldPath, 'main', `Remove ${oldPath} (moved to ${newPath})`
            );
            expect(mockGitService.getFile).not.toHaveBeenCalledWith(oldPath, 'main');
        });

        it('does not misclassify an unrelated push as a rename just because an orphaned metadata entry exists', async () => {
            const orphanedPath = 'deleted-unrelated-note.md';
            const pushedPath = 'unrelated.md';
            const mockFile = Object.assign(new TFile(), { path: pushedPath, name: 'unrelated.md' });
            mockSettings.syncMetadata = {
                [orphanedPath]: { lastSyncedSha: 'orphaned-sha', lastSyncedAt: 0, lastKnownPath: orphanedPath }
            };

            vi.mocked(mockApp.vault.getFileByPath).mockImplementation(p => p === orphanedPath ? null : mockFile);
            vi.mocked(mockApp.vault.read).mockResolvedValue('unrelated content');
            vi.mocked(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: pushedPath, sha: 'new-sha' });
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: '', sha: '' });
            // The pushed path's own remote state comes from the pre-fetched tree, not getFile.
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path: pushedPath, symlink: false, sha: 'remote-sha' }
            ]);

            const results = await manager.pushAllFiles([mockFile]);

            expect(results.success).toBe(1);
            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                pushedPath, 'unrelated content', 'main', `Update ${mockFile.name} from Obsidian`, 'remote-sha', undefined
            );
            expect(mockSettings.syncMetadata[orphanedPath]).toBeDefined();
            // The tree doesn't list the orphaned path, so it can't be a rename
            // source — probing it would be a guaranteed 404, once per pushed file.
            expect(mockGitService.getFile).not.toHaveBeenCalledWith(orphanedPath, 'main');
        });
    });

    describe('batch plan preview (issue #63)', () => {
        it('shows a plan classifying additions and modifications before a push-all applies', async () => {
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockImplementation(async (p) => (p === 'new.md' ? 'new content' : 'changed content'));
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path: 'existing.md', symlink: false, sha: await gitBlobSha('old content') }
            ]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: '', sha: '' });
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: 'path', sha: 'new-sha' });

            const results = await manager.pushAllFiles(['new.md', 'existing.md']);

            expect(SyncPlanModal).toHaveBeenCalledWith(
                mockApp,
                {
                    additions: [{ path: 'new.md', name: 'new.md' }],
                    modifications: [{ path: 'existing.md', name: 'existing.md' }],
                    deletions: [],
                    moves: [],
                    acceptedRemote: [],
                    skippedConflicts: [],
                },
                'push',
                expect.any(Function),
                expect.any(Function)
            );
            expect(results.success).toBe(2);
        });

        it('does not apply a push-all when the plan is cancelled', async () => {
            vi.mocked(SyncPlanModal).mockImplementation(function (
                this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, _onConfirm: () => void, onCancel?: () => void
            ) {
                onCancel?.();
                return this;
            } as never);

            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('new content');
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([]);
            const pushFileSpy = vi.mocked(mockGitService.pushFile);

            const results = await manager.pushAllFiles(['new.md']);

            expect(results.success).toBe(0);
            expect(pushFileSpy).not.toHaveBeenCalled();
        });

        it('skips the plan modal entirely when nothing would be pushed', async () => {
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            vi.mocked(adapter.exists).mockResolvedValue(true);
            const content = 'same content';
            vi.mocked(adapter.read).mockResolvedValue(content);
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path: 'same.md', symlink: false, sha: await gitBlobSha(content) }
            ]);

            const results = await manager.pushAllFiles(['same.md']);

            expect(SyncPlanModal).not.toHaveBeenCalled();
            expect(results.success).toBe(0);
            expect(results.failed).toBe(0);
        });
    });
});
