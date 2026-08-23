import { describe, expect, it, vi } from 'vitest';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { RefreshState } from '../../../src/logic/source-control/RefreshState';
import { PushSelectionStore } from '../../../src/logic/source-control/PushSelectionStore';
import { SourceControlViewModel } from '../../../src/logic/source-control/SourceControlViewModel';
import { toChangeId, type SyncChange } from '../../../src/logic/source-control/types';

function buildViewModel(changes: SyncChange[]) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const selection = new PushSelectionStore();
    const operations = new OperationState();
    const refreshState = new RefreshState();
    const refreshSource = vi.fn().mockResolvedValue(undefined);
    const viewModel = new SourceControlViewModel(repository, selection, operations, refreshSource, refreshState);
    return { viewModel, selection, operations, refreshState, refreshSource };
}

describe('SourceControlViewModel', () => {
    it('maps a local change under "changes" and "all"', () => {
        const localOnly: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' };
        const { viewModel } = buildViewModel([localOnly]);

        expect(viewModel.getState('all').items.map(i => i.id)).toEqual([toChangeId('c-1')]);
        expect(viewModel.getState('changes').items.map(i => i.id)).toEqual([toChangeId('c-1')]);
    });

    it('maps a remote change under "remote-changes"', () => {
        const remoteOnly: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'remote-only' };
        const { viewModel } = buildViewModel([remoteOnly]);

        const state = viewModel.getState('remote-changes');
        expect(state.items.map(i => i.id)).toEqual([toChangeId('c-1')]);
        expect(viewModel.getState('conflicts').items).toEqual([]);
    });

    it('maps a conflict under "conflicts"', () => {
        const conflict: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'conflict' };
        const { viewModel } = buildViewModel([conflict]);

        expect(viewModel.getState('conflicts').items.map(i => i.id)).toEqual([toChangeId('c-1')]);
        expect(viewModel.getState('remote-changes').items).toEqual([]);
    });

    it('maps a change to "ready-to-push" only once selected in PushSelectionStore', () => {
        const localOnly: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' };
        const { viewModel, selection } = buildViewModel([localOnly]);

        expect(viewModel.getState('ready-to-push').items).toEqual([]);

        selection.includeForPush(toChangeId('c-1'));

        const state = viewModel.getState('ready-to-push');
        expect(state.items.map(i => i.id)).toEqual([toChangeId('c-1')]);
        expect(state.items[0]?.isReadyToPush).toBe(true);
    });

    it('reflects OperationState on the item', () => {
        const localOnly: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' };
        const { viewModel, operations } = buildViewModel([localOnly]);

        operations.start(toChangeId('c-1'));

        expect(viewModel.getState('all').items[0]?.operationStatus).toBe('running');
    });

    it('excludes synced changes from "changes" and "all", surfacing them only via "synced" + showSynced', () => {
        const synced: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'synced' };
        const { viewModel } = buildViewModel([synced]);

        // Synced is not actionable: it never appears under All or Changes.
        expect(viewModel.getState('all').items).toEqual([]);
        expect(viewModel.getState('changes').items).toEqual([]);
        // Hidden by default: the synced filter yields nothing until the user opts in.
        expect(viewModel.getState('synced').items).toEqual([]);
        expect(viewModel.getState('synced', true).items.map(i => i.id)).toEqual([toChangeId('c-1')]);
    });

    it('counts every filter bucket from the single-source summary, regardless of the active filter', () => {
        const changes: SyncChange[] = [
            { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
            { id: toChangeId('c-2'), path: 'b.md', kind: 'remote-only' },
            { id: toChangeId('c-3'), path: 'c.md', kind: 'conflict' },
            { id: toChangeId('c-4'), path: 'd.md', kind: 'synced' },
        ];
        const { viewModel } = buildViewModel(changes);

        // showSynced = false (default): synced contributes 0 to counts and is absent from All.
        const { counts } = viewModel.getState('all');
        expect(counts).toEqual({
            all: 3,
            changes: 1,
            'ready-to-push': 0,
            'remote-changes': 1,
            conflicts: 1,
            synced: 0,
        });

        // showSynced = true: the raw synced count (1) surfaces.
        expect(viewModel.getState('all', true).counts.synced).toBe(1);
    });

    it('keeps ChangeId stable across a rename', () => {
        const renamed: SyncChange = {
            id: toChangeId('c-1'),
            path: 'new.md',
            previousPath: 'old.md',
            kind: 'moved',
        };
        const { viewModel } = buildViewModel([renamed]);

        const item = viewModel.getState('all').items[0];
        expect(item?.id).toBe(toChangeId('c-1'));
        expect(item?.path).toBe('new.md');
        expect(item?.previousPath).toBe('old.md');
    });

    it('projects syncQueue as the actionable changes currently in PushSelectionStore', () => {
        const changes: SyncChange[] = [
            { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
            { id: toChangeId('c-2'), path: 'b.md', kind: 'remote-only' },
            { id: toChangeId('c-3'), path: 'c.md', kind: 'synced' },
        ];
        const { viewModel, selection } = buildViewModel(changes);
        selection.includeForPush(toChangeId('c-1'));
        selection.includeForPush(toChangeId('c-2'));
        selection.includeForPush(toChangeId('c-3'));

        const state = viewModel.getState('all');
        expect(state.syncQueue.map(i => i.id)).toEqual([toChangeId('c-1'), toChangeId('c-2')]);
        // Synced is never actionable, so it's excluded even when selected.
        expect(state.syncQueue.every(i => i.kind !== 'synced')).toBe(true);
        expect(state.syncQueue[0]?.isReadyToPush).toBe(true);
    });

    it('reports an empty syncQueue projection when nothing is selected', () => {
        const { viewModel } = buildViewModel([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
        expect(viewModel.getState('all').syncQueue).toEqual([]);
    });

    it('surfaces the current refresh status on every view state', () => {
        const { viewModel, refreshState } = buildViewModel([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
        expect(viewModel.getState('all').refreshStatus).toBe('idle');
        refreshState.start();
        expect(viewModel.getState('all').refreshStatus).toBe('loading');
        refreshState.fail();
        expect(viewModel.getState('all').refreshStatus).toBe('failed');
    });

    it('refresh() delegates to the refresh source and drives the RefreshState lifecycle', async () => {
        const { viewModel, refreshState, refreshSource } = buildViewModel([
            { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
        ]);

        await viewModel.refresh();

        expect(refreshSource).toHaveBeenCalledTimes(1);
        expect(refreshState.get()).toBe('idle');
    });

    it('refresh() defaults to the manual reason and records lastCheckedAt on success', async () => {
        const { viewModel, refreshState } = buildViewModel([
            { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
        ]);
        expect(refreshState.getReason()).toBeUndefined();
        expect(refreshState.getLastCheckedAt()).toBe(0);

        await viewModel.refresh();

        expect(refreshState.getReason()).toBe('manual');
        expect(refreshState.getLastCheckedAt()).toBeGreaterThan(0);
    });

    it('refresh(reason) threads the reason onto the RefreshState holder', async () => {
        const { viewModel, refreshState } = buildViewModel([
            { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
        ]);

        await viewModel.refresh('startup');

        expect(refreshState.getReason()).toBe('startup');
    });

    it('refresh() marks the RefreshState failed and rethrows when the refresh source rejects', async () => {
        const refreshSource = vi.fn().mockRejectedValue(new Error('boom'));
        const repository = new ChangeRepository();
        repository.replace([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
        const refreshState = new RefreshState();
        const viewModel = new SourceControlViewModel(
            repository,
            new PushSelectionStore(),
            new OperationState(),
            refreshSource,
            refreshState,
        );

        await expect(viewModel.refresh()).rejects.toThrow('boom');
        expect(refreshState.get()).toBe('failed');
    });
});
