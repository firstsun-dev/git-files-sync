import { t, type TranslationKey } from '../../i18n';
import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';

/**
 * Action filter chips, in spec order. The visible row is four chips —
 * All / Local / Remote / Conflict — backed by the unchanged domain filters
 * (`all` / `changes` / `remote-changes` / `conflicts`). "Ready to Push" is no
 * longer a chip: it's surfaced as the inline "SELECTED FOR SYNC (N)" section
 * instead. `synced` is deliberately NOT a permanent chip — it surfaces only
 * when the user opts in via the "Show synced" toggle, so a quiet workspace
 * isn't dominated by a large synced count.
 */
const ACTION_FILTERS: SourceControlFilter[] = ['all', 'changes', 'remote-changes', 'conflicts'];

/**
 * Displayed chip labels. Domain values stay as `data-filter` attributes; only
 * the visible label changes (e.g. the `changes` domain filter reads "Local"
 * because it surfaces local-side changes). `ready-to-push` and `synced` keep
 * their existing keys even though `ready-to-push` is no longer a chip, so the
 * record stays total over {@link SourceControlFilter}.
 */
const FILTER_LABEL_KEYS: Record<SourceControlFilter, TranslationKey> = {
    all:               'sourceControl.filter.all',
    changes:           'sourceControl.filter.local',
    'ready-to-push':   'sourceControl.filter.readyToPush',
    'remote-changes':  'sourceControl.filter.remote',
    conflicts:         'sourceControl.filter.conflict',
    synced:            'sourceControl.filter.synced',
};

export interface FilterMenuCallbacks {
    /** Switches the active filter chip. */
    onFilterChange: (filter: SourceControlFilter) => void;
    /** Toggles whether synced changes are surfaced at all (the "Show synced" switch). */
    onToggleShowSynced: (show: boolean) => void;
}

export interface FilterMenuOptions {
    /** When true a compact `<select>` dropdown replaces the chip row, to save horizontal space on mobile. */
    isMobile?: boolean;
}

/**
 * Renders the Source Control filter row: the four action chips (All, Local,
 * Remote, Conflict) followed by a "Show synced" toggle. The `synced` chip is
 * appended only when `showSynced` is on, so a hidden synced bucket contributes
 * no chip and no count to the row.
 *
 * On mobile a single `<select>` dropdown replaces the chips (same domain
 * values, same counts inline as "Label (N)"), with the "Show synced" toggle
 * kept below it.
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
    options: FilterMenuOptions = {},
): void {
    const menu = container.createDiv({ cls: 'scv-filter-menu' });

    if (options.isMobile) {
        renderFilterDropdown(menu, current, counts, callbacks);
    } else {
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
    }

    const toggle = menu.createEl('label', { cls: 'scv-filter-show-synced' });
    const checkbox = toggle.createEl('input', { type: 'checkbox', cls: 'scv-filter-show-synced-checkbox' });
    checkbox.checked = showSynced;
    checkbox.addEventListener('change', () => callbacks.onToggleShowSynced(checkbox.checked));
    toggle.createSpan({ cls: 'scv-filter-show-synced-label', text: t('sourceControl.filter.showSynced') });
}

/**
 * Mobile filter dropdown: one `<select>` over the same domain filter values,
 * options labeled "Label (N)". Keeps the chip row's counts and domain values
 * but collapses four chips into a single control.
 */
function renderFilterDropdown(
    menu: HTMLElement,
    current: SourceControlFilter,
    counts: Record<SourceControlFilter, number>,
    callbacks: FilterMenuCallbacks,
): void {
    const values: SourceControlFilter[] = [...ACTION_FILTERS];
    const select = menu.createEl('select', { cls: 'scv-filter-dropdown' });
    for (const value of values) {
        const option = select.createEl('option', { value });
        option.textContent = `${t(FILTER_LABEL_KEYS[value])} (${counts[value] ?? 0})`;
        if (value === current) option.setAttr('selected', 'selected');
    }
    select.addEventListener('change', () => callbacks.onFilterChange(select.value as SourceControlFilter));
}