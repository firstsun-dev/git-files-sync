import { beforeAll, describe, expect, it } from 'vitest';
import { renderDiffViewer } from '../../../src/ui/components/DiffViewer';
import { setupObsidianDOM, createContainer } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

describe('renderDiffViewer', () => {
    it('renders the diff panel with the requested layout class', () => {
        const container = createContainer();

        renderDiffViewer(container, { remote: 'remote text', local: 'local text', layout: 'split' });

        const body = container.querySelector('.scv-diff-tab-body');
        expect(body?.classList.contains('scv-diff-layout-split')).toBe(true);
        expect(container.querySelector('.ssv-diff-split')).not.toBeNull();
        expect(container.querySelector('.ssv-diff-unified')).not.toBeNull();
    });

    it('renders no toggle without a toggleHost', () => {
        const container = createContainer();

        renderDiffViewer(container, { remote: 'r', local: 'l', layout: 'unified' });

        expect(container.querySelector('.scv-diff-layout-toggle')).toBeNull();
    });

    it('re-renders the toggle and swaps the layout class in place when toggled', () => {
        const container = createContainer();
        const toggleHost = createContainer();
        container.addClass('viewer-root');
        const layouts: string[] = [];

        renderDiffViewer(container, {
            remote: 'r',
            local: 'l',
            layout: 'unified',
            toggleHost,
            onLayoutChange: next => layouts.push(next),
        });

        (toggleHost.querySelector('.scv-diff-layout-toggle') as HTMLButtonElement).click();

        const body = container.querySelector('.scv-diff-tab-body');
        expect(layouts).toEqual(['split']);
        expect(body?.classList.contains('scv-diff-layout-split')).toBe(true);
        expect(body?.classList.contains('scv-diff-layout-unified')).toBe(false);
        // Toggle still present for switching back — rendered in place, no rebuild of the diff body.
        expect(toggleHost.querySelector('.scv-diff-layout-toggle')).not.toBeNull();
        expect(container.querySelectorAll('.scv-diff-tab-body')).toHaveLength(1);

        (toggleHost.querySelector('.scv-diff-layout-toggle') as HTMLButtonElement).click();
        expect(layouts).toEqual(['split', 'unified']);
        expect(body?.classList.contains('scv-diff-layout-unified')).toBe(true);
    });
});