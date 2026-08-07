/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { SyncManager } from '../../src/logic/sync-manager';
import { App, DataAdapter, TFile } from 'obsidian';
import { GitLabFilesPushSettings } from '../../src/settings';
import { GitServiceInterface } from '../../src/services/git-service-interface';
import { gitBlobSha } from '../../src/utils/git-blob-sha';
import { SyncPlanModal, SyncPlanDirection } from '../../src/ui/SyncPlanModal';

vi.mock('obsidian');
// Every push/pull-all now shows a plan for review before applying;
// auto-confirm it here since these tests exercise batch mechanics, not the modal.
vi.mock('../../src/ui/SyncPlanModal');

describe('SyncManager Batch Operations', () => {
    let manager: SyncManager;
    let mockApp: Mocked<App>;
    let mockGitService: Mocked<GitServiceInterface>;
    let mockSettings: GitLabFilesPushSettings;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(SyncPlanModal).mockImplementation(function (
            this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, onConfirm: () => void
        ) {
            onConfirm();
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
