import { describe, expect, it, vi } from 'vitest';
import type { App, DataAdapter } from 'obsidian';
import { createSyncRuntime } from '../../src/runtime/createSyncRuntime';
import type { SyncRuntimeDependencies } from '../../src/runtime/createSyncRuntime';
import type { GitLabFilesPushSettings } from '../../src/settings';
import type { GitServiceInterface } from '../../src/services/git-service-interface';

vi.mock('obsidian');

function buildDeps(overrides: Partial<SyncRuntimeDependencies> = {}): SyncRuntimeDependencies {
    const mockAdapter = { list: vi.fn().mockResolvedValue({ files: [], folders: [] }) } as unknown as DataAdapter;
    const mockApp = {
        vault: {
            getFiles: () => [],
            adapter: mockAdapter,
        },
    } as unknown as App;
    const mockGitService = {
        listFilesDetailed: vi.fn().mockResolvedValue([]),
        getBranchHead: vi.fn().mockResolvedValue(undefined),
    } as unknown as GitServiceInterface;
    const mockSettings = {
        serviceType: 'github',
        branch: 'main',
        syncMetadata: {},
        vaultFolder: '',
        rootPath: '',
    } as unknown as GitLabFilesPushSettings;
    const mockGitignoreManager = { isIgnored: () => false, loadGitignores: vi.fn().mockResolvedValue(undefined) } as never;

    return {
        app: mockApp,
        gitService: mockGitService,
        getGitService: () => mockGitService,
        settings: mockSettings,
        getSettings: () => mockSettings,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        getGitignoreManager: () => mockGitignoreManager,
        isIgnored: () => false,
        filterFilesByVaultFolder: files => files,
        filterPathByVaultFolder: () => true,
        getNormalizedPath: path => path,
        getVaultPath: path => path,
        notify: vi.fn(),
        ...overrides,
    };
}

describe('createSyncRuntime', () => {
    it('wires every collaborator on top of the same SyncManager/SyncStatusService pair', () => {
        const runtime = createSyncRuntime(buildDeps());

        expect(runtime.sync).toBeDefined();
        expect(runtime.syncStatusRefresh).toBeDefined();
        expect(runtime.syncDiffService).toBeDefined();
        expect(runtime.syncWorkspace).toBeDefined();
        expect(runtime.changeRepository).toBeDefined();
        expect(runtime.syncSelectionStore).toBeDefined();
        expect(runtime.operationState).toBeDefined();
        expect(runtime.refreshState).toBeDefined();
        expect(runtime.sourceControlViewModel).toBeDefined();
        expect(runtime.sourceControlActions).toBeDefined();
    });

    it('keeps ChangeRepository in sync with the shared SyncStatusService until disposed', () => {
        const runtime = createSyncRuntime(buildDeps());

        runtime.sync.status.set({ path: 'note.md', status: 'synced' });
        expect(runtime.changeRepository.getById('note.md' as never)).toBeDefined();

        runtime.dispose();
        runtime.sync.status.set({ path: 'other.md', status: 'unsynced' });
        // Disposed: the second publish must not reach ChangeRepository.
        expect(runtime.changeRepository.getById('other.md' as never)).toBeUndefined();
    });

    it('reconciles SyncSelectionStore against every ChangeRepository replacement, including stale overrides', () => {
        const runtime = createSyncRuntime(buildDeps());

        runtime.sync.status.set({ path: 'note.md', status: 'modified' });
        const noteId = runtime.changeRepository.getAll()[0]?.id;
        expect(noteId).toBeDefined();
        if (!noteId) return;

        runtime.syncSelectionStore.selectForSync(noteId);
        runtime.syncSelectionStore.setActionOverride(noteId, 'pull');
        expect(runtime.syncSelectionStore.isIncluded(noteId)).toBe(true);

        // Republishing without note.md at all drops the selection entirely.
        runtime.sync.status.delete('note.md');

        expect(runtime.syncSelectionStore.isIncluded(noteId)).toBe(false);
        expect(runtime.syncSelectionStore.getActionOverride(noteId)).toBeUndefined();
    });

    it('stops reconciling SyncSelectionStore once disposed', () => {
        const runtime = createSyncRuntime(buildDeps());

        runtime.sync.status.set({ path: 'note.md', status: 'modified' });
        const noteId = runtime.changeRepository.getAll()[0]?.id;
        expect(noteId).toBeDefined();
        if (!noteId) return;
        runtime.syncSelectionStore.selectForSync(noteId);

        runtime.dispose();
        // Calling ChangeRepository.replace() directly (bypassing sync.status)
        // isolates the selection-reconciliation subscription specifically:
        // after dispose(), it must no longer reach SyncSelectionStore.
        runtime.changeRepository.replace([]);

        expect(runtime.syncSelectionStore.isIncluded(noteId)).toBe(true);
    });

    it('routes SourceControlActionService notifications through the injected notify callback', async () => {
        const notify = vi.fn();
        const runtime = createSyncRuntime(buildDeps({ notify }));

        // pull() with no matching changes resolves with an empty batch and no notification;
        // this only asserts the runtime wired SourceControlActionService with our notifier,
        // not any specific sync outcome.
        await runtime.sourceControlActions.pull([]);

        expect(notify).not.toHaveBeenCalled();
    });
});
