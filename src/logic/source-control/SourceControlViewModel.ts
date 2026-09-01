import type { ChangeRepository } from './ChangeRepository';
import { resolveSyncAction, type SyncAction } from './ChangeActionPolicy';
import { buildSummary, type SourceControlCounts } from './SourceControlSummary';
import type { OperationState, OperationStatus } from './OperationState';
import type { RefreshReason } from './RefreshReason';
import type { RefreshState, RefreshStatus } from './RefreshState';
import type { SyncSelectionStore } from './SyncSelectionStore';
import { matchesFilter, type SourceControlFilter } from './SourceControlFilter';
import type { ChangeId, SyncChange, SyncChangeKind } from './types';

/** One UI-ready row: repository facts plus derived selection/operation state. */
export interface SourceControlItem {
    id: ChangeId;
    path: string;
    previousPath?: string;
    kind: SyncChangeKind;
    isSelectedForSync: boolean;
    operationStatus: OperationStatus;
    /** Current effective queue action: a still-legal override or the kind default. */
    syncAction: SyncAction;
    /** True only when the effective action came from a still-legal user override. */
    hasActionOverride: boolean;
}

/** The complete state the Source Control UI needs to render for a filter. */
export interface SourceControlViewState {
    filter: SourceControlFilter;
    items: SourceControlItem[];
    syncQueue: SourceControlItem[];
    refreshStatus: RefreshStatus;
    counts: SourceControlCounts;
}

/**
 * Read-only projection of repository, selection, operation, and refresh state
 * into UI-ready snapshots.
 *
 * Purely observational: getState() never mutates queue intent, and this
 * class exposes no selection mutation surface of its own. Selection-intent
 * reconciliation against authoritative ChangeRepository replacements is
 * wired by the runtime composition root (createSyncRuntime), not here, and
 * mutation goes through SourceControlActionService instead of this class.
 */
export class SourceControlViewModel {
    constructor(
        private readonly changes: ChangeRepository,
        private readonly selectionStore: SyncSelectionStore,
        private readonly operations: OperationState,
        private readonly refreshSource: () => Promise<unknown>,
        private readonly refreshState: RefreshState,
    ) {}

    getState(filter: SourceControlFilter = 'all', showSynced = false): SourceControlViewState {
        const all = this.changes.getAll();
        const summary = buildSummary(all, this.selectionStore, showSynced);
        const items = all
            .filter(change => matchesFilter(change, filter, this.selectionStore))
            .filter(() => this.isRenderable(filter, showSynced))
            .map(change => this.toItem(change));
        const syncQueue = summary.readyToPush.map(change => this.toItem(change));

        return {
            filter,
            items,
            syncQueue,
            refreshStatus: this.refreshState.get(),
            counts: summary.counts,
        };
    }

    /**
     * Triggers a view-wide refresh through the injected source and records
     * only its presentation lifecycle. Repository population still happens
     * exclusively through the existing sync.status publish subscription.
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
        return !(filter === 'synced' && !showSynced);
    }

    private toItem(change: SyncChange): SourceControlItem {
        const storedOverride = this.selectionStore.getActionOverride(change.id);
        const syncAction = resolveSyncAction(change.kind, storedOverride);
        const hasActionOverride = storedOverride !== undefined && storedOverride === syncAction;

        return {
            id: change.id,
            path: change.path,
            previousPath: change.previousPath,
            kind: change.kind,
            isSelectedForSync: this.selectionStore.isIncluded(change.id),
            operationStatus: this.operations.get(change.id),
            syncAction,
            hasActionOverride,
        };
    }
}
