import type { ChangeRepository } from './ChangeRepository';
import { buildSummary, type SourceControlCounts } from './SourceControlSummary';
import type { OperationState, OperationStatus } from './OperationState';
import type { RefreshReason } from './RefreshReason';
import type { RefreshState, RefreshStatus } from './RefreshState';
import type { SyncSelectionStore } from './SyncSelectionStore';
import { matchesFilter, type SourceControlFilter } from './SourceControlFilter';
import type { ChangeId, SyncChange, SyncChangeKind } from './types';

/** One row of UI-ready state for a change: its own facts plus derived selection/operation status. */
export interface SourceControlItem {
    id: ChangeId;
    path: string;
    previousPath?: string;
    kind: SyncChangeKind;
    isSelectedForSync: boolean;
    operationStatus: OperationStatus;
}

/** The complete state the Source Control UI needs to render for a given filter. */
export interface SourceControlViewState {
    filter: SourceControlFilter;
    items: SourceControlItem[];
    /**
     * The actionable changes the user has currently selected for push, as
     * full row items — the working sync queue. Empty when nothing is
     * selected. Reuses the same `selected + non-synced` definition as
     * `buildSummary.readyToPush` so the "SYNC QUEUE (N)" section and the Sync
     * button count can't drift.
     */
    syncQueue: SourceControlItem[];
    /** Current view-wide refresh status, surfaced so the header can render its states. */
    refreshStatus: RefreshStatus;
    /** Single-source counts from {@link buildSummary} — the view never recomputes these. */
    counts: SourceControlCounts;
}

/**
 * Combines `SyncChange[]` (via `ChangeRepository`), `SyncSelectionStore`, and
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
 *
 * The one non-projection responsibility is {@link refresh}: it delegates to an
 * injected refresh callback (wired to `SyncWorkspace.refresh()` in `main.ts`)
 * and drives the injected {@link RefreshState} holder so the UI can surface
 * loading/failed states. It holds no provider or refresh logic of its own,
 * keeping the event-driven pipeline (`sync.status` → `ChangeRepository` →
 * ViewModel → UI) intact — refresh never becomes a second population path.
 */
export class SourceControlViewModel {
    constructor(
        private readonly changes: ChangeRepository,
        private readonly selectionStore: SyncSelectionStore,
        private readonly operations: OperationState,
        private readonly refreshSource: () => Promise<unknown>,
        private readonly refreshState: RefreshState,
    ) {}

    /**
     * The sync-selection store, exposed so the view can toggle/clear
     * selection without holding its own reference and reaching past the
     * ViewModel. Reached via `viewModel.selection`
     * (`selectForSync`/`deselectFromSync`/`selectMany`/`deselectMany`/
     * `getSelectedChangeIds`).
     */
    get selection(): SyncSelectionStore { return this.selectionStore; }

    getState(filter: SourceControlFilter = 'all', showSynced = false): SourceControlViewState {
        const all = this.changes.getAll();
        const summary = buildSummary(all, this.selectionStore, showSynced);
        const items = all
            .filter(change => matchesFilter(change, filter, this.selectionStore))
            .filter(() => this.isRenderable(filter, showSynced))
            .map(change => this.toItem(change));
        const syncQueue = summary.readyToPush.map(change => this.toItem(change));
        return { filter, items, syncQueue, refreshStatus: this.refreshState.get(), counts: summary.counts };
    }

    /**
     * Triggers a view-wide refresh by delegating to the injected refresh
     * source (the Sync Status service boundary) and tracking its lifecycle on
     * the {@link RefreshState} holder so the header can render "Refreshing…"
     * / a failed state. Refresh republishes `sync.status`, so the existing
     * subscription repopulates `ChangeRepository` — this never becomes a
     * second population path.
     *
     * The {@link RefreshReason} is recorded on the {@link RefreshState}
     * holder purely for observability ("Last checked" + why); it does not
     * change what the refresh does. Defaults to `'manual'` (the Refresh
     * button); callers pass `'startup'`/`'local-change'`/`'sync-complete'` to
     * surface a non-manual trigger.
     */
    async refresh(reason: RefreshReason = 'manual'): Promise<void> {
        this.refreshState.start(reason);
        try {
            await this.refreshSource();
            this.refreshState.succeed();
        } catch (error) {
            this.refreshState.fail();
            throw error;
        }
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
            isSelectedForSync: this.selectionStore.isIncluded(change.id),
            operationStatus: this.operations.get(change.id),
        };
    }
}