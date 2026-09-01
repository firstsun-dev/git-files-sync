import { resolveSyncAction, type SyncAction } from './ChangeActionPolicy';
import type { ChangeId, SyncChange } from './types';

/**
 * Tracks which pending changes are selected for the Sync Queue and the
 * user's optional per-change action override.
 *
 * Keyed by ChangeId rather than path so a rename/move does not drop intent.
 * The store owns lifecycle cleanup for that intent: when a refreshed change
 * disappears, or an override is no longer legal for its current kind, the
 * stale state is discarded here instead of during ViewModel projection.
 */
export class SyncSelectionStore {
    private readonly selected = new Set<ChangeId>();
    private readonly actionOverrides = new Map<ChangeId, SyncAction>();

    selectForSync(changeId: ChangeId): void {
        this.selected.add(changeId);
    }

    deselectFromSync(changeId: ChangeId): void {
        this.selected.delete(changeId);
        this.actionOverrides.delete(changeId);
    }

    selectMany(changeIds: readonly ChangeId[]): void {
        for (const id of changeIds) this.selected.add(id);
    }

    deselectMany(changeIds: readonly ChangeId[]): void {
        for (const id of changeIds) {
            this.selected.delete(id);
            this.actionOverrides.delete(id);
        }
    }

    isIncluded(changeId: ChangeId): boolean {
        return this.selected.has(changeId);
    }

    getSelectedChangeIds(): ChangeId[] {
        return [...this.selected];
    }

    setActionOverride(changeId: ChangeId, action: SyncAction): void {
        this.actionOverrides.set(changeId, action);
    }

    clearActionOverride(changeId: ChangeId): void {
        this.actionOverrides.delete(changeId);
    }

    getActionOverride(changeId: ChangeId): SyncAction | undefined {
        return this.actionOverrides.get(changeId);
    }

    /**
     * Reconciles queued intent with a freshly published repository snapshot.
     * Missing ids are removed and action overrides are revalidated against
     * each change's current kind. This is the write-side lifecycle boundary;
     * read-only ViewModel projection must not clean state as a side effect.
     */
    reconcile(changes: readonly SyncChange[]): void {
        const currentById = new Map(changes.map(change => [change.id, change] as const));
        this.refresh([...currentById.keys()]);

        for (const [changeId, override] of this.actionOverrides) {
            const change = currentById.get(changeId);
            if (change && resolveSyncAction(change.kind, override) !== override) {
                this.actionOverrides.delete(changeId);
            }
        }
    }

    /** Drops selections for ids that are no longer present, keeping the rest. */
    refresh(currentChangeIds: readonly ChangeId[]): void {
        const present = new Set(currentChangeIds);
        for (const changeId of this.selected) {
            if (!present.has(changeId)) {
                this.selected.delete(changeId);
                this.actionOverrides.delete(changeId);
            }
        }

        // Defensive cleanup for callers/tests that recorded an override
        // without first selecting the row.
        for (const changeId of this.actionOverrides.keys()) {
            if (!present.has(changeId)) this.actionOverrides.delete(changeId);
        }
    }
}
