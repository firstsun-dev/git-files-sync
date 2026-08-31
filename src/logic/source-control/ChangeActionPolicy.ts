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
export type DefaultSyncAction = 'push' | 'pull' | 'delete-remote';

const DEFAULT_ACTION: Record<SyncChangeKind, DefaultSyncAction> = {
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

/** The default sync action a change kind routes to when synced from the Sync Queue. */
export function defaultSyncAction(kind: SyncChangeKind): DefaultSyncAction {
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
