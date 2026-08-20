import type { FilterValue } from '../types';

export interface SyncStatusRefreshState {
    isRefreshing: boolean;
    current: number;
    total: number;
    lastSyncTime: number;
}

/** Mutable presentation state for SyncStatusView. Domain file state lives elsewhere. */
export class SyncStatusViewState {
    statusFilter: FilterValue = 'all';
    treeViewEnabled = true;
    showSyncedInAll = false;
    searchQuery = '';
    readonly selectedFiles = new Set<string>();
    readonly collapsedFolders = new Set<string>();
    readonly expandedMoveGroups = new Set<string>();
    readonly refreshState: SyncStatusRefreshState = {
        isRefreshing: false,
        current: 0,
        total: 0,
        lastSyncTime: 0,
    };

    setStatusFilter(filter: FilterValue): void {
        this.statusFilter = filter;
    }

    setTreeViewEnabled(enabled: boolean): void {
        this.treeViewEnabled = enabled;
    }

    setShowSyncedInAll(show: boolean): void {
        this.showSyncedInAll = show;
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query.trim();
    }

    select(path: string): void {
        this.selectedFiles.add(path);
    }

    deselect(path: string): void {
        this.selectedFiles.delete(path);
    }

    retainSelected(visiblePaths: ReadonlySet<string>): void {
        for (const path of this.selectedFiles) {
            if (!visiblePaths.has(path)) this.selectedFiles.delete(path);
        }
    }

    clearSelection(): void {
        this.selectedFiles.clear();
    }

    toggleCollapsedFolder(path: string): void {
        this.toggleSetValue(this.collapsedFolders, path);
    }

    toggleExpandedMoveGroup(key: string): void {
        this.toggleSetValue(this.expandedMoveGroups, key);
    }

    startRefresh(): void {
        this.refreshState.isRefreshing = true;
        this.refreshState.current = 0;
        this.refreshState.total = 0;
    }

    updateRefreshProgress(current: number, total: number): void {
        this.refreshState.current = current;
        this.refreshState.total = total;
    }

    incrementRefreshProgress(): void {
        this.refreshState.current += 1;
    }

    finishRefresh(lastSyncTime = this.refreshState.lastSyncTime): void {
        this.refreshState.isRefreshing = false;
        this.refreshState.lastSyncTime = lastSyncTime;
    }

    private toggleSetValue(values: Set<string>, value: string): void {
        if (values.has(value)) values.delete(value);
        else values.add(value);
    }
}
