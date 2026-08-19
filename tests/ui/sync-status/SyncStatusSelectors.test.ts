import { describe, expect, it } from 'vitest';
import type { FileStatus } from '../../../src/ui/types';
import {
    collapsibleMoveGroups,
    pruneSelection,
    searchedStatuses,
    selectedVisibleFiles,
    visibleStatuses,
} from '../../../src/ui/sync-status/SyncStatusSelectors';
import { SyncStatusViewState } from '../../../src/ui/sync-status/SyncStatusViewState';

const STATUSES: FileStatus[] = [
    { path: 'Notes/alpha.md', status: 'modified' },
    { path: 'Notes/beta.md', status: 'unsynced' },
    { path: 'Notes/daily.md', status: 'synced' },
    { path: 'Remote/readme.md', status: 'remote-only' },
];

describe('SyncStatusSelectors', () => {
    it.each([
        { query: '', filter: 'all' as const, expected: ['Notes/alpha.md', 'Notes/beta.md', 'Remote/readme.md'] },
        { query: 'notes', filter: 'all' as const, expected: ['Notes/alpha.md', 'Notes/beta.md'] },
        { query: 'notes', filter: 'unsynced' as const, expected: ['Notes/beta.md'] },
        { query: 'REMOTE', filter: 'remote-only' as const, expected: ['Remote/readme.md'] },
    ])('combines search and filter: $query / $filter', ({ query, filter, expected }) => {
        const state = new SyncStatusViewState();
        state.setSearchQuery(query);
        state.setStatusFilter(filter);

        expect(visibleStatuses(state, STATUSES).map(status => status.path)).toEqual(expected);
    });

    it('shows synced rows in flat mode or when explicitly enabled', () => {
        const state = new SyncStatusViewState();
        state.setTreeViewEnabled(false);

        expect(visibleStatuses(state, STATUSES).map(status => status.status)).toEqual([
            'modified', 'unsynced', 'remote-only', 'synced',
        ]);

        state.setTreeViewEnabled(true);
        state.setShowSyncedInAll(true);
        expect(visibleStatuses(state, STATUSES)).toEqual(STATUSES);
    });

    it('searches full folder paths case-insensitively', () => {
        const state = new SyncStatusViewState();
        state.setSearchQuery('notes/');

        expect(searchedStatuses(state, STATUSES).map(status => status.path)).toEqual([
            'Notes/alpha.md', 'Notes/beta.md', 'Notes/daily.md',
        ]);
    });

    it('returns selected visible files and a pruned selection without mutation', () => {
        const state = new SyncStatusViewState();
        state.select('Notes/alpha.md');
        state.select('Notes/daily.md');
        const visible = visibleStatuses(state, STATUSES);

        expect(selectedVisibleFiles(state, visible).map(status => status.path)).toEqual(['Notes/alpha.md']);
        expect([...pruneSelection(state.selectedFiles, visible)]).toEqual(['Notes/alpha.md']);
        expect([...state.selectedFiles]).toEqual(['Notes/alpha.md', 'Notes/daily.md']);
    });

    it('groups complete folder moves but leaves partial moves visible', () => {
        const moved: FileStatus[] = [
            { path: 'New/a.md', movedFrom: 'Old/a.md', status: 'moved' },
            { path: 'New/b.md', movedFrom: 'Old/b.md', status: 'moved' },
        ];

        expect(collapsibleMoveGroups(moved, moved).size).toBe(1);
        expect(collapsibleMoveGroups(moved, [...moved, { path: 'Old/left.md', status: 'synced' }]).size).toBe(0);
    });
});
