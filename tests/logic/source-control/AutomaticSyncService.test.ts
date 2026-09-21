import { describe, expect, it, vi } from 'vitest';
import { AutomaticSyncService } from '../../../src/logic/source-control/AutomaticSyncService';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import type { SyncExecutionMode } from '../../../src/logic/source-control/SyncIntentExecutor';
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

function buildService(changes: SyncChange[], overrides: {
    refresh?: () => Promise<SyncStatusRefreshResult>;
    sync?: (intents: readonly SyncIntentRequest[], mode?: SyncExecutionMode) => Promise<void>;
    onError?: (error: unknown) => void;
} = {}) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const refresh = vi.fn(overrides.refresh ?? (() => Promise.resolve(emptyRefreshResult())));
    const sync = vi.fn(overrides.sync ?? (() => Promise.resolve(undefined)));
    const service = new AutomaticSyncService({
        workspace: { refresh },
        changes: repository,
        actions: { sync },
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
        const sync = vi.fn().mockImplementation(async () => { order.push('sync'); });
        const service = new AutomaticSyncService({
            workspace: { refresh },
            changes: repository,
            actions: { sync },
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

        const [intents, mode] = sync.mock.calls[0] as [SyncIntentRequest[], SyncExecutionMode];
        expect(mode).toBe('background');
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
        // Still refreshes before/after so the panel reflects current state.
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('does not execute concurrently on overlapping runOnce calls; the second tick is skipped', async () => {
        let releaseFirst: (() => void) | undefined;
        const firstRun = new Promise<void>(resolve => { releaseFirst = resolve; });
        const { service, sync } = buildService([change('a.md', 'local-only')], {
            sync: () => firstRun,
        });

        const first = service.runOnce();
        const second = service.runOnce();

        // The overlapping call returns immediately without a second sync.
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
            .mockResolvedValueOnce(undefined);
        const { service } = buildService([change('a.md', 'local-only')], { sync, onError });

        await service.runOnce();
        expect(onError).toHaveBeenCalledTimes(1);

        // A later tick still runs and does not swallow the fresh call.
        await service.runOnce();
        expect(sync).toHaveBeenCalledTimes(2);
    });
});
