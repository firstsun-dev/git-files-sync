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
    'remote-only':      { letter: '↓', cls: 'remote-only' },
    'remote-modified':  { letter: '↕', cls: 'remote-modified' },
    moved:              { letter: 'R', cls: 'moved' },
    conflict:           { letter: '!', cls: 'conflict' },
    synced:             { letter: 'S', cls: 'synced' },
};

/**
 * Which sync operation a change kind maps to in the Sync Queue, so the queue
 * can be grouped (Upload / Download) and the Sync button can route each
 * selected change to the right primitive — push for one-sided local changes
 * and moves, pull for one-sided remote changes — instead of pushing every
 * selection and no-op'ing remote-only rows. `conflict` routes to `upload`
 * (push) as the default; it surfaces a conflict either way and never silent
 * overwrites. `synced` never reaches the queue, so it's mapped to `upload`
 * only to satisfy the exhaustive record.
 */
export type ChangeOperation = 'upload' | 'download';

const OPERATION: Record<SyncChangeKind, ChangeOperation> = {
    'local-only':       'upload',
    'local-modified':   'upload',
    'remote-only':      'download',
    'remote-modified':  'download',
    moved:              'upload',
    conflict:           'upload',
    synced:             'upload',
};

/** The sync operation a change kind belongs to (Upload vs Download) for queue grouping and Sync routing. */
export function changeOperation(kind: SyncChangeKind): ChangeOperation {
    return OPERATION[kind];
}

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

function countLines(s: string): number {
    if (s === '') return 0;
    const lines = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}