import { t, type TranslationKey } from '../../i18n';
import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';
import type { SourceControlCounts } from '../../logic/source-control/SourceControlSummary';

/**
 * A UI filter chip. Each chip maps to a domain {@link SourceControlFilter}
 * plus a `showSynced` flag — the same two parameters the ViewModel's
 * `getState(filter, showSynced)` already accepts — so this stays a pure
 * view-layer composition over the untouched domain filters.
 *
 * - **Needs Sync** (default) — the actionable set (everything except synced),
 *   i.e. domain `all` with synced hidden. This is "what do I need to handle?".
 * - **All** — everything *including* synced. The domain `all` filter only
 *   returns actionable rows, so this chip composes `all` + the `synced`
 *   bucket in the view (see `SourceControlView`) rather than via a domain
 *   change. Surfaced as an opt-in overview; the default stays on Needs Sync
 *   so a quiet workspace stays quiet.
 * - **Remote / Conflict / Synced** — the matching domain filters.
 *
 * "Local" (domain `changes`) is intentionally not a chip: Needs Sync already
 * covers local-side changes, and a standalone local-only view added a
 * category without adding action clarity.
 */
export interface FilterChip {
    id: string;
    filter: SourceControlFilter;
    showSynced: boolean;
    labelKey: TranslationKey;
    /** Count shown on the chip, derived from the single-source ViewModel counts (synced count must be populated). */
    count: (counts: SourceControlCounts) => number;
}

/** The five filter chips, in display order. */
export const FILTER_CHIPS: readonly FilterChip[] = [
    { id: 'all',       filter: 'all',            showSynced: true,  labelKey: 'sourceControl.filter.all',       count: c => c.all + c.synced },
    { id: 'needsSync', filter: 'all',            showSynced: false, labelKey: 'sourceControl.filter.needsSync', count: c => c.all },
    { id: 'remote',    filter: 'remote-changes', showSynced: false, labelKey: 'sourceControl.filter.remote',   count: c => c['remote-changes'] },
    { id: 'conflict',  filter: 'conflicts',      showSynced: false, labelKey: 'sourceControl.filter.conflict', count: c => c.conflicts },
    { id: 'synced',    filter: 'synced',         showSynced: true,  labelKey: 'sourceControl.filter.synced',   count: c => c.synced },
];

/** Finds the chip matching a (filter, showSynced) selection, for active-chip highlighting. */
export function findChip(filter: SourceControlFilter, showSynced: boolean): FilterChip | undefined {
    return FILTER_CHIPS.find(chip => chip.filter === filter && chip.showSynced === showSynced);
}

export interface FilterMenuCallbacks {
    /** Switches the active filter chip. */
    onFilterChange: (filter: SourceControlFilter, showSynced: boolean) => void;
}

export interface FilterMenuOptions {
    /** When true a compact `<select>` dropdown replaces the chip row, to save horizontal space on mobile. */
    isMobile?: boolean;
}

/**
 * Renders the Source Control filter row: five chips — All / Needs Sync /
 * Remote / Conflict / Synced. On mobile a single `<select>` dropdown
 * replaces the chips (same chip ids, counts inline as "Label (N)").
 *
 * Per-filter counts come straight from the ViewModel's single-source counts
 * (passed in with the synced count populated); the menu never recomputes one.
 */
export function renderFilterMenu(
    container: HTMLElement,
    current: { filter: SourceControlFilter; showSynced: boolean },
    counts: SourceControlCounts,
    callbacks: FilterMenuCallbacks,
    options: FilterMenuOptions = {},
): void {
    const menu = container.createDiv({ cls: 'scv-filter-menu' });

    if (options.isMobile) {
        renderFilterDropdown(menu, current, counts, callbacks);
        return;
    }

    const activeId = findChip(current.filter, current.showSynced)?.id;
    for (const chip of FILTER_CHIPS) {
        const isActive = chip.id === activeId;
        const btn = menu.createEl('button', { cls: `scv-filter-option${isActive ? ' is-active' : ''}` });
        btn.setAttr('data-filter', chip.id);
        btn.setAttr('aria-pressed', String(isActive));
        btn.createSpan({ cls: 'scv-filter-label', text: t(chip.labelKey) });
        btn.createSpan({ cls: 'scv-filter-count', text: String(chip.count(counts)) });
        btn.addEventListener('click', () => callbacks.onFilterChange(chip.filter, chip.showSynced));
    }
}

/**
 * Mobile filter dropdown: one `<select>` over the same chip set, options
 * labeled "Label (N)". Collapses five chips into a single control.
 */
function renderFilterDropdown(
    menu: HTMLElement,
    current: { filter: SourceControlFilter; showSynced: boolean },
    counts: SourceControlCounts,
    callbacks: FilterMenuCallbacks,
): void {
    const activeId = findChip(current.filter, current.showSynced)?.id;
    const select = menu.createEl('select', { cls: 'scv-filter-dropdown' });
    for (const chip of FILTER_CHIPS) {
        const option = select.createEl('option', { value: chip.id });
        option.textContent = `${t(chip.labelKey)} (${chip.count(counts)})`;
        if (chip.id === activeId) option.setAttr('selected', 'selected');
    }
    select.addEventListener('change', () => {
        const chip = FILTER_CHIPS.find(c => c.id === select.value);
        if (chip) callbacks.onFilterChange(chip.filter, chip.showSynced);
    });
}