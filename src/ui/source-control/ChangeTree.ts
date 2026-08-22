import {
    ChangeTreeBuilder,
    type ChangeTreeFileNode,
    type ChangeTreeFolderNode,
    type ChangeTreeNode,
    type TreeDisplayOptions,
} from '../../logic/source-control/ChangeTreeBuilder';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeId } from '../../logic/source-control/types';
import { t } from '../../i18n';
import { renderChangeItem, type ChangeItemCallbacks } from './ChangeItem';

export interface ChangeTreeCallbacks extends ChangeItemCallbacks {
    onToggleFolder: (path: string) => void;
    /** Selects/deselects every file under a folder (recursively) for push in one action. */
    onToggleFolderSelect: (ids: readonly ChangeId[], selected: boolean) => void;
}

const builder = new ChangeTreeBuilder();

/**
 * Renders `items` as a folder/file tree, reusing `ChangeTreeBuilder` (Phase 1)
 * for the grouping algorithm. `SourceControlItem` is a structural superset of
 * `SyncChange`, so the builder's output only carries `id`/`path`/`kind`; a
 * by-id lookup restores `isReadyToPush`/`operationStatus` at render time
 * instead of duplicating the tree-building logic.
 *
 * `options` controls presentation-only tree shaping (single-child folder
 * collapse, depth limit) so the Source Control tree stays a compact change
 * view rather than reproducing the full file Explorer.
 */
export function renderChangeTree(
    container: HTMLElement,
    items: readonly SourceControlItem[],
    collapsedFolders: ReadonlySet<string>,
    callbacks: ChangeTreeCallbacks,
    options: TreeDisplayOptions = {},
): void {
    const byId = new Map<ChangeId, SourceControlItem>(items.map(item => [item.id, item]));
    const nodes = builder.build(items, options);
    renderNodes(container, nodes, byId, collapsedFolders, callbacks, options);
}

function renderNodes(
    container: HTMLElement,
    nodes: readonly ChangeTreeNode[],
    byId: ReadonlyMap<ChangeId, SourceControlItem>,
    collapsedFolders: ReadonlySet<string>,
    callbacks: ChangeTreeCallbacks,
    options: TreeDisplayOptions,
): void {
    for (const node of nodes) {
        if (node.type === 'folder') renderFolder(container, node, byId, collapsedFolders, callbacks, options);
        else renderFile(container, node, byId, callbacks);
    }
}

function renderFolder(
    container: HTMLElement,
    folder: ChangeTreeFolderNode,
    byId: ReadonlyMap<ChangeId, SourceControlItem>,
    collapsedFolders: ReadonlySet<string>,
    callbacks: ChangeTreeCallbacks,
    options: TreeDisplayOptions,
): void {
    const collapsed = collapsedFolders.has(folder.path);
    const folderEl = container.createDiv({ cls: 'scv-tree-folder' });
    const row = folderEl.createDiv({ cls: 'scv-tree-folder-row' });

    const fileIds = collectFileIds(folder);
    const selectedCount = fileIds.filter(id => byId.get(id)?.isReadyToPush).length;
    const checkbox = row.createEl('input', { type: 'checkbox', cls: 'scv-tree-folder-select' });
    checkbox.setAttr('title', t('sourceControl.folder.selectAll'));
    checkbox.checked = fileIds.length > 0 && selectedCount === fileIds.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < fileIds.length;
    checkbox.addEventListener('click', (evt) => evt.stopPropagation());
    checkbox.addEventListener('change', () => callbacks.onToggleFolderSelect(fileIds, checkbox.checked));

    const toggle = row.createEl('button', { cls: 'scv-tree-folder-toggle' });
    toggle.setAttr('aria-expanded', String(!collapsed));
    toggle.setText(collapsed ? '▶' : '▼');
    toggle.addEventListener('click', () => callbacks.onToggleFolder(folder.path));

    row.createSpan({ cls: 'scv-tree-folder-name', text: folder.name });

    if (!collapsed) {
        const childrenEl = folderEl.createDiv({ cls: 'scv-tree-children' });
        renderNodes(childrenEl, folder.children, byId, collapsedFolders, callbacks, options);
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

/** Recursively collects the ids of every file under a folder node, for the folder's "select all" checkbox. */
function collectFileIds(folder: ChangeTreeFolderNode): ChangeId[] {
    const ids: ChangeId[] = [];
    for (const child of folder.children) {
        if (child.type === 'file') ids.push(child.id);
        else ids.push(...collectFileIds(child));
    }
    return ids;
}
