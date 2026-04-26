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
            
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: '', sha: 'old-sha' });
            vi.mocked(mockGitService.pushFile).mockResolvedValue('path');

            const results = await manager.pushAllFiles(files);

            expect(results.success).toBe(2);
            expect(vi.mocked(mockGitService.pushFile)).toHaveBeenCalledTimes(2);
        });

        it('should handle failures during batch push', async () => {
            const files = ['good.md', 'bad.md'];
            const adapter = mockApp.vault.adapter as Mocked<DataAdapter>;
            
            vi.mocked(adapter.exists).mockResolvedValue(true);
            vi.mocked(adapter.read).mockResolvedValue('content');
            
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: '', sha: 'old-sha' });
            
            vi.mocked(mockGitService.pushFile)
                .mockResolvedValueOnce('path')
                .mockRejectedValueOnce(new Error('Push failed'));

            const results = await manager.pushAllFiles(files);

            expect(results.success).toBe(1);
            expect(results.failed).toBe(1);
            expect(results.errors[0]!.file).toBe('bad.md');
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
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: '', sha: 'sha' });
            vi.mocked(mockGitService.pushFile).mockResolvedValue('path');

            const onProgress = vi.fn();
            await manager.pushAllFiles(files, onProgress);

            expect(onProgress).toHaveBeenCalledTimes(3);
            expect(onProgress).toHaveBeenCalledWith(1, 3, 'file1.md');
            expect(onProgress).toHaveBeenCalledWith(2, 3, 'file2.md');
            expect(onProgress).toHaveBeenCalledWith(3, 3, 'file3.md');
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
            vi.mocked(mockGitService.pushFile).mockResolvedValue(newPath);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ content: 'content', sha: 'new-sha' });

            const results = await manager.pushAllFiles([mockFile]);

            expect(results.success).toBe(1);
            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                newPath, 'content', 'main', `Rename ${oldPath} to ${newPath}`, undefined
            );
        });
    });
});
