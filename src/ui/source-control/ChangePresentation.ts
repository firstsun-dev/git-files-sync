import { computeSideBySideDiff } from '../../utils/diff';
import { t, type TranslationKey } from '../../i18n';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { SyncChangeKind } from '../../logic/source-control/types';

/** Additions/deletions for a single change's diff, the +/- stat a row shows. */
export interface ChangeStat {
    additions: number;
    deletions: number;
}

/**
 * UI-only presentation of one change: the badge letter + class, a short
 * subtitle, the display name (with rename "from" separated out), and an
 * optional tooltip. All UI-specific meaning (M/A/D/R icons, "Deleted
 * locally" wording, rename arrow) lives here rather than in the domain, so
 * `SyncChangeKind` / `SourceControlFilter` / `SourceControlSummary` stay
 * semantics-only and untouched.
 */
export interface ChangeRowView {
    badge: { letter: string; cls: string };
    subtitle: string;
    displayName: string;
    /** Present for a tracked rename: the old name shown before an arrow and `displayName`. */
    renameFrom?: string;
    tooltip?: string;
}

const SUBTITLE_KEYS: Record<SyncChangeKind, TranslationKey> = {
    'local-only':       'sourceControl.status.added',
    'local-modified':   'sourceControl.status.modified',
    'local-deleted':    'sourceControl.status.deletedLocally',
    'remote-only':      'sourceControl.status.remoteAvailable',
    'remote-modified':  'sourceControl.status.modifiedRemotely',
    moved:              'sourceControl.status.renamed',
    conflict:           'sourceControl.status.conflict',
    synced:             'sourceControl.status.synced',
};

/**
 * Single-character status badge per change kind. The remote-side kinds carry
 * directional glyphs so a row reads as an action the user can take rather
 * than a Git status letter:
 * - `remote-only` (exists on remote, missing locally) is badged `↓` — a
 *   download the user can pull — NOT `D`, since `D` reads as "I'm about to
 *   delete this" when the opposite is true.
 * - `remote-modified` (both sides diverged) is badged `↕` to signal a
 *   two-sided change, distinct from a one-sided local `M`.
 */
const BADGE: Record<SyncChangeKind, { letter: string; cls: string }> = {
    'local-only':       { letter: 'A', cls: 'local-only' },
    'local-modified':   { letter: 'M', cls: 'local-modified' },
    'local-deleted':    { letter: 'D', cls: 'local-deleted' },
    'remote-only':      { letter: '↓', cls: 'remote-only' },
    'remote-modified':  { letter: '↕', cls: 'remote-modified' },
    moved:              { letter: 'R', cls: 'moved' },
    conflict:           { letter: '!', cls: 'conflict' },
    synced:             { letter: 'S', cls: 'synced' },
};

/**
 * Projects a {@link SourceControlItem} into a UI row view. `displayName` is
 * the tree node's file name (passed in from `ChangeTree`); the rename "from"
 * name is derived here from `item.previousPath` so the rename-arrow rendering
 * moves out of `ChangeItem`.
 */
export function presentChange(item: SourceControlItem, displayName: string): ChangeRowView {
    const view: ChangeRowView = {
        badge: BADGE[item.kind],
        subtitle: t(SUBTITLE_KEYS[item.kind]),
        displayName,
    };
    if (item.previousPath) view.renameFrom = item.previousPath.split('/').pop() ?? item.previousPath;
    if (item.kind === 'remote-only') view.tooltip = t('sourceControl.status.remoteAvailable.tooltip');
    if (item.kind === 'local-deleted') view.tooltip = t('sourceControl.status.deletedLocally.tooltip');
    return view;
}

/**
 * +/- stat for a two-sided diff (local-modified / remote-only /
 * remote-modified / moved / conflict), reusing the existing LCS op logic in
 * `utils/diff.ts`. Additions = added ops, deletions = removed ops.
 */
export function computeDiffStat(remote: string, local: string): ChangeStat {
    const rows = computeSideBySideDiff(remote, local);
    let additions = 0;
    let deletions = 0;
    for (const row of rows) {
        if (row.right.type === 'added') additions++;
        if (row.left.type === 'removed') deletions++;
    }
    return { additions, deletions };
}

/**
 * Cheap stat for a `local-only` change: additions only (the local line
 * count), no deletions and no remote/provider call. A trailing newline
 * doesn't add a phantom line.
 */
export function cheapLocalStat(local: string): ChangeStat {
    return { additions: countLines(local), deletions: 0 };
}

/**
 * Stat for a one-sided change whose only content is the ADDED side: every
 * line is an addition, no deletions. Used for `local-only` (A) and
 * `remote-only` (↓) — both show +N, not the -N a content-vs-'' diff would
 * produce for the download direction.
 */
export function addedContentStat(content: string): ChangeStat {
    return { additions: countLines(content), deletions: 0 };
}

/**
 * Stat for a one-sided DELETION: the content existed remotely and is gone
 * locally, so every line is a deletion. Used for `local-deleted` (D).
 */
export function deletedContentStat(content: string): ChangeStat {
    return { additions: 0, deletions: countLines(content) };
}

function countLines(s: string): number {
    if (s === '') return 0;
    const lines = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}