import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { renderFilterMenu } from '../../../src/ui/source-control/FilterMenu';
import type { SourceControlFilter } from '../../../src/logic/source-control/SourceControlFilter';
import { setupObsidianDOM, createContainer } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

const zeroCounts: Record<SourceControlFilter, number> = {
    all: 0, changes: 0, 'ready-to-push': 0, 'remote-changes': 0, conflicts: 0, synced: 0,
};

describe('renderFilterMenu', () => {
    let container: HTMLElement;
    let callbacks: { onFilterChange: (f: SourceControlFilter) => void };

    beforeEach(() => {
        container = createContainer();
        callbacks = { onFilterChange: vi.fn() };
    });

    it('renders the four action chips (All/Local/Remote/Conflict) and never a synced chip', () => {
        renderFilterMenu(container, 'all', zeroCounts, callbacks);

        const filters = Array.from(container.querySelectorAll('.scv-filter-option')).map(el => el.getAttribute('data-filter'));
        expect(filters).toEqual(['all', 'changes', 'remote-changes', 'conflicts']);
        expect(container.querySelector('.scv-filter-option[data-filter="synced"]')).toBeNull();
    });

    it('labels the chips with the domain-relabeled display names (Local/Remote/Conflict)', () => {
        renderFilterMenu(container, 'all', zeroCounts, callbacks);

        const labels = Array.from(container.querySelectorAll('.scv-filter-option .scv-filter-label')).map(el => el.textContent);
        // Domain values stay as data-filter; only the visible labels change.
        expect(labels).toEqual(['All', 'Local', 'Remote', 'Conflict']);
    });

    it('does not render a Show synced toggle', () => {
        renderFilterMenu(container, 'all', zeroCounts, callbacks);

        expect(container.querySelector('.scv-filter-show-synced-checkbox')).toBeNull();
    });

    it('marks the current filter chip as active', () => {
        renderFilterMenu(container, 'conflicts', zeroCounts, callbacks);

        const active = container.querySelector('.scv-filter-option.is-active');
        expect(active?.getAttribute('data-filter')).toBe('conflicts');
    });

    it('shows the per-filter count from the ViewModel', () => {
        renderFilterMenu(container, 'all', { ...zeroCounts, conflicts: 3 }, callbacks);

        const conflictsOption = container.querySelector('.scv-filter-option[data-filter="conflicts"]');
        expect(conflictsOption?.querySelector('.scv-filter-count')?.textContent).toBe('3');
    });

    it('calls onFilterChange with the clicked filter value', () => {
        renderFilterMenu(container, 'all', zeroCounts, callbacks);

        (container.querySelector('.scv-filter-option[data-filter="remote-changes"]') as HTMLButtonElement).click();

        expect(callbacks.onFilterChange).toHaveBeenCalledWith('remote-changes');
    });

    it('renders a mobile dropdown (no chips) when isMobile is true', () => {
        renderFilterMenu(container, 'all', { ...zeroCounts, conflicts: 3 }, callbacks, { isMobile: true });

        expect(container.querySelector('.scv-filter-dropdown')).not.toBeNull();
        expect(container.querySelector('.scv-filter-option')).toBeNull();
        const options = Array.from(container.querySelectorAll('.scv-filter-dropdown option')).map(o => (o as HTMLOptionElement).value);
        expect(options).toEqual(['all', 'changes', 'remote-changes', 'conflicts']);
    });
});