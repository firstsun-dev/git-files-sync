import type { ChangeId } from './types';

/**
 * UI-facing projection of a batch operation's outcome: which targeted changes
 * completed, which need conflict resolution, and which hard-failed.
 *
 * This is a **projection** derived in `SourceControlActionService` from the
 * existing sync-domain results (`PushResults`/`SyncResult`/`RemoteDeleteResult`)
 * — not a new sync model. It exists so the Source Control UI can render a batch
 * summary ("7 completed / 3 conflicts / 1 failed") instead of only a binary
 * success/failed.
 *
 * Per-change persistence lives in `OperationState`; this type is the transient
 * aggregate the ViewModel exposes to the UI for one render cycle.
 */
export interface ExecutionResult {
    /** Changes that completed without conflict or error. */
    completed: ChangeId[];
    /** Changes the executor reported as conflicts (needs-resolution, not failed). */
    conflicts: ChangeId[];
    /** Changes that hard-failed (network/permission/etc.). */
    failed: ChangeId[];
}

/** A fresh, empty result with independent arrays (no shared prototype aliasing). */
export function emptyExecutionResult(): ExecutionResult {
    return { completed: [], conflicts: [], failed: [] };
}