import type { ChangeRepository } from './ChangeRepository';
import type { OperationState, OperationStatus } from './OperationState';
import type { PushSelectionStore } from './PushSelectionStore';
import { matchesFilter, type SourceControlFilter } from './SourceControlFilter';
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
}

const ALL_FILTERS: SourceControlFilter[] = ['all', 'changes', 'ready-to-push', 'remote-changes', 'conflicts', 'synced'];

/**
 * Combines `SyncChange[]` (via `ChangeRepository`), `PushSelectionStore`, and
 * `OperationState` into a single UI-ready snapshot. Holds no sync behavior of
 * its own — it's a pure projection, so `SyncManager`/`SyncPlanner`/`SyncExecutor`
 * stay untouched and the UI never needs to reach past this layer.
 */
export class SourceControlViewModel {
    constructor(
        private readonly changes: ChangeRepository,
        private readonly selection: PushSelectionStore,
        private readonly operations: OperationState,
    ) {}

    getState(filter: SourceControlFilter = 'all'): SourceControlViewState {
        const all = this.changes.getAll();
        const items = all
            .filter(change => matchesFilter(change, filter, this.selection))
            .map(change => this.toItem(change));
        const counts = this.countByFilter(all);
        return { filter, items, counts };
    }

    private toItem(change: SyncChange): SourceControlItem {
        return {
            id: change.id,
            path: change.path,
            previousPath: change.previousPath,
            kind: change.kind,
            isReadyToPush: this.selection.isIncluded(change.id),
            operationStatus: this.operations.get(change.id),
        };
    }

    private countByFilter(changes: readonly SyncChange[]): Record<SourceControlFilter, number> {
        const counts = {} as Record<SourceControlFilter, number>;
        for (const filter of ALL_FILTERS) {
            counts[filter] = changes.filter(change => matchesFilter(change, filter, this.selection)).length;
        }
        return counts;
    }
}
