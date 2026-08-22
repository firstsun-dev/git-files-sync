import type { ChangeRepository } from './ChangeRepository';
import type { ExecutionResult } from './ExecutionResult';
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
    /** Transient batch summary from the last action, or `null` if none/cleared. */
    lastOperationResult: ExecutionResult | null;
}

const ALL_FILTERS: SourceControlFilter[] = ['all', 'changes', 'ready-to-push', 'remote-changes', 'conflicts', 'synced'];

/**
 * Combines `SyncChange[]` (via `ChangeRepository`), `PushSelectionStore`, and
 * `OperationState` into a single UI-ready snapshot. Holds no sync behavior of
 * its own — it's a pure projection, so `SyncManager`/`SyncPlanner`/`SyncExecutor`
 * stay untouched and the UI never needs to reach past this layer.
 */
export class SourceControlViewModel {
    private lastOperationResult: ExecutionResult | null = null;

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
        return { filter, items, counts, lastOperationResult: this.lastOperationResult };
    }

    /**
     * Stores the most recent batch outcome so the UI can render a summary
     * ("7 completed / 3 conflicts / 1 failed"). Set by the action flow after
     * `SourceControlActionService` returns; cleared by `clearOperationResult`
     * (e.g. when the user dismisses the summary or starts a new action).
     */
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
