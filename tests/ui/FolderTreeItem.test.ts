import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderFolderItem, type FolderTreeItemCallbacks } from '../../src/ui/components/FolderTreeItem';
import type { StatusTreeFolder } from '../../src/ui/components/StatusTree';
import { createContainer, setupObsidianDOM } from './setup-dom';

const folder: StatusTreeFolder = {
    kind: 'folder',
    name: 'Projects',
    path: 'Projects',
    children: [
        { kind: 'file', name: 'one.md', status: { path: 'Projects/one.md', status: 'modified' } },
        { kind: 'file', name: 'two.md', status: { path: 'Projects/two.md', status: 'synced' } },
    ],
};

describe('renderFolderItem', () => {
    beforeAll(() => { setupObsidianDOM(); });

    let container: HTMLElement;
    let callbacks: FolderTreeItemCallbacks & {
        onSelect: ReturnType<typeof vi.fn<(paths: string[], selected: boolean) => void>>;
        onToggle: ReturnType<typeof vi.fn<(path: string) => void>>;
    };

    beforeEach(() => {
        container = createContainer();
        callbacks = { onSelect: vi.fn<(paths: string[], selected: boolean) => void>(), onToggle: vi.fn<(path: string) => void>() };
    });

    it('renders a folder checkbox as indeterminate for a partial selection', () => {
        renderFolderItem(container, folder, new Set(['Projects/one.md']), true, callbacks);

        const checkbox = container.querySelector<HTMLInputElement>('.ssv-folder-checkbox')!;
        expect(checkbox.checked).toBe(false);
        expect(checkbox.indeterminate).toBe(true);
    });

    it('selects every descendant file from its checkbox', () => {
        renderFolderItem(container, folder, new Set(), true, callbacks);

        const checkbox = container.querySelector<HTMLInputElement>('.ssv-folder-checkbox')!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(callbacks.onSelect).toHaveBeenCalledWith(['Projects/one.md', 'Projects/two.md'], true);
    });

    it('toggles its children from the disclosure button', () => {
        renderFolderItem(container, folder, new Set(), true, callbacks);

        (container.querySelector('.ssv-folder-toggle') as HTMLButtonElement).click();

        expect(callbacks.onToggle).toHaveBeenCalledWith('Projects');
    });

    it('uses a plain minus sign for an expanded folder', () => {
        renderFolderItem(container, folder, new Set(), true, callbacks);

        expect(container.querySelector('.ssv-folder-toggle')?.textContent).toBe('−');
        expect(container.querySelector('.ssv-folder-toggle svg')).toBeNull();
    });
});
