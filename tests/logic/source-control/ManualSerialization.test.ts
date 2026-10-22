import { describe, expect, it, vi } from 'vitest';
import { AutomaticSyncService } from '../../../src/logic/source-control/AutomaticSyncService';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { SourceControlActionService } from '../../../src/logic/source-control/SourceControlActionService';
import { SyncSelectionStore } from '../../../src/logic/source-control/SyncSelectionStore';
import { toChangeId, type SyncChange, type SyncChangeKind } from '../../../src/logic/source-control/types';
import type { SyncWorkspace } from '../../../src/logic/sync/SyncWorkspace';
import type { PushResults, SyncPlan, SyncResult } from '../../../src/logic/sync/types';

/**
 * runManual() is the serialization boundary for legacy entry points (ribbon,
 * commands, context menu, Push/Pull All) that call SyncManager directly. It
 * must share the one real guard with Automatic Sync and the action service.
 */

const change = (path: string, kind: SyncChangeKind): SyncChange => ({ id: toChangeId(path), path, kind });
const emptyPlan = (): SyncPlan => ({ additions: [], modifications: [], deletions: [], moves: [] });
const pushResults = (): PushResults => ({
    success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, resolvedConflicts: 0, skippedConflicts: 0, errors: [], syncedPaths: [],
});
const syncResult = (): SyncResult => ({ success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, errors: [] });

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { promise, resolve };
};

function harness(changes: SyncChange[], overrides: Partial<SyncWorkspace> = {}) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const workspace = {
        refresh: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(pushResults()),
        pull: vi.fn().mockResolvedValue(syncResult()),
        toRepoPath: (path: string) => path,
        planPush: vi.fn().mockResolvedValue({
            reviewPlan: emptyPlan(), pushes: [], moves: [], keepRemote: [], keepLocal: [], skippedConflicts: 0,
            conflictedPaths: [], cancelled: false, immediate: { success: 0, updated: 0, failed: 0, errors: [], syncedPaths: [] },
        }),
        planPull: vi.fn().mockResolvedValue(emptyPlan()),
        applyPull: vi.fn().mockResolvedValue(syncResult()),
        commitResolvedBatch: vi.fn().mockResolvedValue(undefined),
        confirmPlan: vi.fn().mockResolvedValue(true),
        ...overrides,
    } as unknown as SyncWorkspace;
    const actions = new SourceControlActionService(repository, new SyncSelectionStore(), new OperationState(), workspace);
    const automatic = new AutomaticSyncService({ workspace, changes: repository, actions, onError: vi.fn() });
    return { actions, automatic, workspace: workspace as unknown as Record<'refresh' | 'planPush' | 'commitResolvedBatch', ReturnType<typeof vi.fn>> };
}

describe('SourceControlActionService.runManual', () => {
    it('blocks a direct manual mutation until an in-flight automatic run finishes', async () => {
        const commit = deferred();
        const order: string[] = [];
        const h = harness([change('a.md', 'local-modified')], {
            commitResolvedBatch: vi.fn().mockImplementation(async () => {
                order.push('automatic-start');
                await commit.promise;
                order.push('automatic-end');
            }) as never,
        });
        h.workspace.planPush.mockResolvedValue({
            reviewPlan: { ...emptyPlan(), modifications: [{ path: 'a.md', name: 'a.md' }] },
            pushes: [{ path: 'a.md', name: 'a.md', repoPath: 'a.md', content: 'x', existingSha: 's' }],
            moves: [], keepRemote: [], keepLocal: [], skippedConflicts: 0, conflictedPaths: [], cancelled: false,
            immediate: { success: 0, updated: 0, failed: 0, errors: [], syncedPaths: [] },
        });

        const auto = h.automatic.runOnce();
        await vi.waitFor(() => expect(order).toEqual(['automatic-start']));

        const manual = h.actions.runManual(async () => {
            order.push('manual-start');
            order.push('manual-end');
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(order).toEqual(['automatic-start']);

        commit.resolve();
        await auto;
        await manual;
        expect(order).toEqual(['automatic-start', 'automatic-end', 'manual-start', 'manual-end']);
    });

    it('makes an automatic tick skip with zero refresh/plan/mutation, without queueing it', async () => {
        const manualDone = deferred();
        const h = harness([change('a.md', 'local-modified')]);

        const manual = h.actions.runManual(() => manualDone.promise);
        await h.automatic.runOnce();

        expect(h.workspace.refresh).not.toHaveBeenCalled();
        expect(h.workspace.planPush).not.toHaveBeenCalled();
        expect(h.workspace.commitResolvedBatch).not.toHaveBeenCalled();

        manualDone.resolve();
        await manual;
        await Promise.resolve();
        expect(h.workspace.refresh).not.toHaveBeenCalled();

        await h.automatic.runOnce();
        expect(h.workspace.refresh).toHaveBeenCalled();
    });

    it('keeps fairness: a waiting manual operation gets the lock ahead of a fresh automatic tick', async () => {
        const aDone = deferred();
        const order: string[] = [];
        const h = harness([change('a.md', 'local-modified')]);

        const a = h.actions.runManual(async () => { order.push('A'); await aDone.promise; });
        const b = h.actions.runManual(async () => { order.push('B'); });
        aDone.resolve();
        await a;
        await h.automatic.runOnce();
        await b;

        expect(order).toEqual(['A', 'B']);
        expect(h.workspace.refresh).not.toHaveBeenCalled();
    });

    it('does not double-acquire: push/pull/sync on the action service still complete', async () => {
        const h = harness([change('a.md', 'local-modified'), change('b.md', 'remote-modified')]);

        await expect(h.actions.push([toChangeId('a.md')])).resolves.toBeUndefined();
        await expect(h.actions.pull([toChangeId('b.md')])).resolves.toBeUndefined();
        await expect(h.actions.sync([])).resolves.toBeDefined();
        // Guard is released after each: a subsequent runManual is not stuck.
        await expect(h.actions.runManual(async () => 'ok')).resolves.toBe('ok');
    });

    it('releases the guard when the manual operation throws', async () => {
        const h = harness([]);
        await expect(h.actions.runManual(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
        await expect(h.actions.runManual(async () => 'next')).resolves.toBe('next');
    });
});
