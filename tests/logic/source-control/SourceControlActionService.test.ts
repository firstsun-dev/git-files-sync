import { describe, expect, it, vi } from 'vitest';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { InvalidChangeIdError, SourceControlActionService, type SyncPlanExecutor } from '../../../src/logic/source-control/SourceControlActionService';
import { toChangeId, type SyncChange, type SyncPlan } from '../../../src/logic/source-control/types';

function buildService(changes: SyncChange[]) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const execute = vi.fn<SyncPlanExecutor['execute']>().mockResolvedValue(undefined);
    const executor: SyncPlanExecutor = { execute };
    const service = new SourceControlActionService(repository, executor);
    return { service, execute };
}

describe('SourceControlActionService', () => {
    it('builds a push SyncPlan for a single file and delegates it to the executor', async () => {
        const change: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' };
        const { service, execute } = buildService([change]);

        await service.push([toChangeId('c-1')]);

        const plan: SyncPlan = { action: 'push', changes: [change] };
        expect(execute).toHaveBeenCalledExactlyOnceWith(plan);
    });

    it('builds a push SyncPlan for multiple files, preserving order', async () => {
        const a: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' };
        const b: SyncChange = { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' };
        const { service, execute } = buildService([a, b]);

        await service.push([toChangeId('c-1'), toChangeId('c-2')]);

        expect(execute).toHaveBeenCalledExactlyOnceWith({ action: 'push', changes: [a, b] });
    });

    it('builds a pull SyncPlan for a single file', async () => {
        const change: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'remote-only' };
        const { service, execute } = buildService([change]);

        await service.pull([toChangeId('c-1')]);

        expect(execute).toHaveBeenCalledExactlyOnceWith({ action: 'pull', changes: [change] });
    });

    it('builds a resolve-conflict SyncPlan without inspecting the change kind', async () => {
        const change: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'conflict' };
        const { service, execute } = buildService([change]);

        await service.resolveConflict([toChangeId('c-1')]);

        expect(execute).toHaveBeenCalledExactlyOnceWith({ action: 'resolve-conflict', changes: [change] });
    });

    it('builds delete-remote and delete-local SyncPlans', async () => {
        const change: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'synced' };
        const { service, execute } = buildService([change]);

        await service.deleteRemote([toChangeId('c-1')]);
        await service.deleteLocal([toChangeId('c-1')]);

        expect(execute).toHaveBeenNthCalledWith(1, { action: 'delete-remote', changes: [change] });
        expect(execute).toHaveBeenNthCalledWith(2, { action: 'delete-local', changes: [change] });
    });

    it('rejects an invalid ChangeId without calling the executor', async () => {
        const { service, execute } = buildService([]);

        await expect(service.push([toChangeId('missing')])).rejects.toThrow(InvalidChangeIdError);
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects a batch if any ChangeId in it is invalid', async () => {
        const change: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' };
        const { service, execute } = buildService([change]);

        await expect(service.push([toChangeId('c-1'), toChangeId('missing')])).rejects.toThrow(InvalidChangeIdError);
        expect(execute).not.toHaveBeenCalled();
    });
});
