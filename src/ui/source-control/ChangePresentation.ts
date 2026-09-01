import { t, type TranslationKey } from '../../i18n';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { SyncChangeKind } from '../../logic/source-control/types';

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