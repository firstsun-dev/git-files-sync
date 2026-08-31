import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderDiffLayoutToggle } from '../../../src/ui/components/DiffLayoutToggle';
import { setupObsidianDOM, createContainer } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

describe('renderDiffLayoutToggle', () => {
    it('always shows a visible text label, not just an icon', () => {
        const container = createContainer();
        renderDiffLayoutToggle(container, 'unified', vi.fn());

        const label = container.querySelector('.scv-diff-layout-toggle-label');
        expect(label?.textContent).toBeTruthy();
    });

    it('labels itself with the layout it will switch to, not the current one', () => {
        const container = createContainer();
        renderDiffLayoutToggle(container, 'unified', vi.fn());
        expect(container.querySelector('.scv-diff-layout-toggle-label')?.textContent).toBe('Split');

        const container2 = createContainer();
        renderDiffLayoutToggle(container2, 'split', vi.fn());
        expect(container2.querySelector('.scv-diff-layout-toggle-label')?.textContent).toBe('Unified');
    });

    it('calls onToggle with the target layout when clicked', () => {
        const container = createContainer();
        const onToggle = vi.fn();
        renderDiffLayoutToggle(container, 'unified', onToggle);

        (container.querySelector('.scv-diff-layout-toggle') as HTMLButtonElement).click();

        expect(onToggle).toHaveBeenCalledWith('split');
    });
});
