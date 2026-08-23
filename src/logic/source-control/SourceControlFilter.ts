import type { PushSelectionStore } from './PushSelectionStore';
import type { SyncChange, SyncChangeKind } from './types';

export type SourceControlFilter =
    | 'all'
    | 'changes'
    | 'ready-to-push'
    | 'remote-changes'
    | 'conflicts'
    | 'synced';

const LOCAL_KINDS: ReadonlySet<SyncChangeKind> = new Set(['local-only', 'local-modified', 'local-deleted', 'moved']);
const REMOTE_KINDS: ReadonlySet<SyncChangeKind> = new Set(['remote-only', 'remote-modified']);

/**
 * Whether `change` belongs under `filter`. Filters are user-facing *action*
 * semantics, not a raw mirror of Git status:
 *
 * - `all` — *actionable* changes only (everything except synced). A synced
 *   file needs no action, so it never appears under All. This keeps All from
 *   duplicating the Synced bucket.
 * - `changes` — local-side changes only (local-only, local-modified,
 *   local-deleted, moved). Remote-only/conflict rows belong to their own
 *   filters, not Changes.
 * - `ready-to-push` — defined purely by {@link PushSelectionStore} membership;
 *   it's a user selection, not a fact derivable from the change's kind alone.
 * - `remote-changes` — remote-only / remote-modified.
 * - `conflicts` — conflict.
 * - `synced` — synced (only surfaced when the user opts in via "Show synced").
 */
export function matchesFilter(change: SyncChange, filter: SourceControlFilter, selection: PushSelectionStore): boolean {
    switch (filter) {
        case 'all': return change.kind !== 'synced';
        case 'changes': return LOCAL_KINDS.has(change.kind);
        case 'ready-to-push': return selection.isIncluded(change.id) && change.kind !== 'synced';
        case 'remote-changes': return REMOTE_KINDS.has(change.kind);
        case 'conflicts': return change.kind === 'conflict';
        case 'synced': return change.kind === 'synced';
    }
}