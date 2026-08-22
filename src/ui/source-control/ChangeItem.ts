import { setIcon } from 'obsidian';
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
 * rename arrow for moves), optional diff-stat span, and operation
 * indicator. All kind-specific presentation (badge letter, subtitle,
 * rename display) comes from {@link presentChange} so this component stays a
 * pure renderer.
 */
export function renderChangeItem(
    container: HTMLElement,
    item: SourceControlItem,
    displayName: string,
    callbacks: ChangeItemCallbacks,
): HTMLElement {
    const view = presentChange(item, displayName);

    const row = container.createDiv({ cls: `scv-change-item scv-kind-${item.kind}` });
    row.setAttr('data-change-id', item.id);
    if (view.tooltip) row.setAttr('title', view.tooltip);

    const checkbox = row.createEl('input', { type: 'checkbox', cls: 'scv-change-select' });
    checkbox.checked = item.isReadyToPush;
    checkbox.addEventListener('change', () => callbacks.onToggleSelect(item.id, checkbox.checked));

    const badge = view.badge;
    row.createSpan({ cls: `scv-badge scv-badge-${badge.cls}`, text: badge.letter });

    const label = row.createDiv({ cls: 'scv-change-name' });
    if (view.renameFrom) {
        label.createSpan({ cls: 'scv-change-rename-from', text: view.renameFrom });
        setIcon(label.createSpan({ cls: 'scv-change-rename-arrow' }), ICONS.moved);
    }
    label.createSpan({ cls: 'scv-change-name-text', text: view.displayName });
    label.createSpan({ cls: 'scv-change-subtitle', text: view.subtitle });

    const stat = callbacks.getDiffStat?.(item.id);
    if (stat) row.createSpan({ cls: 'scv-diff-stat', text: formatStat(stat) });

    renderOperationIndicator(row, item.operationStatus);

    row.addEventListener('click', (evt) => {
        if (evt.target === checkbox) return;
        callbacks.onOpenDiff(item);
    });

    return row;
}

function formatStat(stat: ChangeStat): string {
    const parts: string[] = [];
    if (stat.additions > 0) parts.push(`+${stat.additions}`);
    if (stat.deletions > 0) parts.push(`-${stat.deletions}`);
    return parts.join(' ');
}