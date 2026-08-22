import { t, type TranslationKey } from '../../i18n';
import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';

/**
 * Action filter chips, in spec order. `synced` is deliberately NOT a permanent
 * chip — it surfaces only when the user opts in via the "Show synced" toggle,
 * so a quiet workspace isn't dominated by a large synced count.
 */
const ACTION_FILTERS: SourceControlFilter[] = ['all', 'changes', 'ready-to-push', 'remote-changes', 'conflicts'];

const FILTER_LABEL_KEYS: Record<SourceControlFilter, TranslationKey> = {
    all:               'sourceControl.filter.all',
    changes:           'sourceControl.filter.changes',
    'ready-to-push':   'sourceControl.filter.readyToPush',
    'remote-changes':  'sourceControl.filter.remoteChanges',
    conflicts:         'sourceControl.filter.conflicts',
    synced:            'sourceControl.filter.synced',
};

export interface FilterMenuCallbacks {
    /** Switches the active filter chip. */
    onFilterChange: (filter: SourceControlFilter) => void;
    /** Toggles whether synced changes are surfaced at all (the "Show synced" switch). */
    onToggleShowSynced: (show: boolean) => void;
}

/**
 * Renders the Source Control filter row: the five action chips (All, Changes,
 * Ready to Push, Remote Changes, Conflicts) followed by a "Show synced"
 * toggle. The `synced` chip is appended only when `showSynced` is on, so a
 * hidden synced bucket contributes no chip and no count to the row.
 *
 * Per-filter counts come straight from the ViewModel's single-source counts;
 * the menu never recomputes one.
 */
export function renderFilterMenu(
    container: HTMLElement,
    current: SourceControlFilter,
    counts: Record<SourceControlFilter, number>,
    showSynced: boolean,
    callbacks: FilterMenuCallbacks,
): void {
    const menu = container.createDiv({ cls: 'scv-filter-menu' });

    const renderChip = (value: SourceControlFilter): void => {
        const isActive = value === current;
        const btn = menu.createEl('button', { cls: `scv-filter-option${isActive ? ' is-active' : ''}` });
        btn.setAttr('data-filter', value);
        btn.setAttr('aria-pressed', String(isActive));
        btn.createSpan({ cls: 'scv-filter-label', text: t(FILTER_LABEL_KEYS[value]) });
        btn.createSpan({ cls: 'scv-filter-count', text: String(counts[value] ?? 0) });
        btn.addEventListener('click', () => callbacks.onFilterChange(value));
    };

    for (const value of ACTION_FILTERS) renderChip(value);
    if (showSynced) renderChip('synced');

    const toggle = menu.createEl('label', { cls: 'scv-filter-show-synced' });
    const checkbox = toggle.createEl('input', { type: 'checkbox', cls: 'scv-filter-show-synced-checkbox' });
    checkbox.checked = showSynced;
    checkbox.addEventListener('change', () => callbacks.onToggleShowSynced(checkbox.checked));
    toggle.createSpan({ cls: 'scv-filter-show-synced-label', text: t('sourceControl.filter.showSynced') });
}