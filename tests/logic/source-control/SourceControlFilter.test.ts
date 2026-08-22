import { describe, expect, it } from 'vitest';
import { PushSelectionStore } from '../../../src/logic/source-control/PushSelectionStore';
import { matchesFilter, type SourceControlFilter } from '../../../src/logic/source-control/SourceControlFilter';
import { toChangeId, type SyncChange, type SyncChangeKind } from '../../../src/logic/source-control/types';

function change(id: string, kind: SyncChangeKind): SyncChange {
    return { id: toChangeId(id), path: `${id}.md`, kind };
}

const FILTERS: SourceControlFilter[] = [
    'all',
    'changes',
    'ready-to-push',
    'remote-changes',
    'conflicts',
    'synced',
];

describe('SourceControlFilter', () => {
    it.each([
        ['local-only', ['all', 'changes']],
        ['local-modified', ['all', 'changes']],
        ['moved', ['all', 'changes']],
        ['remote-only', ['all', 'remote-changes']],
        ['remote-modified', ['all', 'remote-changes']],
        ['conflict', ['all', 'conflicts']],
        ['synced', ['synced']],
    ] as const)('maps %s into the expected non-selection filters', (kind, expectedFilters) => {
        const selection = new PushSelectionStore();
        const item = change(`change-${kind}`, kind);

        const matched = FILTERS.filter(filter => matchesFilter(item, filter, selection));

        expect(matched).toEqual(expectedFilters);
    });

    it('puts a selected actionable change into ready-to-push without changing its status bucket', () => {
        const selection = new PushSelectionStore();
        const item = change('local', 'local-modified');
        selection.includeForPush(item.id);

        expect(matchesFilter(item, 'ready-to-push', selection)).toBe(true);
        expect(matchesFilter(item, 'changes', selection)).toBe(true);
        expect(matchesFilter(item, 'all', selection)).toBe(true);
    });

    it('does not put an unselected actionable change into ready-to-push', () => {
        const selection = new PushSelectionStore();
        const item = change('remote', 'remote-modified');

        expect(matchesFilter(item, 'ready-to-push', selection)).toBe(false);
        expect(matchesFilter(item, 'remote-changes', selection)).toBe(true);
    });

    it('never treats a selected synced change as ready-to-push or actionable', () => {
        const selection = new PushSelectionStore();
        const item = change('synced', 'synced');
        selection.includeForPush(item.id);

        expect(matchesFilter(item, 'ready-to-push', selection)).toBe(false);
        expect(matchesFilter(item, 'all', selection)).toBe(false);
        expect(matchesFilter(item, 'synced', selection)).toBe(true);
    });

    it('keeps conflicts distinct from local and remote status filters', () => {
        const selection = new PushSelectionStore();
        const item = change('conflict', 'conflict');

        expect(matchesFilter(item, 'conflicts', selection)).toBe(true);
        expect(matchesFilter(item, 'changes', selection)).toBe(false);
        expect(matchesFilter(item, 'remote-changes', selection)).toBe(false);
    });

    it('preserves ready-to-push membership across a move because selection is keyed by ChangeId', () => {
        const selection = new PushSelectionStore();
        const id = toChangeId('move-1');
        selection.includeForPush(id);

        const moved: SyncChange = {
            id,
            path: 'archive/a.md',
            previousPath: 'folder/a.md',
            kind: 'moved',
        };

        expect(matchesFilter(moved, 'ready-to-push', selection)).toBe(true);
        expect(matchesFilter(moved, 'changes', selection)).toBe(true);
    });
});
