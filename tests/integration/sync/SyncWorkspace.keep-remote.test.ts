/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() mocks intentionally reference methods unbound; safe under Vitest's mocking model */
import { describe, expect, it, vi, type Mocked } from 'vitest';
import { SyncManager } from '../../../src/logic/sync/SyncManager';
import type { App, DataAdapter } from 'obsidian';
import type { GitServiceInterface } from '../../../src/services/git-service-interface';
import type { GitLabFilesPushSettings } from '../../../src/settings';

const BASE_SHA = 'base-blob-sha';
const REVIEWED_SHA = 'reviewed-blob-sha';

function harness(options: { writeError?: Error } = {}) {
    const mockAdapter = {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue('BASE'),
        readBinary: vi.fn(),
        write: options.writeError
            ? vi.fn().mockRejectedValue(options.writeError)
            : vi.fn().mockResolvedValue(undefined),
        writeBinary: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<DataAdapter>;
    const mockApp = {
        vault: {
            read: vi.fn(),
            readBinary: vi.fn(),
            modify: vi.fn(),
            modifyBinary: vi.fn(),
            getFileByPath: vi.fn().mockReturnValue(null),
            adapter: mockAdapter,
        },
    } as unknown as Mocked<App>;
    const mockGitService = {
        pushFile: vi.fn(),
        getFile: vi.fn(),
        getBlob: vi.fn().mockResolvedValue({ sha: REVIEWED_SHA, content: 'REMOTE' }),
        deleteFile: vi.fn(),
        listFilesDetailed: vi.fn().mockResolvedValue([]),
        getRepoGitignores: vi.fn(),
        updateConfig: vi.fn(),
        testConnection: vi.fn(),
        listFiles: vi.fn().mockResolvedValue([]),
    } as unknown as Mocked<GitServiceInterface>;
    const mockSettings = {
        serviceType: 'github',
        branch: 'main',
        vaultFolder: '',
        rootPath: '',
        syncMetadata: {
            'a.md': { lastSyncedSha: BASE_SHA, lastSyncedAt: 0, lastKnownPath: 'a.md' },
        },
    } as unknown as GitLabFilesPushSettings;
    const interaction = {
        confirmPlan: vi.fn().mockResolvedValue(true),
        openConflict: vi.fn(),
        resolveBatchConflicts: vi.fn().mockResolvedValue(false),
        notify: vi.fn(),
    };
    const manager = new SyncManager(
        mockApp,
        mockGitService,
        mockSettings,
        undefined,
        undefined,
        undefined,
        interaction,
    );
    // Seed the live status row exactly as a divergent refresh would leave it:
    // both sides exist, contents differ, and remoteSha is the REVIEWED blob.
    manager.status.set({
        path: 'a.md',
        status: 'modified',
        remoteSha: REVIEWED_SHA,
        remoteContent: 'REMOTE',
        localContent: 'LOCAL',
    });
    return {
        manager,
        interaction,
        mockAdapter,
        mockGitService,
        mockSettings,
        acceptRemoteConflict: (path: string) =>
            (manager as unknown as { acceptRemoteConflict(path: string): Promise<void> }).acceptRemoteConflict(path),
    };
}

describe('SyncWorkspace keep-remote integration (acceptRemoteConflict)', () => {
    it('writes the reviewed blob silently, advances metadata to the reviewed sha, and re-classifies as synced', async () => {
        const { manager, acceptRemoteConflict, mockAdapter, mockGitService, mockSettings, interaction } = harness();

        await acceptRemoteConflict('a.md');

        expect(mockAdapter.write).toHaveBeenCalledWith('a.md', 'REMOTE');
        expect(mockSettings.syncMetadata['a.md']?.lastSyncedSha).toBe(REVIEWED_SHA);
        const row = manager.status.get('a.md');
        expect(row?.status).toBe('synced');
        expect(row?.remoteSha).toBe(REVIEWED_SHA);
        expect(mockGitService.getFile).not.toHaveBeenCalled();
        expect(mockGitService.getBlob).toHaveBeenCalledWith(REVIEWED_SHA, 'a.md');
        expect(interaction.openConflict).not.toHaveBeenCalled();
        expect(interaction.confirmPlan).not.toHaveBeenCalled();
        expect(interaction.notify).not.toHaveBeenCalled();
    });

    it('rejects when the vault write fails and leaves metadata and status untouched', async () => {
        const { manager, acceptRemoteConflict, mockSettings, interaction } = harness({ writeError: new Error('disk full') });

        await expect(acceptRemoteConflict('a.md')).rejects.toThrow('disk full');

        expect(mockSettings.syncMetadata['a.md']?.lastSyncedSha).toBe(BASE_SHA);
        const row = manager.status.get('a.md');
        expect(row?.status).not.toBe('synced');
        expect(interaction.openConflict).not.toHaveBeenCalled();
    });

    it('rejects when the reviewed remote revision is unavailable in the status row', async () => {
        const rowless = harness();
        rowless.manager.status.delete('a.md');

        await expect(rowless.acceptRemoteConflict('a.md'))
            .rejects.toThrow('Cannot accept remote version because the reviewed remote revision is unavailable.');
        expect(rowless.mockGitService.getBlob).not.toHaveBeenCalled();
    });
});

/* eslint-enable @typescript-eslint/unbound-method -- re-enable after the whole-file exemption above */