import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { renderChangeTree, type ChangeTreeCallbacks } from '../../../src/ui/source-control/ChangeTree';
import type { SourceControlItem } from '../../../src/logic/source-control/SourceControlViewModel';
import { toChangeId } from '../../../src/logic/source-control/types';
import { setupObsidianDOM, createContainer } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

function item(overrides: Partial<SourceControlItem> & Pick<SourceControlItem, 'id' | 'path' | 'kind'>): SourceControlItem {
    return { isReadyToPush: false, operationStatus: 'idle', ...overrides };
}

describe('renderChangeTree', () => {
    let container: HTMLElement;
    let callbacks: ChangeTreeCallbacks;

    beforeEach(() => {
        container = createContainer();
        callbacks = {
            onToggleFolder: vi.fn(),
            onToggleFolderSelect: vi.fn(),
            onToggleSelect: vi.fn(),
            onOpenDiff: vi.fn(),
        };
    });

    it('groups changes into nested folders', () => {
        const items = [
            item({ id: toChangeId('c-1'), path: 'notes/daily.md', kind: 'local-modified' }),
            item({ id: toChangeId('c-2'), path: 'notes/idea.md', kind: 'local-only' }),
            item({ id: toChangeId('c-3'), path: 'projects/settings.md', kind: 'conflict' }),
        ];
        renderChangeTree(container, items, new Set(), callbacks);

        const folders = container.querySelectorAll('.scv-tree-folder-name');
        expect(Array.from(folders).map(f => f.textContent)).toEqual(['notes', 'projects']);
        expect(container.querySelectorAll('.scv-change-item')).toHaveLength(3);
    });

    it('renders the kind badge letter matching the spec example (M / A / !)', () => {
        const items = [
            item({ id: toChangeId('c-1'), path: 'daily.md', kind: 'local-modified' }),
            item({ id: toChangeId('c-2'), path: 'idea.md', kind: 'local-only' }),
            item({ id: toChangeId('c-3'), path: 'settings.md', kind: 'conflict' }),
        ];
        renderChangeTree(container, items, new Set(), callbacks);

        const badges = Array.from(container.querySelectorAll('.scv-badge')).map(b => b.textContent);
        expect(badges).toEqual(['M', 'A', '!']);
    });

    it('shows the previous path for a rename, keyed by the stable ChangeId', () => {
        const items = [
            item({ id: toChangeId('c-1'), path: 'new-name.md', previousPath: 'old-name.md', kind: 'moved' }),
        ];
        renderChangeTree(container, items, new Set(), callbacks);

        const row = container.querySelector('.scv-change-item') as HTMLElement;
        expect(row.getAttribute('data-change-id')).toBe('c-1');
        expect(row.querySelector('.scv-change-rename-from')?.textContent).toBe('old-name.md');
        expect(row.querySelector('.scv-change-name-text')?.textContent).toBe('new-name.md');
    });

    it('reflects isReadyToPush on the selection checkbox', () => {
        const items = [item({ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only', isReadyToPush: true })];
        renderChangeTree(container, items, new Set(), callbacks);

        const checkbox = container.querySelector('.scv-change-select') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
    });

    it('calls onToggleSelect with the ChangeId when the checkbox changes', () => {
        const items = [item({ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' })];
        renderChangeTree(container, items, new Set(), callbacks);

        const checkbox = container.querySelector('.scv-change-select') as HTMLInputElement;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(callbacks.onToggleSelect).toHaveBeenCalledWith(toChangeId('c-1'), true);
    });

    it('calls onOpenDiff when the row (not the checkbox) is clicked', () => {
        const changeItem = item({ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' });
        renderChangeTree(container, [changeItem], new Set(), callbacks);

        (container.querySelector('.scv-change-item') as HTMLElement).click();

        expect(callbacks.onOpenDiff).toHaveBeenCalledWith(changeItem);
    });

    it('does not call onOpenDiff when the checkbox itself is clicked', () => {
        const items = [item({ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' })];
        renderChangeTree(container, items, new Set(), callbacks);

        (container.querySelector('.scv-change-select') as HTMLElement).click();

        expect(callbacks.onOpenDiff).not.toHaveBeenCalled();
    });

    it('shows an operation indicator only when the operation is not idle', () => {
        const items = [
            item({ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only', operationStatus: 'running' }),
            item({ id: toChangeId('c-2'), path: 'b.md', kind: 'local-only', operationStatus: 'idle' }),
        ];
        renderChangeTree(container, items, new Set(), callbacks);

        const indicators = container.querySelectorAll('.scv-op-indicator');
        expect(indicators).toHaveLength(1);
        expect(indicators[0]?.classList.contains('scv-op-running')).toBe(true);
    });

    it('collapses a folder\'s children when its path is in collapsedFolders', () => {
        const items = [item({ id: toChangeId('c-1'), path: 'notes/daily.md', kind: 'local-modified' })];
        renderChangeTree(container, items, new Set(['notes']), callbacks);

        expect(container.querySelector('.scv-tree-children')).toBeNull();
        expect(container.querySelector('.scv-change-item')).toBeNull();
    });

    it('calls onToggleFolder with the folder path when the disclosure button is clicked', () => {
        const items = [item({ id: toChangeId('c-1'), path: 'notes/daily.md', kind: 'local-modified' })];
        renderChangeTree(container, items, new Set(), callbacks);

        (container.querySelector('.scv-tree-folder-toggle') as HTMLButtonElement).click();

        expect(callbacks.onToggleFolder).toHaveBeenCalledWith('notes');
    });

    describe('folder select-all checkbox', () => {
        it('is unchecked, not indeterminate, when no file in the folder is ready to push', () => {
            const items = [
                item({ id: toChangeId('c-1'), path: 'notes/daily.md', kind: 'local-modified' }),
                item({ id: toChangeId('c-2'), path: 'notes/idea.md', kind: 'local-only' }),
            ];
            renderChangeTree(container, items, new Set(), callbacks);

            const checkbox = container.querySelector('.scv-tree-folder-select') as HTMLInputElement;
            expect(checkbox.checked).toBe(false);
            expect(checkbox.indeterminate).toBe(false);
        });

        it('is indeterminate when only some files in the folder are ready to push', () => {
            const items = [
                item({ id: toChangeId('c-1'), path: 'notes/daily.md', kind: 'local-modified', isReadyToPush: true }),
                item({ id: toChangeId('c-2'), path: 'notes/idea.md', kind: 'local-only', isReadyToPush: false }),
            ];
            renderChangeTree(container, items, new Set(), callbacks);

            const checkbox = container.querySelector('.scv-tree-folder-select') as HTMLInputElement;
            expect(checkbox.checked).toBe(false);
            expect(checkbox.indeterminate).toBe(true);
        });

        it('is checked when every file in the folder (including nested subfolders) is ready to push', () => {
            const items = [
                item({ id: toChangeId('c-1'), path: 'notes/daily.md', kind: 'local-modified', isReadyToPush: true }),
                item({ id: toChangeId('c-2'), path: 'notes/sub/idea.md', kind: 'local-only', isReadyToPush: true }),
            ];
            renderChangeTree(container, items, new Set(), callbacks);

            const checkbox = container.querySelector('.scv-tree-folder-select') as HTMLInputElement;
            expect(checkbox.checked).toBe(true);
            expect(checkbox.indeterminate).toBe(false);
        });

        it('calls onToggleFolderSelect with every descendant ChangeId when checked', () => {
            const items = [
                item({ id: toChangeId('c-1'), path: 'notes/daily.md', kind: 'local-modified' }),
                item({ id: toChangeId('c-2'), path: 'notes/sub/idea.md', kind: 'local-only' }),
            ];
            renderChangeTree(container, items, new Set(), callbacks);

            const checkbox = container.querySelector('.scv-tree-folder-select') as HTMLInputElement;
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));

            expect(callbacks.onToggleFolderSelect).toHaveBeenCalledWith(
                [toChangeId('c-1'), toChangeId('c-2')],
                true,
            );
        });

        it('does not open a diff or toggle the folder disclosure when the checkbox is clicked', () => {
            const items = [item({ id: toChangeId('c-1'), path: 'notes/daily.md', kind: 'local-modified' })];
            renderChangeTree(container, items, new Set(), callbacks);

            (container.querySelector('.scv-tree-folder-select') as HTMLElement).click();

            expect(callbacks.onToggleFolder).not.toHaveBeenCalled();
        });
    });
});
