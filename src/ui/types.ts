export type { FileStatus } from '../logic/sync-status-service';

export type FilterValue = 'all' | 'synced' | 'modified' | 'unsynced' | 'remote-only' | 'moved';

/** One file that a sync plan would touch. */
export interface SyncPlanEntry {
    path: string;
    name: string;
    /** For a move: the path it would move from. */
    movedFrom?: string;
}

/**
 * The full set of changes a push, pull, or remote deletion would apply,
 * computed before anything is written so it can be shown for review. Only
 * entries that would actually be written appear here — files that are
 * already in sync or skipped due to a conflict are left out.
 *
 * `acceptedRemote`/`skippedConflicts` are only populated for a batch push
 * whose conflicts have already been resolved via `BatchConflictResolutionModal`:
 * they don't represent remote writes, just what this confirmation covers.
 */
export interface SyncPlan {
    additions: SyncPlanEntry[];
    modifications: SyncPlanEntry[];
    deletions: SyncPlanEntry[];
    moves: SyncPlanEntry[];
    /** Conflicts resolved as "keep remote" — applied locally only after the batch commit succeeds. */
    acceptedRemote?: SyncPlanEntry[];
    /** Conflicts resolved as "skip" — left untouched on both sides. */
    skippedConflicts?: SyncPlanEntry[];
}

export function isSyncPlanEmpty(plan: SyncPlan): boolean {
    return plan.additions.length === 0 && plan.modifications.length === 0
        && plan.deletions.length === 0 && plan.moves.length === 0
        && !plan.acceptedRemote?.length && !plan.skippedConflicts?.length;
}
