import { setIcon, setTooltip } from 'obsidian';
import { ICONS } from '../components/icons';
import { renderOperationIndicator } from './OperationIndicator';
import { presentChange, type ChangeStat } from './ChangePresentation';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeId } from '../../logic/source-control/types';

export interface ChangeItemCallbacks {
    onToggleSelect: (id: ChangeId, selected: boolean) => void;
    onOpenDiff: (item: SourceControlItem) => void;
    /** Looks up a cached diff stat for a row, if one has been computed. */
    getDiffStat?: (id: ChangeId) => ChangeStat | undefined;
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
): HTMLElement {
    const view = presentChange(item, displayName);

    const row = container.createDiv({ cls: `scv-change-item scv-kind-${item.kind}${item.isReadyToPush ? ' is-selected' : ''}` });
    row.setAttr('data-change-id', item.id);
    if (view.tooltip) row.setAttr('title', view.tooltip);

    const checkbox = row.createEl('input', { type: 'checkbox', cls: 'scv-change-select' });
    checkbox.checked = item.isReadyToPush;
    checkbox.addEventListener('change', () => callbacks.onToggleSelect(item.id, checkbox.checked));

    const badgeEl = row.createSpan({ cls: `scv-badge scv-badge-${view.badge.cls}`, text: view.badge.letter });
    setTooltip(badgeEl, view.subtitle);

    const label = row.createDiv({ cls: 'scv-change-name' });
    if (view.renameFrom) {
        label.createSpan({ cls: 'scv-change-rename-from', text: view.renameFrom });
        setIcon(label.createSpan({ cls: 'scv-change-rename-arrow' }), ICONS.moved);
    }
    label.createSpan({ cls: 'scv-change-name-text', text: view.displayName });

    renderDiffStat(row, callbacks.getDiffStat?.(item.id));

    renderOperationIndicator(row, item.operationStatus);

    row.addEventListener('click', (evt) => {
        if (evt.target === checkbox) return;
        callbacks.onOpenDiff(item);
    });

    return row;
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