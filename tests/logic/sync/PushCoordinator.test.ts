import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { GitServiceInterface } from '../../../src/services/git-service-interface';
import type { GitLabFilesPushSettings } from '../../../src/settings';
import type { ConflictResolver } from '../../../src/logic/sync/ConflictResolver';
import type { PushExecutor } from '../../../src/logic/sync/PushExecutor';
import { PushCoordinator } from '../../../src/logic/sync/PushCoordinator';
import type { SyncScanner } from '../../../src/logic/sync/SyncScanner';
import type { PushResults } from '../../../src/logic/sync/types';

function settings(): GitLabFilesPushSettings {
    return {
        serviceType: 'github',
        gitlabToken: '',
        gitlabBaseUrl: '',
        projectId: '',
        githubToken: '',
        githubOwner: '',
        githubRepo: '',
        giteaToken: '',
        giteaBaseUrl: '',
        giteaOwner: '',
        giteaRepo: '',
        branch: 'main',
        rootPath: '',
        syncMetadata: {},
        vaultFolder: '',
        symlinkHandling: 'real',
        ignorePatterns: '',
        lastSeenVersion: '',
        bannerDismissedVersion: '',
        language: 'system',
        autoRefreshOnStartup: true,
    };
}

function createHarness(overrides: {
    confirmPlan?: boolean;
    pathExists?: (path: string) => Promise<boolean>;
} = {}) {
    const listFilesDetailed = vi.fn().mockResolvedValue([]);
    const provider = {
        listFilesDetailed,
    } as unknown as GitServiceInterface;
    const scanner = {
        fileInfo: (path: string) => ({ path, name: path.split('/').pop() ?? path, isString: true }),
        toRepoPath: (path: string) => path,
        toTreePath: (path: string) => path,
        pathExists: overrides.pathExists ?? vi.fn().mockResolvedValue(true),
        indexedFileExists: vi.fn().mockReturnValue(true),
        readContent: vi.fn().mockImplementation(async (path: string) => `content:${path}`),
    } as unknown as SyncScanner;
    const commitBatch = vi.fn().mockImplementation(async (
        pushes: Array<{ path: string }>,
        _moves: unknown[],
        result: PushResults,
    ) => {
        result.success += pushes.length;
        result.syncedPaths.push(...pushes.map(push => ({ path: push.path, sha: `sha:${push.path}` })));
    });
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const confirmPlan = vi.fn().mockResolvedValue(overrides.confirmPlan ?? true);
    const coordinator = new PushCoordinator({
        app: { vault: { getFileByPath: vi.fn().mockReturnValue({}) } } as unknown as App,
        gitService: () => provider,
        settings: settings(),
        scanner,
        executor: { commitBatch, pushSymlink: vi.fn() } as unknown as PushExecutor,
        conflicts: { findStale: vi.fn().mockResolvedValue([]), applyRemote: vi.fn() } as unknown as ConflictResolver,
        isPathIgnored: () => false,
        confirmPlan,
        resolveConflicts: vi.fn().mockResolvedValue(true),
        updateMetadata: vi.fn().mockResolvedValue(undefined),
        migrateBaseline: vi.fn().mockResolvedValue(undefined),
        saveSettings,
        notify: vi.fn(),
        serviceName: () => 'GitHub',
    });
    return { coordinator, listFilesDetailed, commitBatch, confirmPlan, saveSettings };
}

describe('PushCoordinator', () => {
    it('plans local-only files and commits them through the executor', async () => {
        const harness = createHarness();

        const result = await harness.coordinator.pushFiles(['notes/a.md']);

        expect(harness.confirmPlan).toHaveBeenCalledWith(expect.objectContaining({
            additions: [{ path: 'notes/a.md', name: 'a.md' }],
        }));
        expect(harness.commitBatch).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ success: 1, failed: 0, syncedPaths: [{ path: 'notes/a.md', sha: 'sha:notes/a.md' }] });
    });

    it('does not mutate the provider when final plan review is cancelled', async () => {
        const harness = createHarness({ confirmPlan: false });

        const result = await harness.coordinator.pushFiles(['a.md']);

        expect(result.cancelled).toBe(true);
        expect(harness.commitBatch).not.toHaveBeenCalled();
        expect(harness.saveSettings).toHaveBeenCalledOnce();
    });

    it('keeps classifying the batch after one local file fails', async () => {
        const harness = createHarness({ pathExists: async path => path !== 'missing.md' });

        const result = await harness.coordinator.pushFiles(['missing.md', 'ready.md']);

        expect(result.failed).toBe(1);
        expect(result.errors).toEqual([{ file: 'missing.md', error: 'File no longer exists' }]);
        expect(result.success).toBe(1);
        expect(harness.commitBatch).toHaveBeenCalledOnce();
    });

    it('surfaces a provider tree failure before any mutation is attempted', async () => {
        const harness = createHarness();
        harness.listFilesDetailed.mockRejectedValue(new Error('provider unavailable'));

        await expect(harness.coordinator.pushFiles(['a.md'])).rejects.toThrow('provider unavailable');
        expect(harness.commitBatch).not.toHaveBeenCalled();
    });
});
