import type { FileStatus, FilterValue } from '../types';

export interface SyncStatusSelectionState {
    readonly statusFilter: FilterValue;
    readonly treeViewEnabled: boolean;
    readonly showSyncedInAll: boolean;
    readonly searchQuery: string;
    readonly selectedFiles: ReadonlySet<string>;
}

export interface MoveGroup {
    oldPrefix: string;
    newPrefix: string;
    members: FileStatus[];
}

export function searchedStatuses(
    state: Pick<SyncStatusSelectionState, 'searchQuery'>,
    statuses: readonly FileStatus[],
): FileStatus[] {
    if (state.searchQuery === '') return [...statuses];
    const query = state.searchQuery.toLowerCase();
    return statuses.filter(status => status.path.toLowerCase().includes(query));
}

export function visibleStatuses(
    state: Pick<SyncStatusSelectionState, 'searchQuery' | 'statusFilter' | 'treeViewEnabled' | 'showSyncedInAll'>,
    statuses: readonly FileStatus[],
): FileStatus[] {
    const searched = searchedStatuses(state, statuses);
    if (state.statusFilter !== 'all') {
        return searched.filter(status => status.status === state.statusFilter);
    }
    if (!state.treeViewEnabled) return sortStatuses(searched);
    return state.showSyncedInAll
        ? searched
        : searched.filter(status => status.status !== 'synced');
}

/** Keeps completed rows at the end of the legacy flat view. */
export function sortStatuses(statuses: readonly FileStatus[]): FileStatus[] {
    return [...statuses].sort((left, right) => Number(left.status === 'synced') - Number(right.status === 'synced'));
}

export function selectedVisibleFiles(
    state: Pick<SyncStatusSelectionState, 'selectedFiles'>,
    visible: readonly FileStatus[],
): FileStatus[] {
    return visible.filter(status => state.selectedFiles.has(status.path));
}

export function pruneSelection(
    selectedFiles: ReadonlySet<string>,
    visible: readonly FileStatus[],
): Set<string> {
    const visiblePaths = new Set(visible.map(status => status.path));
    return new Set([...selectedFiles].filter(path => visiblePaths.has(path)));
}

export function isTreeFolderExpanded(collapsedFolders: ReadonlySet<string>, path: string): boolean {
    return !collapsedFolders.has(path);
}

export function isMoveGroupExpanded(expandedMoveGroups: ReadonlySet<string>, key: string): boolean {
    return expandedMoveGroups.has(key);
}

export function moveGroupPrefixes(status: FileStatus): { oldPrefix: string; newPrefix: string } | null {
    if (!status.movedFrom) return null;
    const oldSegments = status.movedFrom.split('/');
    const newSegments = status.path.split('/');
    let oldIndex = oldSegments.length - 1;
    let newIndex = newSegments.length - 1;
    while (
        oldIndex >= 1
        && newIndex >= 1
        && oldSegments[oldIndex] === newSegments[newIndex]
    ) {
        oldIndex -= 1;
        newIndex -= 1;
    }
    return {
        oldPrefix: oldSegments.slice(0, oldIndex + 1).join('/'),
        newPrefix: newSegments.slice(0, newIndex + 1).join('/'),
    };
}

export function moveGroupKey(status: FileStatus): string | null {
    const prefixes = moveGroupPrefixes(status);
    return prefixes ? JSON.stringify(prefixes) : null;
}

export function collapsibleMoveGroups(
    statuses: readonly FileStatus[],
    allStatuses: readonly FileStatus[],
): Map<string, MoveGroup> {
    const candidates = collectMoveGroups(statuses);
    const collapsible = new Map<string, MoveGroup>();
    for (const [key, group] of candidates) {
        if (group.members.length < 2 || isPartialMove(group.oldPrefix, allStatuses)) continue;
        collapsible.set(key, group);
    }
    return collapsible;
}

function collectMoveGroups(statuses: readonly FileStatus[]): Map<string, MoveGroup> {
    const groups = new Map<string, MoveGroup>();
    for (const status of statuses) {
        if (status.status !== 'moved') continue;
        const prefixes = moveGroupPrefixes(status);
        if (!prefixes) continue;
        const key = JSON.stringify(prefixes);
        const existing = groups.get(key);
        if (existing) existing.members.push(status);
        else groups.set(key, { ...prefixes, members: [status] });
    }
    return groups;
}

function isPartialMove(oldPrefix: string, allStatuses: readonly FileStatus[]): boolean {
    const childPrefix = `${oldPrefix}/`;
    return allStatuses.some(status => (
        status.status !== 'moved'
        && (status.path === oldPrefix || status.path.startsWith(childPrefix))
    ));
}
