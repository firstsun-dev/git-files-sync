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
});
