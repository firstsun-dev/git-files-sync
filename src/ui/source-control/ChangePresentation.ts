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
    'remote-only':      'sourceControl.status.deletedLocally',
    'remote-modified':  'sourceControl.status.modifiedRemotely',
    moved:              'sourceControl.status.renamed',
    conflict:           'sourceControl.status.conflict',
    synced:             'sourceControl.status.synced',
};

/**
 * Single-letter status badge per change kind. Note `remote-only` (locally
 * deleted) is badged `D`, not `A` — a local deletion is what the user sees,
 * per the resolved decision to keep the domain filter semantics (remote-only
 * stays in the Remote bucket) while the UI row reads "Deleted locally".
 */
const BADGE: Record<SyncChangeKind, { letter: string; cls: string }> = {
    'local-only':       { letter: 'A', cls: 'local-only' },
    'local-modified':   { letter: 'M', cls: 'local-modified' },
    'remote-only':      { letter: 'D', cls: 'remote-only' },
    'remote-modified':  { letter: 'M', cls: 'remote-modified' },
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
    if (item.kind === 'remote-only') view.tooltip = t('sourceControl.status.deletedLocally.tooltip');
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