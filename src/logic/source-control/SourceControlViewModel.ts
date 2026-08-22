import type { ExecutionResult } from './ExecutionResult';
import { matchesFilter, type SourceControlFilter } from './SourceControlFilter';
import type { SourceControlState } from './state/SourceControlState';
import type { SectionFilter } from './state/ExpandedNodesState';
import type { OperationStatus } from './state/OperationState';
import type { ChangeId, SyncChange, SyncChangeKind } from './types';

/** One row of UI-ready state for a change: its own facts plus derived selection/operation status. */
export interface SourceControlItem {
    id: ChangeId;
    path: string;
    previousPath?: string;
    kind: SyncChangeKind;
    isReadyToPush: boolean;
    operationStatus: OperationStatus;
}

/** The complete state the Source Control UI needs to render for a given filter. */
export interface SourceControlViewState {
    filter: SourceControlFilter;
    items: SourceControlItem[];
    counts: Record<SourceControlFilter, number>;
    /** Transient batch summary from the last action, or `null` if none/cleared. */
    lastOperationResult: ExecutionResult | null;
}

const ALL_FILTERS: SourceControlFilter[] = ['all', 'changes', 'ready-to-push', 'remote-changes', 'conflicts', 'synced'];

/**
 * The single Source Control UI state facade. Reads from `SourceControlState`
 * (change model + selection + operation + filter + expanded nodes + selected
 * change) and exposes a UI-ready projection. The View is pure layout + event
 * binding and mutates state **only** through this facade — never reaching the
 * state slices directly — so there is one source of truth and no parallel
 * View-local state that can drift.
 *
 * It holds no sync behavior of its own: it's a projection + a thin mutation
 * facade, so `SyncManager`/`SyncPlanner`/`SyncExecutor` stay untouched and the
 * UI never needs to reach past this layer.
 */
export class SourceControlViewModel {
    private lastOperationResult: ExecutionResult | null = null;

    constructor(private readonly state: SourceControlState) {}

    // --- Read-side projection ---

    /** Projects the items + counts for `filter` (defaults to the active filter). */
    getState(filter: SourceControlFilter = this.state.filter.get()): SourceControlViewState {
        const all = this.state.changes.getAll();
        const items = all
            .filter(change => matchesFilter(change, filter, this.state.selection))
            .map(change => this.toItem(change));
        const counts = this.countByFilter(all);
        return { filter, items, counts, lastOperationResult: this.lastOperationResult };
    }

    // --- Active UI state (moved out of the View) ---

    getFilter(): SourceControlFilter { return this.state.filter.get(); }
    setFilter(filter: SourceControlFilter): void { this.state.filter.set(filter); }

    getSelectedChangeId(): ChangeId | null { return this.state.selectedChange.get(); }
    selectForDiff(changeId: ChangeId): void { this.state.selectedChange.set(changeId); }
    clearSelection(): void { this.state.selectedChange.clear(); }

    isSectionCollapsed(section: SectionFilter): boolean { return this.state.expanded.isSectionCollapsed(section); }
    toggleSection(section: SectionFilter): void { this.state.expanded.toggleSection(section); }
    isFolderCollapsed(path: string): boolean { return this.state.expanded.isFolderCollapsed(path); }
    toggleFolder(path: string): void { this.state.expanded.toggleFolder(path); }
    /** Snapshot of collapsed folder paths for the tree/section renderers (read-only during one render). */
    getCollapsedFolders(): Set<string> { return this.state.expanded.getCollapsedFolders(); }

    // --- Selection mutation (routed through the facade, not direct to the store) ---

    selectForPush(changeId: ChangeId): void { this.state.selection.includeForPush(changeId); }
    deselectFromPush(changeId: ChangeId): void { this.state.selection.excludeFromPush(changeId); }

    /** ChangeIds currently marked ready to push — feeds the toolbar Push action. */
    getSelectedChangeIds(): ChangeId[] { return this.state.selection.getSelectedChangeIds(); }

    // --- Operation-result projection (batch summary) ---

    setOperationResult(result: ExecutionResult): void {
        this.lastOperationResult = result;
    }

    clearOperationResult(): void {
        this.lastOperationResult = null;
    }

    private toItem(change: SyncChange): SourceControlItem {
        return {
            id: change.id,
            path: change.path,
            previousPath: change.previousPath,
            kind: change.kind,
            isReadyToPush: this.state.selection.isIncluded(change.id),
            operationStatus: this.state.operations.get(change.id),
        };
    }

    private countByFilter(changes: readonly SyncChange[]): Record<SourceControlFilter, number> {
        const counts = {} as Record<SourceControlFilter, number>;
        for (const filter of ALL_FILTERS) {
            counts[filter] = changes.filter(change => matchesFilter(change, filter, this.state.selection)).length;
        }
        return counts;
    }
}