import type { ChangeRepository } from './ChangeRepository';
import { buildSummary, type SourceControlCounts } from './SourceControlSummary';
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
    /** Single-source counts from {@link buildSummary} — the view never recomputes these. */
    counts: SourceControlCounts;
}

/**
 * Combines `SyncChange[]` (via `ChangeRepository`), `PushSelectionStore`, and
 * `OperationState` into a single UI-ready snapshot. Holds no sync behavior of
 * its own — it's a pure projection, so `SyncManager`/`SyncPlanner`/`SyncExecutor`
 * stay untouched and the UI never needs to reach past this layer.
 *
 * Every count the UI shows comes from one place: {@link buildSummary}. The
 * ViewModel only projects items for the active filter and forwards the
 * summary's counts unchanged, so the filter menu, section headers, and tree
 * can never drift apart.
 *
 * `showSynced` governs whether the synced bucket is surfaced: when false the
 * synced count is reported as `0` and the `synced` filter yields no items,
 * matching the "Show synced" toggle (default off).
 */
export class SourceControlViewModel {
    constructor(
        private readonly changes: ChangeRepository,
        private readonly selection: PushSelectionStore,
        private readonly operations: OperationState,
    ) {}

    getState(filter: SourceControlFilter = 'all', showSynced = false): SourceControlViewState {
        const all = this.changes.getAll();
        const summary = buildSummary(all, this.selection, showSynced);
        const items = all
            .filter(change => matchesFilter(change, filter, this.selection))
            .filter(() => this.isRenderable(filter, showSynced))
            .map(change => this.toItem(change));
        return { filter, items, counts: summary.counts };
    }

    private isRenderable(filter: SourceControlFilter, showSynced: boolean): boolean {
        // Synced rows only render under the `synced` filter, and only when the
        // user has opted in via "Show synced". `all`/`changes`/etc. already
        // exclude synced via matchesFilter, so this only gates the synced view.
        return !(filter === 'synced' && !showSynced);
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
}