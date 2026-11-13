import { describe, expect, it, vi } from 'vitest';
import { AutomaticSyncService, type AutomaticSyncDependencies } from '../../../src/logic/source-control/AutomaticSyncService';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import type { BackgroundRunOutcome, BackgroundSyncSession } from '../../../src/logic/source-control/SourceControlActionService';
import type { SyncExecutionOutcome } from '../../../src/logic/source-control/SyncIntentExecutor';
import type { SyncIntentRequest } from '../../../src/logic/source-control/SyncIntent';
import { toChangeId } from '../../../src/logic/source-control/types';
import type { SyncChange, SyncChangeKind } from '../../../src/logic/source-control/types';
import type { SyncStatusRefreshResult } from '../../../src/logic/sync/SyncStatusRefreshService';

function change(path: string, kind: SyncChangeKind): SyncChange {
    return { id: toChangeId(path), path, kind };
}

function emptyRefreshResult(): SyncStatusRefreshResult {
    return {} as SyncStatusRefreshResult;
}

function completedOutcome(overrides: Partial<SyncExecutionOutcome> = {}): SyncExecutionOutcome {
    return { status: 'completed', failures: [], ...overrides };
}

function buildService(changes: SyncChange[], overrides: {
    refresh?: () => Promise<SyncStatusRefreshResult>;
    sync?: (intents: readonly SyncIntentRequest[]) => Promise<SyncExecutionOutcome>;
    busy?: boolean;
    onError?: (error: unknown) => void;
} = {}) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const refresh = vi.fn(overrides.refresh ?? (() => Promise.resolve(emptyRefreshResult())));
    const sync = vi.fn(overrides.sync ?? (() => Promise.resolve(completedOutcome())));
    const runBackground = vi.fn(async function <T>(task: (session: BackgroundSyncSession) => Promise<T>): Promise<BackgroundRunOutcome<T>> {
        if (overrides.busy) return { status: 'skipped-busy' };
        return { status: 'completed', value: await task({ sync }) };
    }) as AutomaticSyncDependencies['actions']['runBackground'] & ReturnType<typeof vi.fn>;
    const service = new AutomaticSyncService({
        workspace: { refresh },
        changes: repository,
        actions: { runBackground },
        onError: overrides.onError,
    });
    return { service, refresh, sync, repository };
}

describe('AutomaticSyncService', () => {
    it('refreshes authoritative state before and after execution, and uses the refreshed repository snapshot', async () => {
        const order: string[] = [];
        const repository = new ChangeRepository();
        const refresh = vi.fn()
            .mockImplementation(async () => {
                if (!repository.getById(toChangeId('note.md'))) {
                    repository.replace([change('note.md', 'local-modified')]);
                }
                order.push('refresh');
            });
        const sync = vi.fn().mockImplementation(async () => { order.push('sync'); return completedOutcome(); });
        const service = new AutomaticSyncService({
            workspace: { refresh },
            changes: repository,
            actions: {
                runBackground: async task => ({ status: 'completed', value: await task({ sync }) }),
            },
        });

        await service.runOnce();

        expect(refresh).toHaveBeenCalledTimes(2);
        // Intent generation read the repository only after the first refresh.
        expect(sync).toHaveBeenCalledTimes(1);
        const intents = sync.mock.calls[0]?.[0] as SyncIntentRequest[];
        expect(intents.map(intent => intent.changeId)).toContain(toChangeId('note.md'));
        expect(order).toEqual(['refresh', 'sync', 'refresh']);
    });

    it('excludes synced and already-conflicted changes from intent generation', async () => {
        const { service, sync } = buildService([
            change('a.md', 'local-only'),
            change('b.md', 'remote-only'),
            change('synced.md', 'synced'),
            change('conflict.md', 'conflict'),
        ]);

        await service.runOnce();

        const intents = sync.mock.calls[0]?.[0] as SyncIntentRequest[];
        const paths = intents.map(intent => intent.changeId);
        expect(paths).toEqual([toChangeId('a.md'), toChangeId('b.md')]);
    });

    it('routes each change through the default action policy and executes in background mode', async () => {
        const { service, sync } = buildService([
            change('push.md', 'local-modified'),
            change('pull.md', 'remote-modified'),
            change('delete.md', 'local-deleted'),
            change('move.md', 'moved'),
        ]);

        await service.runOnce();

        const [intents] = sync.mock.calls[0] as [SyncIntentRequest[]];
        expect(intents).toEqual([
            { changeId: toChangeId('push.md'), action: 'push' },
            { changeId: toChangeId('pull.md'), action: 'pull' },
            { changeId: toChangeId('delete.md'), action: 'delete-remote' },
            { changeId: toChangeId('move.md'), action: 'push' },
        ]);
    });

    it('performs no mutation when there are no pending changes', async () => {
        const { service, sync, refresh } = buildService([
            change('synced.md', 'synced'),
            change('conflict.md', 'conflict'),
        ]);

        await service.runOnce();

        expect(sync).not.toHaveBeenCalled();
        // Exactly one refresh: nothing was executed, so a second poll would
        // only double provider traffic on an idle vault.
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('performs no refresh and no sync when the execution guard is busy', async () => {
        const { service, sync, refresh } = buildService([change('a.md', 'local-only')], { busy: true });

        await service.runOnce();

        expect(refresh).not.toHaveBeenCalled();
        expect(sync).not.toHaveBeenCalled();
    });

    it('does not execute concurrently on overlapping runOnce calls; the second tick is skipped', async () => {
        let releaseFirst: (() => void) | undefined;
        const firstRun = new Promise<SyncExecutionOutcome>(resolve => {
            releaseFirst = () => resolve(completedOutcome());
        });
        const { service, sync } = buildService([change('a.md', 'local-only')], {
            sync: () => firstRun,
        });

        const first = service.runOnce();
        const second = service.runOnce();

        await second;
        expect(sync).toHaveBeenCalledTimes(1);

        releaseFirst?.();
        await first;
        expect(sync).toHaveBeenCalledTimes(1);
    });

    it('is not left permanently locked after an execution error, and reports it', async () => {
        const onError = vi.fn();
        const sync = vi.fn()
            .mockRejectedValueOnce(new Error('provider down'))
            .mockResolvedValueOnce(completedOutcome());
        const { service } = buildService([change('a.md', 'local-only')], { sync, onError });

        await service.runOnce();
        expect(onError).toHaveBeenCalledTimes(1);

        await service.runOnce();
        expect(sync).toHaveBeenCalledTimes(2);
    });

    describe('outcome diagnostics', () => {
        const zero = { added: 0, updated: 0, moved: 0, deleted: 0, downloaded: 0, acceptedRemote: 0, failed: 0, conflicts: 0, skippedConflicts: 0, errors: [] };

        it('stays silent and refreshes twice after a successful run', async () => {
            const onError = vi.fn();
            const { service, refresh } = buildService([change('a.md', 'local-only')], {
                onError,
                sync: async () => completedOutcome({ result: { ...zero, added: 1 } }),
            });

            await service.runOnce();

            expect(onError).not.toHaveBeenCalled();
            expect(refresh).toHaveBeenCalledTimes(2);
        });

        it('does not treat skipped conflicts as errors', async () => {
            const onError = vi.fn();
            const { service } = buildService([change('a.md', 'local-only')], {
                onError,
                sync: async () => completedOutcome({ result: { ...zero, skippedConflicts: 2, conflicts: 1 } }),
            });

            await service.runOnce();

            expect(onError).not.toHaveBeenCalled();
        });

        it('logs thrown executor failures and still refreshes afterwards', async () => {
            const onError = vi.fn();
            const boom = new Error('commit rejected');
            const { service, refresh } = buildService([change('a.md', 'local-only')], {
                onError,
                sync: async () => completedOutcome({ result: { ...zero, failed: 1 }, failures: [boom] }),
            });

            await service.runOnce();

            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError).toHaveBeenCalledWith(boom);
            expect(refresh).toHaveBeenCalledTimes(2);
        });

        it('logs provider-returned per-file errors', async () => {
            const onError = vi.fn();
            const { service } = buildService([change('a.md', 'local-only')], {
                onError,
                sync: async () => completedOutcome({
                    result: { ...zero, failed: 1, errors: [{ file: 'a.md', error: 'HTTP 500' }] },
                }),
            });

            await service.runOnce();

            expect(onError).toHaveBeenCalledTimes(1);
            expect((onError.mock.calls[0]?.[0] as Error).message).toContain('a.md: HTTP 500');
        });
    });
});
