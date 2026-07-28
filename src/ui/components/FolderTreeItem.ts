import { setIcon } from 'obsidian';
import { ICONS } from './icons';
import type { StatusTreeFolder, StatusTreeNode } from './StatusTree';

export interface FolderTreeItemCallbacks {
    onSelect: (paths: string[], selected: boolean) => void;
    onToggle: (path: string) => void;
}

export function renderFolderItem(
    container: HTMLElement,
    folder: StatusTreeFolder,
    selectedPaths: ReadonlySet<string>,
    isExpanded: boolean,
    callbacks: FolderTreeItemCallbacks,
): HTMLElement | undefined {
    const paths = descendantFilePaths(folder);
    const selectedCount = paths.filter(path => selectedPaths.has(path)).length;
    const folderEl = container.createDiv({ cls: 'ssv-tree-folder' });
    const row = folderEl.createDiv({ cls: 'ssv-tree-folder-row' });
    renderDisclosureButton(row, folder, isExpanded, callbacks);
    renderFolderCheckbox(row, paths, selectedCount, callbacks);
    setIcon(row.createSpan({ cls: 'ssv-tree-folder-icon' }), ICONS.folder);
    row.createSpan({ cls: 'ssv-tree-folder-name', text: folder.name });

    return isExpanded ? folderEl.createDiv({ cls: 'ssv-tree-children' }) : undefined;
}

function renderDisclosureButton(
    row: HTMLElement,
    folder: StatusTreeFolder,
    isExpanded: boolean,
    callbacks: FolderTreeItemCallbacks,
): void {
    const button = row.createEl('button', {
        cls: 'ssv-folder-toggle',
        attr: { 'aria-expanded': String(isExpanded) },
    });
    setIcon(button.createSpan(), isExpanded ? ICONS.collapse : ICONS.expand);
    button.addEventListener('click', () => callbacks.onToggle(folder.path));
}

function renderFolderCheckbox(
    row: HTMLElement,
    paths: string[],
    selectedCount: number,
    callbacks: FolderTreeItemCallbacks,
): void {
    const checkbox = row.createEl('input', { type: 'checkbox', cls: 'ssv-folder-checkbox' });
    checkbox.checked = paths.length > 0 && selectedCount === paths.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < paths.length;
    checkbox.addEventListener('change', () => callbacks.onSelect(paths, checkbox.checked));
}

export function descendantFilePaths(folder: StatusTreeFolder): string[] {
    return folder.children.flatMap(descendantPaths);
}

function descendantPaths(node: StatusTreeNode): string[] {
    return node.kind === 'file' ? [node.status.path] : descendantFilePaths(node);
}
