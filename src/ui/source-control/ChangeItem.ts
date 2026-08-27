import { setIcon, setTooltip } from 'obsidian';
import { t } from '../../i18n';
import { ICONS } from '../components/icons';
import { renderOperationIndicator } from './OperationIndicator';
import { presentChange, type ChangeStat } from './ChangePresentation';
import { canDownload } from '../../logic/source-control/ChangeActionPolicy';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeId } from '../../logic/source-control/types';

export interface ChangeItemCallbacks {
    onToggleSelect: (id: ChangeId, selected: boolean) => void;
    onOpenDiff: (item: SourceControlItem) => void;
    /**
     * Pulls a single change into the local vault. Invoked for rows where
     * {@link canDownload} is true — `remote-only` (add it locally) and
     * `local-deleted` (restore it locally) — the Download button renders
     * only for those kinds, so the callback never has to re-classify.
     */
    onDownload?: (item: SourceControlItem) => void;
    /** Looks up a cached diff stat for a row, if one has been computed. */
    getDiffStat?: (id: ChangeId) => ChangeStat | undefined;
}

/** Presentation-only options for a change row. */
export interface ChangeItemOptions {
    /**
     * Folder portion of the path (everything before the last `/`), shown as a
     * dimmed right-aligned suffix in list mode so rows stay disambiguable
     * without the tree's folder nesting. Omitted in tree mode where folders
     * already convey the location.
     */
    folderPath?: string;
    /**
     * Renders the row in the flat-list variant: the name no longer stretches
     * to fill the row, leaving room for {@link folderPath} on the right.
     */
    listMode?: boolean;
}

/**
 * Renders a single change row: selection checkbox, status badge, name (with
 * rename arrow for moves), optional diff-stat, and operation indicator. All
 * kind-specific presentation (badge letter, kind label, rename display)
 * comes from {@link presentChange} so this component stays a pure renderer.
 *
 * The kind's short label (e.g. "Modified locally") is shown as the badge tooltip
 * rather than an inline subtitle, so the row reads `M  name  +3 -1`
 * without the `M`/`Modified` redundancy. A row selected for push gets an
 * `is-selected` class; such rows render in the "Checked Changes" region
 * above the tree (the tree excludes them), so the class marks them as
 * queued without any visual muting.
 */
export function renderChangeItem(
    container: HTMLElement,
    item: SourceControlItem,
    displayName: string,
    callbacks: ChangeItemCallbacks,
    options: ChangeItemOptions = {},
): HTMLElement {
    const view = presentChange(item, displayName);

    const row = container.createDiv({
        cls: `scv-change-item scv-kind-${item.kind}${item.isSelectedForSync ? ' is-selected' : ''}${options.listMode ? ' scv-change-item-list' : ''}`,
    });
    row.setAttr('data-change-id', item.id);
    if (view.tooltip) row.setAttr('title', view.tooltip);

    const checkbox = row.createEl('input', { type: 'checkbox', cls: 'scv-change-select' });
    checkbox.checked = item.isSelectedForSync;
    checkbox.addEventListener('change', () => callbacks.onToggleSelect(item.id, checkbox.checked));

    const badgeEl = row.createSpan({ cls: `scv-badge scv-badge-${view.badge.cls}`, text: view.badge.letter });
    setTooltip(badgeEl, view.subtitle);

    const label = row.createDiv({ cls: 'scv-change-name' });
    if (view.renameFrom) {
        label.createSpan({ cls: 'scv-change-rename-from', text: view.renameFrom });
        setIcon(label.createSpan({ cls: 'scv-change-rename-arrow' }), ICONS.moved);
    }
    label.createSpan({ cls: 'scv-change-name-text', text: view.displayName });

    // List mode surfaces the folder path as a dimmed suffix so a flat list
    // stays disambiguable; tree mode omits it (folders already convey it).
    if (options.listMode && options.folderPath) {
        row.createSpan({ cls: 'scv-change-path', text: options.folderPath });
    }

    renderDiffStat(row, callbacks.getDiffStat?.(item.id));

    // A change with something to pull from remote (remote-only: add it
    // locally; local-deleted: restore it locally) carries a direct Download
    // action so the user can pull it without first adding it to the Sync
    // Queue. The button stops propagation so clicking it doesn't also
    // trigger the row's open-diff/open-remote behavior.
    if (canDownload(item.kind) && callbacks.onDownload) {
        renderDownloadAction(row, item, callbacks.onDownload);
    }

    renderOperationIndicator(row, item.operationStatus);

    row.addEventListener('click', (evt) => {
        if (evt.target === checkbox) return;
        callbacks.onOpenDiff(item);
    });

    return row;
}

/**
 * The inline Download button on a remote-only row. A small text button with
 * a download glyph + label; clicking calls `onDownload` and stops the event
 * so the row click handler doesn't also fire.
 */
function renderDownloadAction(row: HTMLElement, item: SourceControlItem, onDownload: (item: SourceControlItem) => void): void {
    const btn = row.createEl('button', {
        cls: 'scv-change-download',
        attr: { type: 'button' },
    });
    setIcon(btn.createSpan({ cls: 'scv-change-download-icon' }), ICONS.download);
    btn.createSpan({ cls: 'scv-change-download-label', text: t('sourceControl.action.download') });
    setTooltip(btn, t('sourceControl.action.download.tooltip'));
    btn.addEventListener('click', (evt) => { evt.stopPropagation(); onDownload(item); });
}

/**
 * Renders the +/- diff stat as two colored spans (green additions, red
 * deletions) so the magnitude and direction read at a glance. Nothing is
 * rendered when the stat is unavailable or zero on both sides.
 */
export function renderDiffStat(row: HTMLElement, stat: ChangeStat | undefined): void {
    if (!stat) return;
    const hasAdd = stat.additions > 0;
    const hasDel = stat.deletions > 0;
    if (!hasAdd && !hasDel) return;
    const wrap = row.createSpan({ cls: 'scv-diff-stat' });
    if (hasAdd) wrap.createSpan({ cls: 'scv-diff-stat-add', text: `+${stat.additions}` });
    if (hasAdd && hasDel) wrap.createSpan({ cls: 'scv-diff-stat-sep', text: ' ' });
    if (hasDel) wrap.createSpan({ cls: 'scv-diff-stat-del', text: `-${stat.deletions}` });
}