import type { ChangeId } from './types';

/**
 * Tracks which pending sync changes are selected for the Sync Queue —
 * independent of the underlying change/plan model and of any UI. Named for
 * "selected for sync" rather than "push" since the Sync Queue it backs holds
 * push, pull, and delete-remote candidates alike (a queued `remote-only` row
 * pulls, a queued `local-deleted` row deletes remotely by default). Also
 * deliberately avoids VCS stage/unstage terminology since this isn't a
 * staging area.
 *
 * Keyed by ChangeId rather than path so a rename/move doesn't drop the
 * selection.
 */
export class SyncSelectionStore {
    private readonly selected = new Set<ChangeId>();

    selectForSync(changeId: ChangeId): void {
        this.selected.add(changeId);
    }

    deselectFromSync(changeId: ChangeId): void {
        this.selected.delete(changeId);
    }

    /** Selects a batch of changes for sync in one call (folder "select all"). */
    selectMany(changeIds: readonly ChangeId[]): void {
        for (const id of changeIds) this.selected.add(id);
    }

    /** Deselects a batch of changes from sync in one call ("clear queue" / folder deselect). */
    deselectMany(changeIds: readonly ChangeId[]): void {
        for (const id of changeIds) this.selected.delete(id);
    }

    isIncluded(changeId: ChangeId): boolean {
        return this.selected.has(changeId);
    }

    getSelectedChangeIds(): ChangeId[] {
        return [...this.selected];
    }

    /** Drops selections for change ids that are no longer present, keeping the rest. */
    refresh(currentChangeIds: readonly ChangeId[]): void {
        const present = new Set(currentChangeIds);
        for (const changeId of this.selected) {
            if (!present.has(changeId)) {
                this.selected.delete(changeId);
            }
        }
    }
}
