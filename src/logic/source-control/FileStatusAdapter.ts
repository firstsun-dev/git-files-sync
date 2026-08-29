import type { FileStatus, SyncStatus } from '../sync-status-service';
import { toChangeId, type SyncChange, type SyncChangeKind } from './types';

const KIND_BY_STATUS: Record<SyncStatus, SyncChangeKind> = {
    synced: 'synced',
    modified: 'local-modified',
    unsynced: 'local-only',
    'remote-only': 'remote-only',
    'local-deleted': 'local-deleted',
    moved: 'moved',
};

/**
 * Projects `FileStatus[]` (the existing sync-status domain's flat status map,
 * as exposed by `SyncWorkspace.getStatuses()`) into `SyncChange[]` for the
 * Source Control `ChangeRepository` / `SourceControlViewModel` layer added in
 * Phase 1.
 *
 * Two known gaps versus the full `SyncChangeKind` model, both pre-existing
 * limits of `FileStatus` rather than anything introduced here:
 *
 * - `FileStatus.status` never distinguishes which side changed for a
 *   two-sided diff (`SyncStatusService.classify` collapses both directions
 *   into `'modified'`), so `'modified'` maps to `'local-modified'` as a
 *   best-effort approximation: the row therefore offers both push and pull
 *   regardless of which side actually changed.
 * - No `FileStatus` value ever produces `'conflict'`: conflicts are only
 *   detected during `SyncManager.pushFiles` (via `SyncPlanner.classify`
 *   against a stored base sha) and resolved interactively through
 *   `ObsidianSyncInteraction`, not pre-computed for display. Widening this
 *   is out of scope for a UI/wiring cutover -- it would mean adding new
 *   sync classification behavior, not just rewiring existing behavior.
 *
 * `'local-deleted'` (a tracked file removed locally, remote still holds it)
 * IS produced and maps to `'local-deleted'`, keeping a user deletion distinct
 * from a never-tracked `'remote-only'` download candidate.
 *
 * `'checking'` rows (status still being resolved) are omitted rather than
 * mapped to a placeholder kind, so they don't flash into a section and back
 * out once resolved.
 *
 * `ChangeId` is derived from the current path: `FileStatus` itself has no
 * rename-stable identity (`SyncStatusRefreshService.handleFileRenamed`
 * re-keys its map to the new path), so a change's id also changes when the
 * file is renamed. That's an existing limit of the underlying data, not a
 * regression -- the legacy status map re-keyed on rename the same way.
 */
export function toSyncChanges(statuses: readonly FileStatus[]): SyncChange[] {
    const changes: SyncChange[] = [];
    for (const status of statuses) {
        if (status.status === 'checking') continue;
        changes.push({
            id: toChangeId(status.path),
            path: status.path,
            previousPath: status.movedFrom,
            kind: KIND_BY_STATUS[status.status],
        });
    }
    return changes;
}
