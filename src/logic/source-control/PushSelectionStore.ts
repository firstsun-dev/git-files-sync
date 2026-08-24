import type { ChangeId } from './types';

/**
 * Tracks which pending sync changes are "Ready to Push" — independent of the
 * underlying change/plan model and of any UI. Deliberately avoids VCS
 * stage/unstage terminology since this isn't a staging area.
 *
 * Keyed by ChangeId rather than path so a rename/move doesn't drop the
 * selection.
 */
export class PushSelectionStore {
    private readonly selected = new Set<ChangeId>();

    includeForPush(changeId: ChangeId): void {
        this.selected.add(changeId);
    }

    excludeFromPush(changeId: ChangeId): void {
        this.selected.delete(changeId);
    }

    /** Includes a batch of changes for push in one call (folder "select all"). */
    selectMany(changeIds: readonly ChangeId[]): void {
        for (const id of changeIds) this.selected.add(id);
    }

    /** Excludes a batch of changes from push in one call ("clear queue" / folder deselect). */
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
