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
    let onChange: (filter: SourceControlFilter) => void;

    beforeEach(() => {
        container = createContainer();
        onChange = vi.fn();
    });

    it('renders all six filters in spec order', () => {
        renderFilterMenu(container, 'all', zeroCounts, onChange);

        const filters = Array.from(container.querySelectorAll('.scv-filter-option')).map(el => el.getAttribute('data-filter'));
        expect(filters).toEqual(['all', 'changes', 'ready-to-push', 'remote-changes', 'conflicts', 'synced']);
    });

    it('marks the current filter as active', () => {
        renderFilterMenu(container, 'conflicts', zeroCounts, onChange);

        const active = container.querySelector('.scv-filter-option.is-active');
        expect(active?.getAttribute('data-filter')).toBe('conflicts');
    });

    it('shows the per-filter count from the ViewModel', () => {
        renderFilterMenu(container, 'all', { ...zeroCounts, conflicts: 3 }, onChange);

        const conflictsOption = container.querySelector('.scv-filter-option[data-filter="conflicts"]');
        expect(conflictsOption?.querySelector('.scv-filter-count')?.textContent).toBe('3');
    });

    it('calls onChange with the clicked filter value (filter switching)', () => {
        renderFilterMenu(container, 'all', zeroCounts, onChange);

        (container.querySelector('.scv-filter-option[data-filter="remote-changes"]') as HTMLButtonElement).click();

        expect(onChange).toHaveBeenCalledWith('remote-changes');
    });

    it('does not call onChange for filters that were not clicked', () => {
        renderFilterMenu(container, 'all', zeroCounts, onChange);

        (container.querySelector('.scv-filter-option[data-filter="synced"]') as HTMLButtonElement).click();

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('synced');
    });
});
