declare const changeIdBrand: unique symbol;

/**
 * Stable identity for a pending sync change, independent of its current file
 * path. Using this instead of a path lets selection and operation state
 * survive rename/move without losing the user's intent.
 *
 * Branded (rather than a plain `string` alias) so callers can't pass a raw
 * file path where a ChangeId is expected.
 */
export type ChangeId = string & { readonly [changeIdBrand]: never };

/** Wraps a raw id string as a ChangeId at the one place it's minted. */
export function toChangeId(id: string): ChangeId {
    return id as ChangeId;
}

/**
 * How a pending change relates local and remote state, independent of any
 * push/pull selection or in-flight operation. Mirrors `SyncClassification`
 * from the sync domain plus `moved`, since a tracked rename/move is a
 * distinct case the Source Control UI must render differently.
 */
export type SyncChangeKind =
    | 'local-only'
    | 'local-modified'
    | 'remote-only'
    | 'remote-modified'
    | 'moved'
    | 'conflict'
    | 'synced';

/**
 * A single pending sync change as consumed by the Source Control ViewModel
 * layer. Deliberately decoupled from `PlannedFileAction`/`FileStatus` in the
 * sync domain: this is the read-only projection the UI layer works with, keyed
 * by the stable `ChangeId` rather than path.
 */
export interface SyncChange {
    id: ChangeId;
    path: string;
    /** Present when this change is a tracked rename/move, for display only. */
    previousPath?: string;
    kind: SyncChangeKind;
}

/**
 * A user-triggered sync operation, as unified across Source Control buttons,
 * the context menu, single-file commands, and batch operations. All entry
 * points express intent as one of these plus a set of `ChangeId`s.
 */
export type SourceControlActionKind = 'push' | 'pull' | 'delete-remote' | 'delete-local' | 'resolve-conflict';

/**
 * The output of `SourceControlActionService`: user intent resolved to the
 * concrete `SyncChange`s it applies to. Carries no execution behavior itself —
 * it's handed to a `SyncPlanExecutor` to actually run.
 */
export interface SyncPlan {
    action: SourceControlActionKind;
    changes: SyncChange[];
}
