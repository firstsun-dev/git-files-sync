declare const changeIdBrand: unique symbol;

/**
 * Identity for a pending sync change, used as the key for selection and
 * operation state instead of a bare path string. Currently minted from the
 * file path itself (see `FileStatusAdapter.toChangeId`), so it does NOT yet
 * survive a rename/move — a renamed file gets a new id like any other path
 * change. The type exists to give callers a single seam to make identity
 * genuinely path-independent later without touching every call site.
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
    | 'local-deleted'
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
