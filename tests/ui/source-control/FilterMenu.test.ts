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
    let callbacks: { onFilterChange: (f: SourceControlFilter) => void; onToggleShowSynced: (s: boolean) => void };

    beforeEach(() => {
        container = createContainer();
        callbacks = { onFilterChange: vi.fn(), onToggleShowSynced: vi.fn() };
    });

    it('renders the five action chips (no synced chip) when showSynced is false', () => {
        renderFilterMenu(container, 'all', zeroCounts, false, callbacks);

        const filters = Array.from(container.querySelectorAll('.scv-filter-option')).map(el => el.getAttribute('data-filter'));
        expect(filters).toEqual(['all', 'changes', 'ready-to-push', 'remote-changes', 'conflicts']);
    });

    it('appends the synced chip when showSynced is true', () => {
        renderFilterMenu(container, 'all', { ...zeroCounts, synced: 7 }, true, callbacks);

        const filters = Array.from(container.querySelectorAll('.scv-filter-option')).map(el => el.getAttribute('data-filter'));
        expect(filters).toEqual(['all', 'changes', 'ready-to-push', 'remote-changes', 'conflicts', 'synced']);
        const syncedOption = container.querySelector('.scv-filter-option[data-filter="synced"]');
        expect(syncedOption?.querySelector('.scv-filter-count')?.textContent).toBe('7');
    });

    it('marks the current filter chip as active', () => {
        renderFilterMenu(container, 'conflicts', zeroCounts, false, callbacks);

        const active = container.querySelector('.scv-filter-option.is-active');
        expect(active?.getAttribute('data-filter')).toBe('conflicts');
    });

    it('shows the per-filter count from the ViewModel', () => {
        renderFilterMenu(container, 'all', { ...zeroCounts, conflicts: 3 }, false, callbacks);

        const conflictsOption = container.querySelector('.scv-filter-option[data-filter="conflicts"]');
        expect(conflictsOption?.querySelector('.scv-filter-count')?.textContent).toBe('3');
    });

    it('calls onFilterChange with the clicked filter value', () => {
        renderFilterMenu(container, 'all', zeroCounts, false, callbacks);

        (container.querySelector('.scv-filter-option[data-filter="remote-changes"]') as HTMLButtonElement).click();

        expect(callbacks.onFilterChange).toHaveBeenCalledWith('remote-changes');
    });

    it('renders the Show synced toggle reflecting the showSynced state', () => {
        renderFilterMenu(container, 'all', zeroCounts, false, callbacks);
        const checkbox = container.querySelector('.scv-filter-show-synced-checkbox') as HTMLInputElement;
        expect(checkbox).not.toBeNull();
        expect(checkbox.checked).toBe(false);
    });

    it('calls onToggleShowSynced when the Show synced checkbox changes', () => {
        renderFilterMenu(container, 'all', zeroCounts, false, callbacks);

        const checkbox = container.querySelector('.scv-filter-show-synced-checkbox') as HTMLInputElement;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(callbacks.onToggleShowSynced).toHaveBeenCalledWith(true);
    });
});