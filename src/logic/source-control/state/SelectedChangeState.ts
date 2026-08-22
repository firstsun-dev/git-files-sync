import type { ChangeId } from '../types';

/**
 * Stable identity of the change currently selected for diff viewing, or
 * `null` when nothing is selected. Held as state (not View-local) so a
 * re-render driven by a sync-status refresh keeps the selection instead of
 * losing it.
 */
export class SelectedChangeState {
    private selected: ChangeId | null = null;

    get(): ChangeId | null {
        return this.selected;
    }

    set(changeId: ChangeId | null): void {
        this.selected = changeId;
    }

    clear(): void {
        this.selected = null;
    }
}