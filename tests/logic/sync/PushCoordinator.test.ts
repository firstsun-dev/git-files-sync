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
        automaticSyncEnabled: false,
        automaticSyncIntervalMinutes: 5,
        automaticSyncOnStartup: false,
    };
}

function createHarness(overrides: {
    confirmPlan?: boolean;
    pathExists?: (path: string) => Promise<boolean>;
    resolveConflicts?: (conflicts: unknown[], safeCount: number) => Promise<boolean>;
    settings?: GitLabFilesPushSettings;
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
        moves: Array<{ path: string }>,
        deletions: Array<{ path: string }>,
        result: PushResults,
    ) => {
        const committed = [...pushes, ...moves, ...deletions];
        result.success += committed.length;
        result.syncedPaths.push(...committed.map(entry => ({ path: entry.path, sha: `sha:${entry.path}` })));
    });
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const confirmPlan = vi.fn().mockResolvedValue(overrides.confirmPlan ?? true);
    const resolveConflicts = vi.fn(overrides.resolveConflicts ?? (() => Promise.resolve(true)));
    const syncSettings = overrides.settings ?? settings();
    const coordinator = new PushCoordinator({
        app: { vault: { getFileByPath: vi.fn().mockReturnValue({}) } } as unknown as App,
        gitService: () => provider,
        settings: syncSettings,
        scanner,
        executor: { commitBatch, pushSymlink: vi.fn() } as unknown as PushExecutor,
        conflicts: { findStale: vi.fn().mockResolvedValue([]), applyRemote: vi.fn() } as unknown as ConflictResolver,
        isPathIgnored: () => false,
        confirmPlan,
        resolveConflicts,
        updateMetadata: vi.fn().mockResolvedValue(undefined),
        migrateBaseline: vi.fn().mockResolvedValue(undefined),
        saveSettings,
        notify: vi.fn(),
        serviceName: () => 'GitHub',
    });
    return { coordinator, listFilesDetailed, commitBatch, confirmPlan, resolveConflicts, saveSettings, settings: syncSettings };
}

/**
 * One conflicted candidate (`clash.md`, tracked baseline + divergent remote)
 * alongside one safe candidate (`safe.md`, no tracked baseline).
 */
function conflictingSettings(): GitLabFilesPushSettings {
    const base = settings();
    base.syncMetadata['clash.md'] = {
        lastSyncedSha: 'base-clash',
        lastSyncedAt: 0,
        lastKnownPath: 'clash.md',
    };
    return base;
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

    describe('planSyncBatch conflict behavior', () => {
        function conflictedHarness(resolveConflicts?: (conflicts: unknown[], safeCount: number) => Promise<boolean>) {
            const harness = createHarness({ settings: conflictingSettings(), resolveConflicts });
            harness.listFilesDetailed.mockResolvedValue([
                { path: 'clash.md', symlink: false, sha: 'remote-clash' },
            ]);
            return harness;
        }

        it('prompts for conflict resolution in interactive mode and cancels the batch when declined', async () => {
            const harness = conflictedHarness(() => Promise.resolve(false));

            const plan = await harness.coordinator.planSyncBatch(
                ['safe.md', 'clash.md'],
                undefined,
                undefined,
                'prompt',
            );

            expect(harness.resolveConflicts).toHaveBeenCalledTimes(1);
            expect(plan.cancelled).toBe(true);
        });

        it('skips conflicting paths and continues with safe paths in background mode, invoking no conflict UI', async () => {
            const resolveConflicts = vi.fn().mockResolvedValue(true);
            const harness = conflictedHarness(resolveConflicts);

            const plan = await harness.coordinator.planSyncBatch(
                ['safe.md', 'clash.md'],
                undefined,
                undefined,
                'skip',
            );

            expect(resolveConflicts).not.toHaveBeenCalled();
            expect(plan.cancelled).toBe(false);
            expect(plan.conflictedPaths).toContain('clash.md');
            expect(plan.skippedConflicts).toBeGreaterThan(0);
            expect(plan.pushes.map(entry => entry.path)).not.toContain('clash.md');
            expect(plan.pushes.map(entry => entry.path)).toContain('safe.md');
        });
    });

    describe('unattended (background) data-loss protection', () => {
        it('treats differing local/remote content with no baseline as a conflict in background mode', async () => {
            const harness = createHarness();
            harness.listFilesDetailed.mockResolvedValue([{ path: 'untracked.md', symlink: false, sha: 'remote-sha' }]);

            const plan = await harness.coordinator.planSyncBatch(['untracked.md'], undefined, undefined, 'skip');

            expect(plan.pushes).toEqual([]);
            expect(plan.conflictedPaths).toEqual(['untracked.md']);
        });

        it('keeps the interactive behavior: no baseline still pushes after confirmation', async () => {
            const harness = createHarness();
            harness.listFilesDetailed.mockResolvedValue([{ path: 'untracked.md', symlink: false, sha: 'remote-sha' }]);

            const plan = await harness.coordinator.planSyncBatch(['untracked.md'], undefined, undefined, 'prompt');

            expect(plan.pushes.map(entry => entry.path)).toEqual(['untracked.md']);
        });

        function commitHarness(remote: Record<string, { sha: string; revision?: string }>) {
            const harness = createHarness();
            const getFile = vi.fn(async (path: string) => ({ content: '', sha: remote[path]?.sha ?? '', revision: remote[path]?.revision }));
            const provider = { listFilesDetailed: harness.listFilesDetailed, getFile } as unknown as GitServiceInterface;
            const coordinator = new PushCoordinator({
                ...(harness.coordinator as unknown as { dependencies: ConstructorParameters<typeof PushCoordinator>[0] }).dependencies,
                gitService: () => provider,
            });
            const results = (): PushResults => ({ success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, resolvedConflicts: 0, skippedConflicts: 0, errors: [], syncedPaths: [] });
            return { coordinator, harness, results: results() };
        }

        it('does not overwrite a remote file that changed after planning', async () => {
            const { coordinator, harness, results } = commitHarness({ 'a.md': { sha: 'changed' } });
            const push = { path: 'a.md', name: 'a.md', repoPath: 'a.md', content: 'x', existingSha: 'planned' };

            await coordinator.commitResolvedBatch([push], [], [], [], [], results, { revalidateRemote: true });

            expect(harness.commitBatch).not.toHaveBeenCalled();
            expect(results.failed).toBe(1);
            expect(results.errors[0]?.file).toBe('a.md');
        });

        it('does not create over a remote file that appeared after planning', async () => {
            const { coordinator, harness, results } = commitHarness({ 'new.md': { sha: 'appeared' } });
            const push = { path: 'new.md', name: 'new.md', repoPath: 'new.md', content: 'x' };

            await coordinator.commitResolvedBatch([push], [], [], [], [], results, { revalidateRemote: true });

            expect(harness.commitBatch).not.toHaveBeenCalledWith([push], expect.anything(), expect.anything(), expect.anything());
            expect(results.failed).toBe(1);
        });

        it('pushes entries whose remote still matches the plan', async () => {
            const { coordinator, harness, results } = commitHarness({ 'a.md': { sha: 'planned' } });
            const push = { path: 'a.md', name: 'a.md', repoPath: 'a.md', content: 'x', existingSha: 'planned' };

            await coordinator.commitResolvedBatch([push], [], [], [], [], results, { revalidateRemote: true });

            expect(harness.commitBatch).toHaveBeenCalledWith([push], [], [], results);
            expect(results.failed).toBe(0);
        });

        it('does not delete a remote file that changed since the last sync', async () => {
            const { coordinator, harness, results } = commitHarness({ 'gone.md': { sha: 'remote-edited' } });
            harness.settings.syncMetadata['gone.md'] = { lastSyncedSha: 'base', lastSyncedAt: 0, lastKnownPath: 'gone.md' };
            const del = { path: 'gone.md', name: 'gone.md', repoPath: 'gone.md' };

            await coordinator.commitResolvedBatch([], [], [del], [], [], results, { revalidateRemote: true });

            expect(harness.commitBatch).not.toHaveBeenCalled();
            expect(results.errors[0]?.file).toBe('gone.md');
        });

        it('refuses a remote delete that has no baseline to verify against', async () => {
            const { coordinator, harness, results } = commitHarness({ 'gone.md': { sha: 'anything' } });
            const del = { path: 'gone.md', name: 'gone.md', repoPath: 'gone.md' };

            await coordinator.commitResolvedBatch([], [], [del], [], [], results, { revalidateRemote: true });

            expect(harness.commitBatch).not.toHaveBeenCalled();
            expect(results.failed).toBe(1);
        });

        it('deletes when the remote still equals the baseline', async () => {
            const { coordinator, harness, results } = commitHarness({ 'gone.md': { sha: 'base' } });
            harness.settings.syncMetadata['gone.md'] = { lastSyncedSha: 'base', lastSyncedAt: 0, lastKnownPath: 'gone.md' };
            const del = { path: 'gone.md', name: 'gone.md', repoPath: 'gone.md' };

            await coordinator.commitResolvedBatch([], [], [del], [], [], results, { revalidateRemote: true });

            expect(harness.commitBatch).toHaveBeenCalledWith([], [], [del], results);
        });

        it('does not remove a move source that changed after planning', async () => {
            const { coordinator, harness, results } = commitHarness({ 'old.md': { sha: 'edited' } });
            const move = { path: 'new.md', name: 'new.md', repoPath: 'new.md', oldPath: 'old.md', oldRepoPath: 'old.md', content: 'x', oldSha: 'planned' };

            await coordinator.commitResolvedBatch([], [move], [], [], [], results, { revalidateRemote: true });

            expect(harness.commitBatch).not.toHaveBeenCalled();
            expect(results.failed).toBe(1);
        });

        it('does not revalidate (no extra provider reads) for interactive commits', async () => {
            const { coordinator, harness, results } = commitHarness({});
            const del = { path: 'gone.md', name: 'gone.md', repoPath: 'gone.md' };

            await coordinator.commitResolvedBatch([], [], [del], [], [], results);

            expect(harness.commitBatch).toHaveBeenCalledWith([], [], [del], results);
        });
    });

    it('plans an edited tracked rename as a move when the destination is free', async () => {
        const harness = createHarness();
        harness.settings.syncMetadata['notes/new.md'] = {
            lastSyncedSha: 'stale-baseline',
            lastSyncedAt: 0,
            lastKnownPath: 'notes/new.md',
            renamedFrom: 'notes/old.md',
        };
        harness.listFilesDetailed.mockResolvedValue([
            { path: 'notes/old.md', symlink: false, sha: 'current-source' },
        ]);

        const result = await harness.coordinator.pushFiles(['notes/new.md']);

        expect(harness.confirmPlan).toHaveBeenCalledWith(expect.objectContaining({
            moves: [{ path: 'notes/new.md', name: 'new.md', movedFrom: 'notes/old.md' }],
            skippedConflicts: [],
        }));
        expect(harness.commitBatch).toHaveBeenCalledWith(
            [],
            [expect.objectContaining({ path: 'notes/new.md', oldPath: 'notes/old.md', content: 'content:notes/new.md' })],
            [],
            expect.any(Object),
        );
        expect(result).toMatchObject({ success: 1, conflicts: 0, skippedConflicts: 0 });
    });
});
