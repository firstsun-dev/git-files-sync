import type { SelectionState } from './state/SelectionState';
import type { SyncChange } from './types';

export type SourceControlFilter =
    | 'all'
    | 'changes'
    | 'ready-to-push'
    | 'remote-changes'
    | 'conflicts'
    | 'synced';

/**
 * Whether `change` belongs under `filter`. `ready-to-push` is defined purely
 * by `SelectionState` membership — it's a user selection, not a fact
 * derivable from the change's kind alone.
 */
export function matchesFilter(change: SyncChange, filter: SourceControlFilter, selection: SelectionState): boolean {
    switch (filter) {
        case 'all': return true;
        case 'changes': return change.kind !== 'synced';
        case 'ready-to-push': return selection.isIncluded(change.id);
        case 'remote-changes': return change.kind === 'remote-only' || change.kind === 'remote-modified';
        case 'conflicts': return change.kind === 'conflict';
        case 'synced': return change.kind === 'synced';
    }
}
