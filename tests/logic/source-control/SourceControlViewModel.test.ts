import { describe, expect, it } from 'vitest';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { PushSelectionStore } from '../../../src/logic/source-control/PushSelectionStore';
import { SourceControlViewModel } from '../../../src/logic/source-control/SourceControlViewModel';
import { toChangeId, type SyncChange } from '../../../src/logic/source-control/types';

function buildViewModel(changes: SyncChange[]) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const selection = new PushSelectionStore();
    const operations = new OperationState();
    const viewModel = new SourceControlViewModel(repository, selection, operations);
    return { viewModel, selection, operations };
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

    it('excludes synced changes from "changes" but keeps them in "synced" and "all"', () => {
        const synced: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'synced' };
        const { viewModel } = buildViewModel([synced]);

        expect(viewModel.getState('changes').items).toEqual([]);
        expect(viewModel.getState('synced').items.map(i => i.id)).toEqual([toChangeId('c-1')]);
        expect(viewModel.getState('all').items.map(i => i.id)).toEqual([toChangeId('c-1')]);
    });

    it('counts every filter bucket regardless of the active filter', () => {
        const changes: SyncChange[] = [
            { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
            { id: toChangeId('c-2'), path: 'b.md', kind: 'remote-only' },
            { id: toChangeId('c-3'), path: 'c.md', kind: 'conflict' },
            { id: toChangeId('c-4'), path: 'd.md', kind: 'synced' },
        ];
        const { viewModel } = buildViewModel(changes);

        const { counts } = viewModel.getState('all');
        expect(counts).toEqual({
            all: 4,
            changes: 3,
            'ready-to-push': 0,
            'remote-changes': 1,
            conflicts: 1,
            synced: 1,
        });
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
});
