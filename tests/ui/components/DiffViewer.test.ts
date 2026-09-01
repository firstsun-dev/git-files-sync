import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Platform } from 'obsidian';
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

    describe('content-less initial render (async load in flight)', () => {
        it('renders no diff panel when remote/local are omitted', () => {
            const container = createContainer();

            renderDiffViewer(container, { layout: 'split' });

            expect(container.querySelector('.ssv-diff-split')).toBeNull();
            expect(container.querySelector('.ssv-diff-unified')).toBeNull();
        });

        it('fills in the diff panel exactly once via the handle, replacing any prior content', () => {
            const container = createContainer();

            const viewer = renderDiffViewer(container, { layout: 'split' });
            viewer.setContent('remote text', 'local text');
            viewer.setContent('remote text 2', 'local text 2');

            expect(container.querySelectorAll('.ssv-diff-split')).toHaveLength(1);
            expect(container.querySelectorAll('.ssv-diff-unified')).toHaveLength(1);
            expect(container.textContent).toContain('remote text 2');
            expect(container.textContent).not.toContain('remote text\n');
        });
    });

    describe('phone layout policy', () => {
        afterEach(() => { Platform.isPhone = false; });

        it('forces unified and ignores the requested split layout', () => {
            Platform.isPhone = true;
            const container = createContainer();

            renderDiffViewer(container, { remote: 'r', local: 'l', layout: 'split' });

            const body = container.querySelector('.scv-diff-tab-body');
            expect(body?.classList.contains('scv-diff-layout-unified')).toBe(true);
            expect(body?.classList.contains('scv-diff-layout-split')).toBe(false);
        });

        it('renders no layout toggle even when a toggleHost is given', () => {
            Platform.isPhone = true;
            const container = createContainer();
            const toggleHost = createContainer();

            renderDiffViewer(container, { remote: 'r', local: 'l', layout: 'split', toggleHost });

            expect(toggleHost.querySelector('.scv-diff-layout-toggle')).toBeNull();
        });
    });
});