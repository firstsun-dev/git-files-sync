import { describe, expect, it, vi } from 'vitest';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { SourceControlActionService } from '../../../src/logic/source-control/SourceControlActionService';
import { toChangeId, type SyncChange } from '../../../src/logic/source-control/types';
import type { SyncWorkspace } from '../../../src/logic/sync/SyncWorkspace';
import type { FileDiff, PushResults, SyncResult } from '../../../src/logic/sync/types';
import type { RemoteDeleteResult } from '../../../src/logic/sync/RemoteDeleteExecutor';

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
        deleteRemote: vi.fn().mockResolvedValue({ deletedPaths: [], errors: [] } as RemoteDeleteResult),
        deleteLocal: vi.fn().mockResolvedValue(undefined),
        moveLocal: vi.fn(),
        clearMetadata: vi.fn(),
        trackRename: vi.fn(),
        getDiff: vi.fn().mockResolvedValue({ path: 'a.md', kind: 'text' } as FileDiff),
        ...overrides,
    } as SyncWorkspace;
}

function buildService(changes: SyncChange[], workspace: SyncWorkspace) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const operations = new OperationState();
    const service = new SourceControlActionService(repository, operations, workspace);
    return { service, operations };
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
            const deleteRemote = vi.fn().mockResolvedValue({ deletedPaths: ['a.md'], errors: [] } as RemoteDeleteResult);
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
            } as FileDiff);
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
            } as FileDiff);
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
