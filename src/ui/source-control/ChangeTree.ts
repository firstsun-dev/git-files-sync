import {
    ChangeTreeBuilder,
    type ChangeTreeFileNode,
    type ChangeTreeFolderNode,
    type ChangeTreeNode,
} from '../../logic/source-control/ChangeTreeBuilder';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeId } from '../../logic/source-control/types';
import { renderChangeItem, type ChangeItemCallbacks } from './ChangeItem';

export interface ChangeTreeCallbacks extends ChangeItemCallbacks {
    onToggleFolder: (path: string) => void;
}

const builder = new ChangeTreeBuilder();

/**
 * Renders `items` as a folder/file tree, reusing `ChangeTreeBuilder` (Phase 1)
 * for the grouping algorithm. `SourceControlItem` is a structural superset of
 * `SyncChange`, so the builder's output only carries `id`/`path`/`kind`; a
 * by-id lookup restores `isReadyToPush`/`operationStatus` at render time
 * instead of duplicating the tree-building logic.
 */
export function renderChangeTree(
    container: HTMLElement,
    items: readonly SourceControlItem[],
    collapsedFolders: ReadonlySet<string>,
    callbacks: ChangeTreeCallbacks,
): void {
    const byId = new Map<ChangeId, SourceControlItem>(items.map(item => [item.id, item]));
    const nodes = builder.build(items);
    renderNodes(container, nodes, byId, collapsedFolders, callbacks);
}

function renderNodes(
    container: HTMLElement,
    nodes: readonly ChangeTreeNode[],
    byId: ReadonlyMap<ChangeId, SourceControlItem>,
    collapsedFolders: ReadonlySet<string>,
    callbacks: ChangeTreeCallbacks,
): void {
    for (const node of nodes) {
        if (node.type === 'folder') renderFolder(container, node, byId, collapsedFolders, callbacks);
        else renderFile(container, node, byId, callbacks);
    }
}

function renderFolder(
    container: HTMLElement,
    folder: ChangeTreeFolderNode,
    byId: ReadonlyMap<ChangeId, SourceControlItem>,
    collapsedFolders: ReadonlySet<string>,
    callbacks: ChangeTreeCallbacks,
): void {
    const collapsed = collapsedFolders.has(folder.path);
    const folderEl = container.createDiv({ cls: 'scv-tree-folder' });
    const row = folderEl.createDiv({ cls: 'scv-tree-folder-row' });

    const toggle = row.createEl('button', { cls: 'scv-tree-folder-toggle' });
    toggle.setAttr('aria-expanded', String(!collapsed));
    toggle.setText(collapsed ? '▶' : '▼');
    toggle.addEventListener('click', () => callbacks.onToggleFolder(folder.path));

    row.createSpan({ cls: 'scv-tree-folder-name', text: folder.name });

    if (!collapsed) {
        const childrenEl = folderEl.createDiv({ cls: 'scv-tree-children' });
        renderNodes(childrenEl, folder.children, byId, collapsedFolders, callbacks);
    }
}

function renderFile(
    container: HTMLElement,
    file: ChangeTreeFileNode,
    byId: ReadonlyMap<ChangeId, SourceControlItem>,
    callbacks: ChangeTreeCallbacks,
): void {
    const item = byId.get(file.id);
    if (!item) return;
    renderChangeItem(container, item, file.name, callbacks);
}
