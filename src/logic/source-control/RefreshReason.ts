/**
 * Why a Source Control refresh was triggered. Carried through the unified
 * refresh pipeline (`SyncStatusRefreshService.refresh` → `sync.status` →
 * `ChangeRepository` → ViewModel → UI) so each trigger is observable instead
 * of every refresh being an anonymous rescan.
 *
 * - `startup` — the plugin's initial refresh on load (when
 *   `autoRefreshOnStartup` is on).
 * - `manual` — the user clicked the Refresh button.
 * - `local-change` — a watched vault file was created/modified/deleted and the
 *   `LocalChangeObserver` requested a rescan to reclassify affected paths.
 * - `remote-change` — reserved for a future remote-polling trigger (not yet
 *   wired; the refresh pipeline already accepts it).
 * - `sync-complete` — a push/pull just finished and the view is re-syncing the
 *   status store against the new remote head.
 */
export type RefreshReason = 'startup' | 'manual' | 'local-change' | 'remote-change' | 'sync-complete';