import type { ChangeId, SyncChange, SyncChangeKind } from './types';

export interface ChangeTreeFileNode {
    type: 'file';
    id: ChangeId;
    name: string;
    path: string;
    previousPath?: string;
    kind: SyncChangeKind;
}

export interface ChangeTreeFolderNode {
    type: 'folder';
    name: string;
    path: string;
    children: ChangeTreeNode[];
}

export type ChangeTreeNode = ChangeTreeFileNode | ChangeTreeFolderNode;

/**
 * Turns a flat `SyncChange[]` into a folder/file tree for rendering.
 * A renamed/moved file is placed at its *current* path — `previousPath`
 * travels with the file node purely for display (e.g. "old → new"), it does
 * not create a second tree entry.
 */
export class ChangeTreeBuilder {
    build(changes: readonly SyncChange[]): ChangeTreeNode[] {
        const root: ChangeTreeFolderNode = { type: 'folder', name: '', path: '', children: [] };
        for (const change of changes) {
            this.insert(root, change);
        }
        return root.children;
    }

    private insert(root: ChangeTreeFolderNode, change: SyncChange): void {
        const segments = change.path.split('/').filter(Boolean);
        const fileName = segments.pop();
        if (!fileName) return;

        let folder = root;
        let accumulatedPath = '';
        for (const segment of segments) {
            accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
            folder = this.getOrCreateFolder(folder, segment, accumulatedPath);
        }

        folder.children.push({
            type: 'file',
            id: change.id,
            name: fileName,
            path: change.path,
            previousPath: change.previousPath,
            kind: change.kind,
        });
    }

    private getOrCreateFolder(parent: ChangeTreeFolderNode, name: string, path: string): ChangeTreeFolderNode {
        const existing = parent.children.find(
            (node): node is ChangeTreeFolderNode => node.type === 'folder' && node.name === name,
        );
        if (existing) return existing;

        const created: ChangeTreeFolderNode = { type: 'folder', name, path, children: [] };
        parent.children.push(created);
        return created;
    }
}
