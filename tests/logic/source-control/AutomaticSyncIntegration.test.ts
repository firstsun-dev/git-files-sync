import { describe, expect, it, vi, type Mock } from 'vitest';
import { AutomaticSyncService } from '../../../src/logic/source-control/AutomaticSyncService';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { SourceControlActionService } from '../../../src/logic/source-control/SourceControlActionService';
import { SyncSelectionStore } from '../../../src/logic/source-control/SyncSelectionStore';
import { toChangeId, type SyncChange, type SyncChangeKind } from '../../../src/logic/source-control/types';
import type { PlannedPushBatch } from '../../../src/logic/sync/PushCoordinator';
import type { SyncWorkspace } from '../../../src/logic/sync/SyncWorkspace';
import type { PushResults, SyncPlan, SyncResult } from '../../../src/logic/sync/types';

/**
 * Real AutomaticSyncService + real SourceControlActionService/SyncIntentExecutor/
 * SyncExecutionGuard over a fake SyncWorkspace. Exercises the concurrency and
 * observability contract end to end without a provider.
 */

const change = (path: string, kind: SyncChangeKind): SyncChange => ({ id: toChangeId(path), path, kind });

const emptyPlan = (overrides: Partial<SyncPlan> = {}): SyncPlan => ({ additions: [], modifications: [], deletions: [], moves: [], ...overrides });

function plannedBatch(overrides: Partial<PlannedPushBatch> = {}): PlannedPushBatch {
    return {
        reviewPlan: emptyPlan(),
        pushes: [],
        moves: [],
        keepRemote: [],
        keepLocal: [],
        skippedConflicts: 0,
        conflictedPaths: [],
        cancelled: false,
        immediate: { success: 0, updated: 0, failed: 0, errors: [], syncedPaths: [] },
        ...overrides,
    };
}

const pushBatch = (path: string): PlannedPushBatch => plannedBatch({
    reviewPlan: emptyPlan({ modifications: [{ path, name: path }] }),
    pushes: [{ path, name: path, repoPath: path, content: 'x', existingSha: 'sha' }],
});

const pushResults = (overrides: Partial<PushResults> = {}): PushResults => ({
    success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, resolvedConflicts: 0, skippedConflicts: 0, errors: [], syncedPaths: [], ...overrides,
});

const syncResult = (overrides: Partial<SyncResult> = {}): SyncResult => ({ success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, errors: [], ...overrides });

function harness(changes: SyncChange[], overrides: Partial<SyncWorkspace> = {}) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const workspace = {
        refresh: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(pushResults()),
        pull: vi.fn().mockResolvedValue(syncResult()),
        toRepoPath: (path: string) => path,
        planPush: vi.fn().mockResolvedValue(plannedBatch()),
        planPull: vi.fn().mockResolvedValue(emptyPlan()),
        applyPull: vi.fn().mockResolvedValue(syncResult()),
        commitResolvedBatch: vi.fn().mockResolvedValue(undefined),
        confirmPlan: vi.fn().mockResolvedValue(true),
        ...overrides,
    } as unknown as SyncWorkspace;
    const notify = vi.fn();
    const actions = new SourceControlActionService(repository, new SyncSelectionStore(), new OperationState(), workspace, { notify });
    const onError = vi.fn();
    const automatic = new AutomaticSyncService({ workspace, changes: repository, actions, onError });
    const mocks = workspace as unknown as Record<'refresh' | 'push' | 'planPush' | 'planPull' | 'applyPull' | 'commitResolvedBatch', Mock<(...args: never[]) => Promise<unknown>>>;
    return { automatic, actions, notify, onError, ...mocks };
}

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { promise, resolve };
};

describe('Automatic Sync over the real action service', () => {
    describe('busy guard', () => {
        it('skips a tick entirely while manual work runs: zero refreshes, zero mutations, no queued backlog', async () => {
            const manualPush = deferred();
            const h = harness(
                [change('a.md', 'local-modified'), change('m.md', 'local-only')],
                { push: vi.fn().mockReturnValue(manualPush.promise.then(() => pushResults())) as never },
            );

            const manual = h.actions.push([toChangeId('m.md')]);
            await vi.waitFor(() => expect(h.push).toHaveBeenCalledTimes(1));

            await h.automatic.runOnce();

            expect(h.refresh).not.toHaveBeenCalled();
            expect(h.planPush).not.toHaveBeenCalled();
            expect(h.commitResolvedBatch).not.toHaveBeenCalled();
            expect(h.onError).not.toHaveBeenCalled();

            manualPush.resolve();
            await manual;
            // The skipped tick did not queue: nothing runs on its own afterwards.
            await Promise.resolve();
            expect(h.refresh).not.toHaveBeenCalled();
            expect(h.planPush).not.toHaveBeenCalled();
        });

        it('runs normally on a later tick once the manual operation finished', async () => {
            const manualPush = deferred();
            const h = harness(
                [change('a.md', 'local-modified'), change('m.md', 'local-only')],
                { push: vi.fn().mockReturnValue(manualPush.promise.then(() => pushResults())) as never },
            );
            h.planPush.mockResolvedValue(pushBatch('a.md'));

            const manual = h.actions.push([toChangeId('m.md')]);
            await vi.waitFor(() => expect(h.push).toHaveBeenCalledTimes(1));
            await h.automatic.runOnce();
            manualPush.resolve();
            await manual;

            await h.automatic.runOnce();

            expect(h.refresh).toHaveBeenCalledTimes(2);
            expect(h.commitResolvedBatch).toHaveBeenCalledTimes(1);
        });

        it('still runs a manual sync that waits behind an in-flight automatic run', async () => {
            const commit = deferred();
            const order: string[] = [];
            const h = harness(
                [change('a.md', 'local-modified'), change('m.md', 'local-only')],
                {
                    commitResolvedBatch: vi.fn().mockImplementation(async () => {
                        order.push('auto-commit-start');
                        await commit.promise;
                        order.push('auto-commit-end');
                    }) as never,
                    push: vi.fn().mockImplementation(async () => {
                        order.push('manual-push');
                        return pushResults();
                    }) as never,
                },
            );
            h.planPush.mockResolvedValue(pushBatch('a.md'));

            const auto = h.automatic.runOnce();
            await vi.waitFor(() => expect(order).toEqual(['auto-commit-start']));
            const manual = h.actions.push([toChangeId('m.md')]);

            commit.resolve();
            await auto;
            await manual;

            expect(order).toEqual(['auto-commit-start', 'auto-commit-end', 'manual-push']);
        });

        it('hands the guard to a waiting manual operation ahead of a newly arriving automatic tick', async () => {
            const firstPush = deferred();
            const order: string[] = [];
            const h = harness(
                [change('a.md', 'local-modified'), change('m.md', 'local-only'), change('n.md', 'local-only')],
                {
                    push: vi.fn().mockImplementation(async (paths: string[]) => {
                        order.push(`push:${paths[0]}`);
                        if (paths[0] === 'm.md') await firstPush.promise;
                        return pushResults();
                    }) as never,
                },
            );

            const first = h.actions.push([toChangeId('m.md')]);
            await vi.waitFor(() => expect(order).toEqual(['push:m.md']));
            const waiting = h.actions.push([toChangeId('n.md')]);
            firstPush.resolve();
            await first;
            // The lock passed directly to the waiter, so this tick sees it busy.
            await h.automatic.runOnce();
            await waiting;

            expect(order).toEqual(['push:m.md', 'push:n.md']);
            expect(h.refresh).not.toHaveBeenCalled();
        });
    });

    describe('refresh counts', () => {
        it('refreshes exactly once for an idle vault', async () => {
            const h = harness([]);
            await h.automatic.runOnce();
            expect(h.refresh).toHaveBeenCalledTimes(1);
            expect(h.planPush).not.toHaveBeenCalled();
            expect(h.onError).not.toHaveBeenCalled();
        });

        it('refreshes exactly once when only synced/conflict entries exist and never resolves the conflict', async () => {
            const h = harness([change('s.md', 'synced'), change('c.md', 'conflict')]);
            await h.automatic.runOnce();
            expect(h.refresh).toHaveBeenCalledTimes(1);
            expect(h.planPush).not.toHaveBeenCalled();
            expect(h.commitResolvedBatch).not.toHaveBeenCalled();
            expect(h.onError).not.toHaveBeenCalled();
        });

        it('refreshes before and after a successful run and stays completely silent', async () => {
            const h = harness([change('a.md', 'local-modified')]);
            h.planPush.mockResolvedValue(pushBatch('a.md'));

            await h.automatic.runOnce();

            expect(h.refresh).toHaveBeenCalledTimes(2);
            expect(h.commitResolvedBatch).toHaveBeenCalledTimes(1);
            expect(h.onError).not.toHaveBeenCalled();
            expect(h.notify).not.toHaveBeenCalled();
        });
    });

    describe('failures reach the diagnostic logger, never the user notifier', () => {
        it('logs a planning rejection with no mutation', async () => {
            const h = harness([change('a.md', 'local-modified')]);
            h.planPush.mockRejectedValue(new Error('plan exploded'));

            await h.automatic.runOnce();

            expect(h.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'plan exploded' }));
            expect(h.commitResolvedBatch).not.toHaveBeenCalled();
            expect(h.refresh).toHaveBeenCalledTimes(2);
            expect(h.notify).not.toHaveBeenCalled();
        });

        it('logs a pull planning rejection', async () => {
            const h = harness([change('r.md', 'remote-only')]);
            h.planPull.mockRejectedValue(new Error('pull plan exploded'));

            await h.automatic.runOnce();

            expect(h.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'pull plan exploded' }));
            expect(h.applyPull).not.toHaveBeenCalled();
            expect(h.notify).not.toHaveBeenCalled();
        });

        it('logs a remote commit rejection after attempting the mutation', async () => {
            const h = harness([change('a.md', 'local-modified')]);
            h.planPush.mockResolvedValue(pushBatch('a.md'));
            h.commitResolvedBatch.mockRejectedValue(new Error('commit rejected'));

            await h.automatic.runOnce();

            expect(h.commitResolvedBatch).toHaveBeenCalledTimes(1);
            expect(h.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'commit rejected' }));
            expect(h.refresh).toHaveBeenCalledTimes(2);
            expect(h.notify).not.toHaveBeenCalled();
        });

        it('logs a pull apply rejection after attempting the mutation', async () => {
            const h = harness([change('r.md', 'remote-only')]);
            h.planPull.mockResolvedValue(emptyPlan({ additions: [{ path: 'r.md', name: 'r.md' }] }));
            h.applyPull.mockRejectedValue(new Error('pull rejected'));

            await h.automatic.runOnce();

            expect(h.applyPull).toHaveBeenCalledTimes(1);
            expect(h.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'pull rejected' }));
            expect(h.refresh).toHaveBeenCalledTimes(2);
            expect(h.notify).not.toHaveBeenCalled();
        });

        it('logs provider-returned per-file errors from the commit', async () => {
            const h = harness([change('a.md', 'local-modified')]);
            h.planPush.mockResolvedValue(pushBatch('a.md'));
            const failWithProviderError = (...args: unknown[]): Promise<void> => {
                const results = args[5] as PushResults;
                results.failed = 1;
                results.errors.push({ file: 'a.md', error: 'HTTP 500' });
                return Promise.resolve();
            };
            h.commitResolvedBatch.mockImplementation(failWithProviderError);

            await h.automatic.runOnce();

            expect(h.onError).toHaveBeenCalledTimes(1);
            expect((h.onError.mock.calls[0]?.[0] as Error).message).toContain('a.md: HTTP 500');
            expect(h.notify).not.toHaveBeenCalled();
        });

        it('logs provider-returned per-file errors from the pull', async () => {
            const h = harness([change('r.md', 'remote-only')]);
            h.planPull.mockResolvedValue(emptyPlan({ additions: [{ path: 'r.md', name: 'r.md' }] }));
            h.applyPull.mockResolvedValue(syncResult({ failed: 1, errors: [{ file: 'r.md', error: 'HTTP 404' }] }));

            await h.automatic.runOnce();

            expect(h.onError).toHaveBeenCalledTimes(1);
            expect((h.onError.mock.calls[0]?.[0] as Error).message).toContain('r.md: HTTP 404');
        });

        it('does not log skipped conflicts as errors and keeps syncing the safe paths', async () => {
            const h = harness([change('safe.md', 'local-modified'), change('clash.md', 'local-modified')]);
            h.planPush.mockResolvedValue(plannedBatch({
                ...pushBatch('safe.md'),
                conflictedPaths: ['clash.md'],
                skippedConflicts: 1,
            }));

            await h.automatic.runOnce();

            expect(h.commitResolvedBatch).toHaveBeenCalledTimes(1);
            expect(h.onError).not.toHaveBeenCalled();
            expect(h.notify).not.toHaveBeenCalled();
        });
    });
});
