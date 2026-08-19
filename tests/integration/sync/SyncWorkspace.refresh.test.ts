import { describe, expect, it, vi } from 'vitest';
import { BoundarySyncWorkspace } from '../../../src/logic/sync/SyncWorkspace';
import { SyncStatusRefreshService } from '../../../src/logic/sync/SyncStatusRefreshService';
import { createSyncManagerMocks } from '../../logic/sync-manager-test-helpers';

vi.mock('obsidian');

describe('SyncWorkspace refresh integration', () => {
    it('exposes the shared status snapshot populated by the real refresh service', async () => {
        const { manager, mockApp, mockAdapter, mockGitService, mockSettings } = createSyncManagerMocks();
        mockGitService.listFilesDetailed.mockResolvedValue([
            { path: 'remote.md', sha: 'remote-sha', symlink: false },
        ]);
        mockApp.vault.getFiles = vi.fn().mockReturnValue([]);
        mockApp.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
        mockAdapter.list = vi.fn().mockResolvedValue({ files: [], folders: [] });
        mockAdapter.stat = vi.fn().mockResolvedValue(null);
        const gitignore = {
            loadGitignores: vi.fn().mockResolvedValue(undefined),
            isIgnored: vi.fn().mockReturnValue(false),
        };
        const refreshService = new SyncStatusRefreshService({
            app: mockApp,
            settings: () => mockSettings,
            gitService: () => mockGitService,
            gitignoreManager: () => gitignore as never,
            syncManager: () => manager,
            filterFilesByVaultFolder: files => files,
            filterPathByVaultFolder: () => true,
            getNormalizedPath: path => path,
            getVaultPath: path => path,
        }, manager.status);
        const refresh = vi.fn(() => refreshService.refresh());
        const workspace = new BoundarySyncWorkspace(() => manager, {
            refresh, deleteRemote: vi.fn(), getDiff: vi.fn(),
        });

        await workspace.refresh();

        expect(workspace.getStatuses()).toEqual([{ path: 'remote.md', status: 'remote-only' }]);
        expect(gitignore.loadGitignores).toHaveBeenCalledOnce();
    });
});
