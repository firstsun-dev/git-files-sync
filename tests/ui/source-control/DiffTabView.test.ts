import { beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkspaceLeaf } from 'obsidian';
import { DiffTabView } from '../../../src/ui/source-control/DiffTabView';
import { setupObsidianDOM } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

function buildLeaf() {
    return { setViewState: vi.fn().mockResolvedValue(undefined) } as unknown as WorkspaceLeaf;
}

describe('DiffTabView', () => {
    it('shows an empty state until a diff is set', () => {
        const view = new DiffTabView(buildLeaf());
        void view.onOpen();

        const container = view.containerEl.children[1] as HTMLElement;
        expect(container.querySelector('.scv-diff-empty')).not.toBeNull();
    });

    it('renders the path and diff once set, defaulting to the split layout', () => {
        const view = new DiffTabView(buildLeaf());
        void view.onOpen();

        view.setDiff('notes/a.md', { remote: 'remote text', local: 'local text' });

        const container = view.containerEl.children[1] as HTMLElement;
        expect(container.querySelector('.scv-diff-tab-path')?.textContent).toBe('notes/a.md');
        expect(container.querySelector('.scv-diff-tab-body')?.classList.contains('scv-diff-layout-split')).toBe(true);
        expect(view.getPath()).toBe('notes/a.md');
    });

    it('switches to the unified layout when the toggle button is clicked, never showing both at once', () => {
        const view = new DiffTabView(buildLeaf());
        void view.onOpen();
        view.setDiff('a.md', { remote: 'remote text', local: 'local text' });

        const container = view.containerEl.children[1] as HTMLElement;
        (container.querySelector('.scv-diff-layout-toggle') as HTMLButtonElement).click();

        const body = container.querySelector('.scv-diff-tab-body');
        expect(body?.classList.contains('scv-diff-layout-unified')).toBe(true);
        expect(body?.classList.contains('scv-diff-layout-split')).toBe(false);
    });

    it('reuses the leaf for a second change instead of stacking tabs', () => {
        const view = new DiffTabView(buildLeaf());
        void view.onOpen();

        view.setDiff('a.md', { remote: 'r1', local: 'l1' });
        view.setDiff('b.md', { remote: 'r2', local: 'l2' });

        const container = view.containerEl.children[1] as HTMLElement;
        expect(view.getPath()).toBe('b.md');
        expect(container.querySelectorAll('.scv-diff-tab-path')).toHaveLength(1);
        expect(container.querySelector('.scv-diff-tab-path')?.textContent).toBe('b.md');
    });
});
