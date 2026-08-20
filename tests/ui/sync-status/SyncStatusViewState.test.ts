import { describe, expect, it } from 'vitest';
import { SyncStatusViewState } from '../../../src/ui/sync-status/SyncStatusViewState';

describe('SyncStatusViewState', () => {
    it('owns presentation defaults independently of domain state', () => {
        const state = new SyncStatusViewState();

        expect(state.statusFilter).toBe('all');
        expect(state.treeViewEnabled).toBe(true);
        expect(state.showSyncedInAll).toBe(false);
        expect(state.searchQuery).toBe('');
        expect(state.selectedFiles.size).toBe(0);
        expect(state.refreshState).toEqual({ isRefreshing: false, current: 0, total: 0, lastSyncTime: 0 });
    });

    it('normalizes search queries and transitions refresh state', () => {
        const state = new SyncStatusViewState();

        state.setSearchQuery('  Notes/Daily  ');
        state.startRefresh();
        state.updateRefreshProgress(2, 5);
        state.finishRefresh(1234);

        expect(state.searchQuery).toBe('Notes/Daily');
        expect(state.refreshState).toEqual({ isRefreshing: false, current: 2, total: 5, lastSyncTime: 1234 });
    });

    it('encapsulates selection, folder, and move-group transitions', () => {
        const state = new SyncStatusViewState();

        state.select('a.md');
        state.select('b.md');
        state.toggleCollapsedFolder('Notes');
        state.toggleExpandedMoveGroup('move-key');
        state.retainSelected(new Set(['b.md']));

        expect([...state.selectedFiles]).toEqual(['b.md']);
        expect(state.collapsedFolders.has('Notes')).toBe(true);
        expect(state.expandedMoveGroups.has('move-key')).toBe(true);

        state.toggleCollapsedFolder('Notes');
        state.toggleExpandedMoveGroup('move-key');
        expect(state.collapsedFolders.size).toBe(0);
        expect(state.expandedMoveGroups.size).toBe(0);
    });
});
