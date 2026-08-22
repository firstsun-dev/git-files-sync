import { t, type TranslationKey } from '../../i18n';
import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';

/**
 * Action filter chips, in spec order. The visible row is four chips —
 * All / Local / Remote / Conflict — backed by the unchanged domain filters
 * (`all` / `changes` / `remote-changes` / `conflicts`). "Ready to Push" is no
 * longer a chip: it's surfaced as the dedicated "SELECTED FOR SYNC" section
 * instead. `synced` is intentionally not surfaced in the UI: a quiet
 * workspace stays quiet, and the domain `synced` filter/summary (still
 * computed by the ViewModel) simply has no chip to open it.
 */
const ACTION_FILTERS: SourceControlFilter[] = ['all', 'changes', 'remote-changes', 'conflicts'];

/**
 * Displayed chip labels. Domain values stay as `data-filter` attributes; only
 * the visible label changes (e.g. the `changes` domain filter reads "Local"
 * because it surfaces local-side changes). `ready-to-push` and `synced` keep
 * their keys so the record stays total over {@link SourceControlFilter},
 * even though neither is a chip.
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
}

export interface FilterMenuOptions {
    /** When true a compact `<select>` dropdown replaces the chip row, to save horizontal space on mobile. */
    isMobile?: boolean;
}

/**
 * Renders the Source Control filter row: the four action chips (All, Local,
 * Remote, Conflict). On mobile a single `<select>` dropdown replaces the
 * chips (same domain values, counts inline as "Label (N)").
 *
 * Per-filter counts come straight from the ViewModel's single-source counts;
 * the menu never recomputes one.
 */
export function renderFilterMenu(
    container: HTMLElement,
    current: SourceControlFilter,
    counts: Record<SourceControlFilter, number>,
    callbacks: FilterMenuCallbacks,
    options: FilterMenuOptions = {},
): void {
    const menu = container.createDiv({ cls: 'scv-filter-menu' });

    if (options.isMobile) {
        renderFilterDropdown(menu, current, counts, callbacks);
        return;
    }

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
    const select = menu.createEl('select', { cls: 'scv-filter-dropdown' });
    for (const value of ACTION_FILTERS) {
        const option = select.createEl('option', { value });
        option.textContent = `${t(FILTER_LABEL_KEYS[value])} (${counts[value] ?? 0})`;
        if (value === current) option.setAttr('selected', 'selected');
    }
    select.addEventListener('change', () => callbacks.onFilterChange(select.value as SourceControlFilter));
}