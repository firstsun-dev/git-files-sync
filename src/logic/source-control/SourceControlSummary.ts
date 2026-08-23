import type { PushSelectionStore } from './PushSelectionStore';
import type { SourceControlFilter } from './SourceControlFilter';
import type { ChangeId, SyncChange, SyncChangeKind } from './types';

/**
 * Per-filter counts, keyed by the same {@link SourceControlFilter} values the
 * filter menu renders. This is the single source of truth for every count the
 * UI shows — the ViewModel passes it through unchanged and the view layer
 * never recomputes a count itself.
 *
 * `synced` is the *rendered* count: it is `0` when synced changes are hidden
 * (showSynced = false) so the UI can't display a synced count the user has
 * asked to suppress. The raw synced bucket is still available on
 * {@link SourceControlSummary.synced} for callers that need the actual figure.
 */
export type SourceControlCounts = Record<SourceControlFilter, number>;

/**
 * The complete presentation projection of a pending-change set: the raw
 * buckets the UI renders from, plus the single {@link counts} object every
 * count label reads from.
 *
 * Buckets are disjoint and exhaustive over {@link SyncChangeKind}:
 * - {@link localChanges}: local-only, local-modified, local-deleted, moved
 * - {@link remoteChanges}: remote-only, remote-modified
 * - {@link conflicts}: conflict
 * - {@link synced}: synced
 * - {@link all}: the union of the three actionable buckets (everything except
 *   synced) — "All" means *actionable*, not "every row", so a synced file never
 *   appears under All.
 * - {@link readyToPush}: the subset of actionable changes the user has selected
 *   for push (membership in {@link PushSelectionStore}); it overlaps the other
 *   actionable buckets by design, since "ready to push" is a selection, not a
 *   change kind.
 */
export interface SourceControlSummary {
    all: SyncChange[];
    localChanges: SyncChange[];
    remoteChanges: SyncChange[];
    readyToPush: SyncChange[];
    conflicts: SyncChange[];
    synced: SyncChange[];
    counts: SourceControlCounts;
}

const LOCAL_KINDS: ReadonlySet<SyncChangeKind> = new Set(['local-only', 'local-modified', 'local-deleted', 'moved']);
const REMOTE_KINDS: ReadonlySet<SyncChangeKind> = new Set(['remote-only', 'remote-modified']);

function isLocal(change: SyncChange): boolean { return LOCAL_KINDS.has(change.kind); }
function isRemote(change: SyncChange): boolean { return REMOTE_KINDS.has(change.kind); }
function isConflict(change: SyncChange): boolean { return change.kind === 'conflict'; }
function isSynced(change: SyncChange): boolean { return change.kind === 'synced'; }
function isActionable(change: SyncChange): boolean { return change.kind !== 'synced'; }

/**
 * Builds the single presentation projection the Source Control UI consumes.
 * Pure: given the same `changes` + `selection` + `showSynced` it always
 * produces the same {@link SourceControlSummary}, with no side effects on the
 * store. Callers (the ViewModel) hold no count logic of their own.
 *
 * @param showSynced when false, {@link SourceControlCounts.synced} is reported
 * as `0` (the UI hides the synced bucket) while {@link SourceControlSummary.synced}
 * still holds the raw synced changes.
 */
export function buildSummary(
    changes: readonly SyncChange[],
    selection: PushSelectionStore,
    showSynced: boolean,
): SourceControlSummary {
    const localChanges = changes.filter(isLocal);
    const remoteChanges = changes.filter(isRemote);
    const conflicts = changes.filter(isConflict);
    const synced = changes.filter(isSynced);
    const all = changes.filter(isActionable);

    const selectedIds = new Set<ChangeId>(selection.getSelectedChangeIds());
    const readyToPush = all.filter(change => selectedIds.has(change.id));

    const counts: SourceControlCounts = {
        all: all.length,
        changes: localChanges.length,
        'ready-to-push': readyToPush.length,
        'remote-changes': remoteChanges.length,
        conflicts: conflicts.length,
        synced: showSynced ? synced.length : 0,
    };

    return { all, localChanges, remoteChanges, readyToPush, conflicts, synced, counts };
}