import { describe, expect, it, vi } from 'vitest';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { SourceControlActionService } from '../../../src/logic/source-control/SourceControlActionService';
import { SyncSelectionStore } from '../../../src/logic/source-control/SyncSelectionStore';
import { toChangeId, type SyncChange, type SyncChangeKind } from '../../../src/logic/source-control/types';
import type { SyncWorkspace } from '../../../src/logic/sync/SyncWorkspace';
import type { PushResults, SyncPlan, SyncResult } from '../../../src/logic/sync/types';

const change = (path: string, kind: SyncChangeKind): SyncChange => ({ id: toChangeId(path), path, kind });
const emptyPlan = (): SyncPlan => ({ additions: [], modifications: [], deletions: [], moves: [] });
const pushResults = (): PushResults => ({
    success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, resolvedConflicts: 0, skippedConflicts: 0, errors: [], syncedPaths: [],
});
const syncResult = (): SyncResult => ({ success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, errors: [] });
const plannedPush = () => ({
    reviewPlan: { ...emptyPlan(), modifications: [{ path: 'a.md', name: 'a.md' }] },
    pushes: [{ path: 'a.md', name: 'a.md', repoPath: 'a.md', content: 'x', existingSha: 's' }],
    moves: [], keepRemote: [], keepLocal: [], skippedConflicts: 0, conflictedPaths: [], cancelled: false,
    immediate: { success: 0, updated: 0, failed: 0, errors: [], syncedPaths: [] },
});

function harness(changes: SyncChange[]) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const workspace = {
        refresh: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(pushResults()),
        pull: vi.fn().mockResolvedValue(syncResult()),
        deleteRemote: vi.fn().mockResolvedValue({ deletedPaths: [], errors: [] }),
        deleteLocal: vi.fn().mockResolvedValue(undefined),
        toRepoPath: (path: string) => path,
        planPush: vi.fn().mockResolvedValue(plannedPush()),
        planPull: vi.fn().mockResolvedValue({ ...emptyPlan(), modifications: [{ path: 'b.md', name: 'b.md' }] }),
        applyPull: vi.fn().mockResolvedValue(syncResult()),
        commitResolvedBatch: vi.fn().mockResolvedValue(undefined),
        confirmPlan: vi.fn().mockResolvedValue(true),
    };
    const actions = new SourceControlActionService(
        repository, new SyncSelectionStore(), new OperationState(), workspace as unknown as SyncWorkspace,
    );
    return { actions, repository, workspace };
}

describe('unattended execution safety flags', () => {
    it('background runs revalidate the remote before commit and forbid unbaselined pulls', async () => {
        const h = harness([change('a.md', 'local-modified'), change('b.md', 'remote-modified')]);

        await h.actions.runBackground(session => session.sync([
            { changeId: toChangeId('a.md'), action: 'push' },
            { changeId: toChangeId('b.md'), action: 'pull' },
        ]));

        expect(h.workspace.commitResolvedBatch.mock.calls[0]?.[6]).toEqual({ revalidateRemote: true });
        expect(h.workspace.applyPull).toHaveBeenCalledWith(['b.md'], { notify: false, requireBaseline: true });
    });

    it('interactive manual sync keeps the unchanged commit/pull behavior', async () => {
        const h = harness([change('a.md', 'local-modified'), change('b.md', 'remote-modified')]);

        await h.actions.sync([
            { changeId: toChangeId('a.md'), action: 'push' },
            { changeId: toChangeId('b.md'), action: 'pull' },
        ]);

        expect(h.workspace.commitResolvedBatch.mock.calls[0]?.[6]).toBeUndefined();
        expect(h.workspace.applyPull).toHaveBeenCalledWith(['b.md'], { notify: false });
    });
});

describe('manual action targets are re-resolved after the shared guard is acquired', () => {
    async function gate() {
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        return { held, release };
    }

    it.each(['push', 'pull', 'deleteRemote', 'deleteLocal'] as const)(
        '%s does not act on a change removed while it waited for the guard',
        async method => {
            const h = harness([change('a.md', 'local-modified')]);
            const { held, release } = await gate();
            const blocker = h.actions.runManual(() => held);

            const pending = h.actions[method]([toChangeId('a.md')]);
            // The queue refreshed (a background run finished) while the manual action waited.
            h.repository.replace([]);
            release();
            await blocker;
            await pending;

            for (const call of ['push', 'pull', 'deleteRemote', 'deleteLocal'] as const) {
                expect(h.workspace[call]).not.toHaveBeenCalled();
            }
        },
    );

    it('resolveConflict does not push a conflict that was resolved while it waited', async () => {
        const h = harness([change('a.md', 'conflict')]);
        const { held, release } = await gate();
        const blocker = h.actions.runManual(() => held);

        const pending = h.actions.resolveConflict(toChangeId('a.md'), 'local');
        h.repository.replace([]);
        release();
        await blocker;
        await pending;

        expect(h.workspace.push).not.toHaveBeenCalled();
    });

    it('push uses the change as it exists after the wait, not the stale snapshot', async () => {
        const h = harness([change('a.md', 'local-modified')]);
        const { held, release } = await gate();
        const blocker = h.actions.runManual(() => held);

        const pending = h.actions.push([toChangeId('a.md')]);
        h.repository.replace([change('a.md', 'synced')]);
        release();
        await blocker;
        await pending;

        expect(h.workspace.push).toHaveBeenCalledWith(['a.md']);
    });
});
