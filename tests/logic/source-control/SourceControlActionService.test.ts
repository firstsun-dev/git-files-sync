import { describe, expect, it, vi } from 'vitest';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { SourceControlActionService } from '../../../src/logic/source-control/SourceControlActionService';
import type { SyncExecutionResult, SyncResultNotificationPort } from '../../../src/logic/source-control/SyncResultNotifier';
import type { PlannedPushBatch } from '../../../src/logic/sync/PushCoordinator';
import { toChangeId, type SyncChange } from '../../../src/logic/source-control/types';
import type { SyncWorkspace } from '../../../src/logic/sync/SyncWorkspace';
import type { PushResults, SyncPlan, SyncResult } from '../../../src/logic/sync/types';

function emptySyncPlan(overrides: Partial<SyncPlan> = {}): SyncPlan {
    return { additions: [], modifications: [], deletions: [], moves: [], ...overrides };
}

function emptyPlannedBatch(overrides: Partial<PlannedPushBatch> = {}): PlannedPushBatch {
    return {
        reviewPlan: emptySyncPlan(),
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

function emptyPushResults(overrides: Partial<PushResults> = {}): PushResults {
    return {
        success: 0,
        added: 0,
        updated: 0,
        failed: 0,
        conflicts: 0,
        resolvedConflicts: 0,
        skippedConflicts: 0,
        errors: [],
        syncedPaths: [],
        ...overrides,
    };
}

function emptySyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
    return { success: 0, added: 0, updated: 0, failed: 0, conflicts: 0, errors: [], ...overrides };
}

function fakeWorkspace(overrides: Partial<SyncWorkspace> = {}): SyncWorkspace {
    return {
        getStatuses: () => [],
        getInfo: () => ({ serviceName: 'GitHub', branch: 'main', vaultFolder: '' }),
        getRemoteFileUrl: () => null,
        refresh: vi.fn(),
        push: vi.fn().mockResolvedValue(emptyPushResults()),
        pull: vi.fn().mockResolvedValue(emptySyncResult()),
        pullOne: vi.fn().mockResolvedValue(undefined),
        deleteRemote: vi.fn().mockResolvedValue({ deletedPaths: [], errors: [] }),
        deleteLocal: vi.fn().mockResolvedValue(undefined),
        moveLocal: vi.fn(),
        clearMetadata: vi.fn(),
        trackRename: vi.fn(),
        getDiff: vi.fn().mockResolvedValue({ path: 'a.md', kind: 'text' }),
        toRepoPath: (path: string) => path,
        planPush: vi.fn().mockResolvedValue(emptyPlannedBatch()),
        planPull: vi.fn().mockResolvedValue(emptySyncPlan()),
        applyPull: vi.fn().mockResolvedValue(emptySyncResult()),
        commitResolvedBatch: vi.fn().mockResolvedValue(undefined),
        confirmPlan: vi.fn().mockResolvedValue(true),
        ...overrides,
    };
}

function buildService(
    changes: SyncChange[],
    workspace: SyncWorkspace,
    notifier: SyncResultNotificationPort = { notify: vi.fn() },
) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const operations = new OperationState();
    const service = new SourceControlActionService(repository, operations, workspace, notifier);
    return { service, operations, notifier };
}

describe('SourceControlActionService', () => {
    describe('push', () => {
        it('pushes a single change and marks it running then success', async () => {
            const push = vi.fn().mockResolvedValue(emptyPushResults({ syncedPaths: [{ path: 'a.md', sha: 'sha-1' }] }));
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                fakeWorkspace({ push }),
            );

            const promise = service.push([toChangeId('c-1')]);
            expect(operations.get(toChangeId('c-1'))).toBe('running');
            await promise;

            expect(push).toHaveBeenCalledWith(['a.md']);
            expect(operations.get(toChangeId('c-1'))).toBe('success');
        });

        it('pushes a batch of changes together in one SyncWorkspace call', async () => {
            const push = vi.fn().mockResolvedValue(emptyPushResults({
                syncedPaths: [{ path: 'a.md' }, { path: 'b.md' }],
            }));
            const { service, operations } = buildService(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
                ],
                fakeWorkspace({ push }),
            );

            await service.push([toChangeId('c-1'), toChangeId('c-2')]);

            expect(push).toHaveBeenCalledTimes(1);
            expect(push).toHaveBeenCalledWith(['a.md', 'b.md']);
            expect(operations.get(toChangeId('c-1'))).toBe('success');
            expect(operations.get(toChangeId('c-2'))).toBe('success');
        });

        it('marks only the failed change as failed when the batch partially errors', async () => {
            const push = vi.fn().mockResolvedValue(emptyPushResults({
                syncedPaths: [{ path: 'a.md' }],
                errors: [{ file: 'b.md', error: 'boom' }],
            }));
            const { service, operations } = buildService(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
                ],
                fakeWorkspace({ push }),
            );

            await service.push([toChangeId('c-1'), toChangeId('c-2')]);

            expect(operations.get(toChangeId('c-1'))).toBe('success');
            expect(operations.get(toChangeId('c-2'))).toBe('failed');
        });

        it('fails every targeted change when SyncWorkspace throws', async () => {
            const push = vi.fn().mockRejectedValue(new Error('network down'));
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                fakeWorkspace({ push }),
            );

            await service.push([toChangeId('c-1')]);

            expect(operations.get(toChangeId('c-1'))).toBe('failed');
        });
    });

    describe('sync', () => {
        it('commits a modified file and a locally-deleted file once, then shows one unified completion result', async () => {
            const commitResolvedBatch = vi.fn().mockResolvedValue(undefined);
            const notify = vi.fn();
            const planPush = vi.fn().mockResolvedValue(emptyPlannedBatch({
                reviewPlan: emptySyncPlan({ modifications: [{ path: 'a.md', name: 'a.md' }] }),
                pushes: [{ path: 'a.md', name: 'a.md', repoPath: 'a.md', content: 'updated', existingSha: 'sha-a' }],
            }));
            const { service, operations } = buildService(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' },
                    { id: toChangeId('c-2'), path: 'gone.md', kind: 'local-deleted' },
                ],
                fakeWorkspace({ planPush, commitResolvedBatch }),
                { notify },
            );

            await service.sync([toChangeId('c-1'), toChangeId('c-2')]);

            expect(commitResolvedBatch).toHaveBeenCalledTimes(1);
            expect(commitResolvedBatch).toHaveBeenCalledWith(
                [expect.objectContaining({ path: 'a.md' })],
                [],
                [expect.objectContaining({ path: 'gone.md', repoPath: 'gone.md' })],
                [],
                [],
                expect.any(Object),
            );
            expect(operations.get(toChangeId('c-1'))).toBe('success');
            expect(operations.get(toChangeId('c-2'))).toBe('success');
            expect(notify).toHaveBeenCalledTimes(1);
            expect(notify).toHaveBeenCalledWith(expect.objectContaining({ updated: 1, deleted: 1, downloaded: 0 }));
        });

        it('creates zero commits for a pure-pull sync selection', async () => {
            const commitResolvedBatch = vi.fn().mockResolvedValue(undefined);
            const planPush = vi.fn();
            const applyPull = vi.fn().mockResolvedValue({ success: 1, added: 1, updated: 0, failed: 0, conflicts: 0, errors: [] });
            const planPull = vi.fn().mockResolvedValue(emptySyncPlan({ additions: [{ path: 'remote.md', name: 'remote.md' }] }));
            const notify = vi.fn();
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'remote.md', kind: 'remote-only' }],
                fakeWorkspace({ planPush, planPull, applyPull, commitResolvedBatch }),
                { notify },
            );

            await service.sync([toChangeId('c-1')]);

            expect(planPush).not.toHaveBeenCalled();
            expect(commitResolvedBatch).not.toHaveBeenCalled();
            expect(applyPull).toHaveBeenCalledWith(['remote.md'], { notify: false });
            expect(operations.get(toChangeId('c-1'))).toBe('success');
            expect(notify).toHaveBeenCalledTimes(1);
            expect(notify).toHaveBeenCalledWith(expect.objectContaining({ downloaded: 1 }));
        });

        it('aggregates mixed remote and pull results into one partial notification', async () => {
            const notify = vi.fn();
            const commitResolvedBatch = vi.fn(async (_pushes, _moves, _deletions, _keepRemote, _keepLocal, results: PushResults) => {
                results.updated = 1;
                results.errors.push({ file: 'gone.md', error: 'locked' });
                results.failed = 1;
            });
            const planPush = vi.fn().mockResolvedValue(emptyPlannedBatch({
                reviewPlan: emptySyncPlan({ modifications: [{ path: 'a.md', name: 'a.md' }] }),
                pushes: [{ path: 'a.md', name: 'a.md', repoPath: 'a.md', content: 'updated', existingSha: 'sha-a' }],
            }));
            const applyPull = vi.fn().mockResolvedValue(emptySyncResult({ added: 1, success: 1 }));
            const { service } = buildService(
                [
                    { id: toChangeId('update'), path: 'a.md', kind: 'local-modified' },
                    { id: toChangeId('delete'), path: 'gone.md', kind: 'local-deleted' },
                    { id: toChangeId('download'), path: 'remote.md', kind: 'remote-only' },
                ],
                fakeWorkspace({ planPush, applyPull, commitResolvedBatch }),
                { notify },
            );

            await service.sync([toChangeId('update'), toChangeId('delete'), toChangeId('download')]);

            expect(commitResolvedBatch).toHaveBeenCalledTimes(1);
            expect(applyPull).toHaveBeenCalledWith(['remote.md'], { notify: false });
            expect(notify).toHaveBeenCalledTimes(1);
            expect(notify).toHaveBeenCalledWith(expect.objectContaining({
                updated: 1, deleted: 0, downloaded: 1, failed: 1,
            } satisfies Partial<SyncExecutionResult>));
        });

        it('reports a thrown execution as one total-failure notification', async () => {
            const notify = vi.fn();
            const planPush = vi.fn().mockResolvedValue(emptyPlannedBatch({
                reviewPlan: emptySyncPlan({ modifications: [{ path: 'a.md', name: 'a.md' }] }),
                pushes: [{ path: 'a.md', name: 'a.md', repoPath: 'a.md', content: 'updated', existingSha: 'sha-a' }],
            }));
            const { service, operations } = buildService(
                [{ id: toChangeId('update'), path: 'a.md', kind: 'local-modified' }],
                fakeWorkspace({ planPush, commitResolvedBatch: vi.fn().mockRejectedValue(new Error('offline')) }),
                { notify },
            );

            await service.sync([toChangeId('update')]);

            expect(operations.get(toChangeId('update'))).toBe('failed');
            expect(notify).toHaveBeenCalledTimes(1);
            expect(notify).toHaveBeenCalledWith(expect.objectContaining({ failed: 1 }));
        });

        it('does not commit or mark anything when the merged plan is cancelled at confirm', async () => {
            const commitResolvedBatch = vi.fn().mockResolvedValue(undefined);
            const confirmPlan = vi.fn().mockResolvedValue(false);
            const planPush = vi.fn().mockResolvedValue(emptyPlannedBatch({
                reviewPlan: emptySyncPlan({ modifications: [{ path: 'a.md', name: 'a.md' }] }),
                pushes: [{ path: 'a.md', name: 'a.md', repoPath: 'a.md', content: 'updated' }],
            }));
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                fakeWorkspace({ planPush, confirmPlan, commitResolvedBatch }),
            );

            await service.sync([toChangeId('c-1')]);

            expect(confirmPlan).toHaveBeenCalledWith(expect.any(Object), 'sync');
            expect(commitResolvedBatch).not.toHaveBeenCalled();
            expect(operations.get(toChangeId('c-1'))).toBe('idle');
        });

        it('aborts before confirming when batch conflict resolution itself was cancelled', async () => {
            const confirmPlan = vi.fn().mockResolvedValue(true);
            const commitResolvedBatch = vi.fn().mockResolvedValue(undefined);
            const planPush = vi.fn().mockResolvedValue(emptyPlannedBatch({ cancelled: true }));
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                fakeWorkspace({ planPush, confirmPlan, commitResolvedBatch }),
            );

            await service.sync([toChangeId('c-1')]);

            expect(confirmPlan).not.toHaveBeenCalled();
            expect(commitResolvedBatch).not.toHaveBeenCalled();
            expect(operations.get(toChangeId('c-1'))).toBe('idle');
        });
    });

    describe('pull', () => {
        it('pulls the given changes through SyncWorkspace.pull', async () => {
            const pull = vi.fn().mockResolvedValue(emptySyncResult());
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'remote-only' }],
                fakeWorkspace({ pull }),
            );

            await service.pull([toChangeId('c-1')]);

            expect(pull).toHaveBeenCalledWith(['a.md']);
            expect(operations.get(toChangeId('c-1'))).toBe('success');
        });

        it('marks a change failed when it appears in the pull error list', async () => {
            const pull = vi.fn().mockResolvedValue(emptySyncResult({ errors: [{ file: 'a.md', error: 'conflict' }] }));
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'remote-only' }],
                fakeWorkspace({ pull }),
            );

            await service.pull([toChangeId('c-1')]);

            expect(operations.get(toChangeId('c-1'))).toBe('failed');
        });
    });

    describe('deleteRemote / deleteLocal', () => {
        it('deletes selected changes from the remote', async () => {
            const deleteRemote = vi.fn().mockResolvedValue({ deletedPaths: ['a.md'], errors: [] });
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'remote-only' }],
                fakeWorkspace({ deleteRemote }),
            );

            await service.deleteRemote([toChangeId('c-1')]);

            expect(deleteRemote).toHaveBeenCalledWith(['a.md']);
            expect(operations.get(toChangeId('c-1'))).toBe('success');
        });

        it('deletes selected changes locally, one at a time, independent of each other', async () => {
            const deleteLocal = vi.fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('locked'));
            const { service, operations } = buildService(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'local-only' },
                ],
                fakeWorkspace({ deleteLocal }),
            );

            await service.deleteLocal([toChangeId('c-1'), toChangeId('c-2')]);

            expect(deleteLocal).toHaveBeenCalledTimes(2);
            expect(operations.get(toChangeId('c-1'))).toBe('success');
            expect(operations.get(toChangeId('c-2'))).toBe('failed');
        });
    });

    describe('resolveConflict', () => {
        it('pushes the local copy when resolution is "local"', async () => {
            const push = vi.fn().mockResolvedValue(emptyPushResults());
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'conflict' }],
                fakeWorkspace({ push }),
            );

            await service.resolveConflict(toChangeId('c-1'), 'local');

            expect(push).toHaveBeenCalledWith(['a.md']);
            expect(operations.get(toChangeId('c-1'))).toBe('success');
        });

        it('pulls the remote copy when resolution is "remote"', async () => {
            const pullOne = vi.fn().mockResolvedValue(undefined);
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'conflict' }],
                fakeWorkspace({ pullOne }),
            );

            await service.resolveConflict(toChangeId('c-1'), 'remote');

            expect(pullOne).toHaveBeenCalledWith('a.md');
            expect(operations.get(toChangeId('c-1'))).toBe('success');
        });

        it('marks the change failed when the resolution attempt throws', async () => {
            const pullOne = vi.fn().mockRejectedValue(new Error('boom'));
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'conflict' }],
                fakeWorkspace({ pullOne }),
            );

            await service.resolveConflict(toChangeId('c-1'), 'remote');

            expect(operations.get(toChangeId('c-1'))).toBe('failed');
        });
    });

    describe('invalid ChangeId', () => {
        it('push is a no-op and never calls SyncWorkspace for an unknown ChangeId', async () => {
            const push = vi.fn();
            const { service } = buildService([], fakeWorkspace({ push }));

            await service.push([toChangeId('does-not-exist')]);

            expect(push).not.toHaveBeenCalled();
        });

        it('skips unknown ids in a mixed batch but still acts on the known ones', async () => {
            const push = vi.fn().mockResolvedValue(emptyPushResults({ syncedPaths: [{ path: 'a.md' }] }));
            const { service, operations } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                fakeWorkspace({ push }),
            );

            await service.push([toChangeId('c-1'), toChangeId('ghost')]);

            expect(push).toHaveBeenCalledWith(['a.md']);
            expect(operations.get(toChangeId('c-1'))).toBe('success');
            expect(operations.get(toChangeId('ghost'))).toBe('idle');
        });

        it('resolveConflict is a no-op for an unknown ChangeId', async () => {
            const pullOne = vi.fn();
            const { service } = buildService([], fakeWorkspace({ pullOne }));

            await service.resolveConflict(toChangeId('does-not-exist'), 'remote');

            expect(pullOne).not.toHaveBeenCalled();
        });
    });

    describe('loadDiffContent', () => {
        it('returns text diff content when both sides are strings', async () => {
            const getDiff = vi.fn().mockResolvedValue({
                path: 'a.md',
                localContent: 'local text',
                remoteContent: 'remote text',
                kind: 'text',
            });
            const { service } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                fakeWorkspace({ getDiff }),
            );

            const content = await service.loadDiffContent({
                id: toChangeId('c-1'),
                path: 'a.md',
                kind: 'local-modified',
                isSelectedForSync: false,
                operationStatus: 'idle',
            });

            expect(getDiff).toHaveBeenCalledWith('a.md');
            expect(content).toEqual({ remote: 'remote text', local: 'local text' });
        });

        it('returns null for a binary/symlink diff that cannot render as text', async () => {
            const getDiff = vi.fn().mockResolvedValue({
                path: 'a.png',
                localContent: undefined,
                remoteContent: undefined,
                kind: 'binary',
            });
            const { service } = buildService(
                [{ id: toChangeId('c-1'), path: 'a.png', kind: 'local-modified' }],
                fakeWorkspace({ getDiff }),
            );

            const content = await service.loadDiffContent({
                id: toChangeId('c-1'),
                path: 'a.png',
                kind: 'local-modified',
                isSelectedForSync: false,
                operationStatus: 'idle',
            });

            expect(content).toBeNull();
        });
    });
});
