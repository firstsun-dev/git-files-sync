import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { renderFilterMenu } from '../../../src/ui/source-control/FilterMenu';
import type { SourceControlFilter } from '../../../src/logic/source-control/SourceControlFilter';
import type { SourceControlCounts } from '../../../src/logic/source-control/SourceControlSummary';
import { setupObsidianDOM, createContainer } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

const zeroCounts: SourceControlCounts = {
    all: 0, changes: 0, 'ready-to-push': 0, 'remote-changes': 0, conflicts: 0, synced: 0,
};

describe('renderFilterMenu', () => {
    let container: HTMLElement;
    let callbacks: { onFilterChange: (f: SourceControlFilter, showSynced: boolean) => void };

    beforeEach(() => {
        container = createContainer();
        callbacks = { onFilterChange: vi.fn() };
    });

    it('renders the five chips (All/Needs Sync/Remote/Conflict/Synced)', () => {
        renderFilterMenu(container, { filter: 'all', showSynced: false }, zeroCounts, callbacks);

        const chips = Array.from(container.querySelectorAll('.scv-filter-option')).map(el => el.getAttribute('data-filter'));
        expect(chips).toEqual(['all', 'needsSync', 'remote', 'conflict', 'synced']);
    });

    it('labels the chips with their display names', () => {
        renderFilterMenu(container, { filter: 'all', showSynced: false }, zeroCounts, callbacks);

        const labels = Array.from(container.querySelectorAll('.scv-filter-option .scv-filter-label')).map(el => el.textContent);
        expect(labels).toEqual(['All', 'Needs Sync', 'Remote', 'Conflict', 'Synced']);
    });

    it('marks the current (filter, showSynced) chip as active', () => {
        // Needs Sync = ('all', false)
        renderFilterMenu(container, { filter: 'all', showSynced: false }, zeroCounts, callbacks);
        expect(container.querySelector('.scv-filter-option.is-active')?.getAttribute('data-filter')).toBe('needsSync');

        container = createContainer();
        // All = ('all', true)
        renderFilterMenu(container, { filter: 'all', showSynced: true }, zeroCounts, callbacks);
        expect(container.querySelector('.scv-filter-option.is-active')?.getAttribute('data-filter')).toBe('all');
    });

    it('shows the per-chip count (All = actionable + synced)', () => {
        renderFilterMenu(container, { filter: 'all', showSynced: false }, { ...zeroCounts, all: 5, synced: 2 }, callbacks);

        expect(container.querySelector('.scv-filter-option[data-filter="all"] .scv-filter-count')?.textContent).toBe('7');
        expect(container.querySelector('.scv-filter-option[data-filter="needsSync"] .scv-filter-count')?.textContent).toBe('5');
        expect(container.querySelector('.scv-filter-option[data-filter="synced"] .scv-filter-count')?.textContent).toBe('2');
    });

    it('calls onFilterChange with (filter, showSynced) for the clicked chip', () => {
        renderFilterMenu(container, { filter: 'all', showSynced: false }, zeroCounts, callbacks);

        (container.querySelector('.scv-filter-option[data-filter="synced"]') as HTMLButtonElement).click();

        expect(callbacks.onFilterChange).toHaveBeenCalledWith('synced', true);
    });

    it('renders a mobile dropdown (no chips) when isMobile is true', () => {
        renderFilterMenu(container, { filter: 'all', showSynced: false }, { ...zeroCounts, conflicts: 3 }, callbacks, { isMobile: true });

        expect(container.querySelector('.scv-filter-dropdown')).not.toBeNull();
        expect(container.querySelector('.scv-filter-option')).toBeNull();
        const options = Array.from(container.querySelectorAll('.scv-filter-dropdown option')).map(o => (o as HTMLOptionElement).value);
        expect(options).toEqual(['all', 'needsSync', 'remote', 'conflict', 'synced']);
    });
});