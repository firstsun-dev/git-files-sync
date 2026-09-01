import type { SyncChangeKind } from './types';

/**
 * Which sync operation a change kind defaults to when it's synced from the
 * Sync Queue (the Sync button routes each queued change to one of these).
 * This is what `changeOperation` in `ui/source-control/ChangePresentation.ts`
 * used to be: that file's job is UI-only presentation (badge, subtitle,
 * tooltip), but the routing decision itself is domain/application policy —
 * which primitive a change kind maps to isn't a rendering concern — so it
 * lives here instead, decoupled from presentation.
 */
export type SyncAction = 'push' | 'pull' | 'delete-remote';

const DEFAULT_ACTION: Record<SyncChangeKind, SyncAction> = {
    'local-only':       'push',
    'local-modified':   'push',
    // A tracked file removed locally has no local content to push, so its
    // non-destructive-by-omission default is to delete it on the remote
    // (mirroring the local deletion), not to silently restore it — that
    // would undo the user's delete. Restoring is still available via the
    // row's Download action (see `canDownload`).
    'local-deleted':    'delete-remote',
    'remote-only':      'pull',
    'remote-modified':  'pull',
    moved:              'push',
    conflict:           'push',
    // 'synced' never reaches the Sync Queue; mapped to 'push' only to
    // satisfy the exhaustive record.
    synced:             'push',
};

// Every action a change kind may legally resolve to, default first. Drives
// both what an explicit override is allowed to be and the fallback when a
// stored override no longer applies (see `resolveSyncAction`). `conflict`
// and `synced` intentionally allow only their default: conflict resolution
// runs through `BatchConflictResolutionModal`, not a Queue override, and
// `synced` never reaches the Sync Queue at all.
const AVAILABLE_ACTIONS: Record<SyncChangeKind, readonly SyncAction[]> = {
    'local-only':       ['push'],
    'local-modified':   ['push', 'pull'],
    'local-deleted':    ['delete-remote', 'pull'],
    'remote-only':      ['pull', 'delete-remote'],
    'remote-modified':  ['pull', 'push'],
    moved:              ['push'],
    conflict:           ['push'],
    synced:             ['push'],
};

/** The default sync action a change kind routes to when synced from the Sync Queue. */
export function defaultSyncAction(kind: SyncChangeKind): SyncAction {
    return DEFAULT_ACTION[kind];
}

/** Every action a change kind may legally resolve to, default first. */
export function availableSyncActions(kind: SyncChangeKind): readonly SyncAction[] {
    return AVAILABLE_ACTIONS[kind];
}

/**
 * Resolves the action a change actually syncs as: the given override if it's
 * still legal for `kind`, otherwise the kind's default. This is what makes a
 * stale override (e.g. the user picked "pull" on a `local-modified` change,
 * then it became `local-only` after a remote delete) harmless — it silently
 * falls back instead of ever executing an action the current kind can't
 * support.
 */
export function resolveSyncAction(kind: SyncChangeKind, override?: SyncAction): SyncAction {
    if (override && AVAILABLE_ACTIONS[kind].includes(override)) {
        return override;
    }
    return DEFAULT_ACTION[kind];
}

/**
 * Whether a change kind has something on the remote it can pull/restore —
 * `remote-only` (never existed locally), `remote-modified` (tracked file
 * changed only on the remote), and `local-deleted` (tracked file removed
 * locally, still present on remote) all do. Drives whether a row renders the
 * inline Download button.
 */
export function canDownload(kind: SyncChangeKind): boolean {
    return kind === 'remote-only' || kind === 'remote-modified' || kind === 'local-deleted';
}
