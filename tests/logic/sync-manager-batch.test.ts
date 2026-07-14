/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { SyncManager } from '../../src/logic/sync-manager';
import { App, DataAdapter, TFile } from 'obsidian';
import { GitLabFilesPushSettings } from '../../src/settings';
import { GitServiceInterface } from '../../src/services/git-service-interface';

vi.mock('obsidian');

describe('SyncManager Batch Operations', () => {
    let manager: SyncManager;
    let mockApp: Mocked<App>;
    let mockGitService: Mocked<GitServiceInterface>;
    let mockSettings: GitLabFilesPushSettings;

    beforeEach(() => {
        vi.clearAllMocks();

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

    describe('pullAllAllFiles', () => {
        it('should pull multiple files correctly (strings and TFiles)', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'file2.md', name: 'file2.md' });
            const files = ['file1.md', mockFile];
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'remote content', sha: 'new-sha' });
            vi.mocked(adapter.exists).mockResolvedValue(true);

            const results = await manager.pullAllFiles(files);

            expect(results.success).toBe(2);
            expect(vi.mocked(adapter.write)).toHaveBeenCalledWith('file1.md', 'remote content');
            expect(vi.mocked(mockApp.vault.modify)).toHaveBeenCalledWith(mockFile, 'remote content');
        });

        it('should handle missing remote files during batch pull', async () => {
            const files = ['exists.md', 'missing.md'];

            vi.mocked(mockGitService.getFile)
                .mockResolvedValueOnce({ content: 'content', sha: 'sha' })
                .mockResolvedValueOnce({ content: '', sha: '' });

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
            expect(mockGitService.pushFile).toHaveBeenCalledWith(path, 'local content', 'main', expect.any(String), 'some-sha');
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
            vi.mocked(mockGitService.getFile).mockImplementation(async (path) => {
                // Remote still has the old path with matching content: confirms a real rename.
                if (path === oldPath) return { content: 'content', sha: 'sha' };
                // New path does not exist on the remote yet.
                return { content: '', sha: '' };
            });

            const results = await manager.pushAllFiles([mockFile]);

            expect(results.success).toBe(1);
            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                newPath, 'content', 'main', `Rename ${oldPath} to ${newPath}`, ''
            );
        });

        it('should send existing sha when rename target already exists remotely (avoids 422)', async () => {
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
            vi.mocked(mockGitService.getFile).mockImplementation(async (path) => {
                // Remote still has the old path with matching content: confirms a real rename.
                if (path === oldPath) return { content: 'content', sha: 'sha' };
                // A file already exists on the remote at the new path.
                return { content: 'old remote content', sha: 'remote-existing-sha' };
            });

            const results = await manager.pushAllFiles([mockFile]);

            expect(results.success).toBe(1);
            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                newPath, 'content', 'main', `Rename ${oldPath} to ${newPath}`, 'remote-existing-sha'
            );
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
            // detectRename still checks the orphaned metadata entry's remote content directly.
            vi.mocked(mockGitService.getFile).mockImplementation(async (path) => {
                if (path === orphanedPath) return { content: 'totally different content', sha: 'orphaned-sha' };
                return { content: '', sha: '' };
            });
            // The pushed path's own remote state comes from the pre-fetched tree, not getFile.
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([
                { path: pushedPath, symlink: false, sha: 'remote-sha' }
            ]);

            const results = await manager.pushAllFiles([mockFile]);

            expect(results.success).toBe(1);
            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                pushedPath, 'unrelated content', 'main', `Update ${mockFile.name} from Obsidian`, 'remote-sha'
            );
            expect(mockSettings.syncMetadata[orphanedPath]).toBeDefined();
        });
    });
});
