import type { FileStatus } from '../types';

export type StatusTreeNode = StatusTreeFolder | StatusTreeFile;

export interface StatusTreeFolder {
    kind: 'folder';
    name: string;
    path: string;
    children: StatusTreeNode[];
}

export interface StatusTreeFile {
    kind: 'file';
    name: string;
    status: FileStatus;
}

type MutableFolder = StatusTreeFolder & { folders: Map<string, MutableFolder> };

/** Builds a presentation-only tree; sync state remains keyed by file path. */
export function buildStatusTree(statuses: FileStatus[]): StatusTreeFolder {
    const root = createFolder('', '');
    for (const status of statuses) addStatus(root, status);
    finalizeFolder(root);
    return root;
}

function createFolder(name: string, path: string): MutableFolder {
    return { kind: 'folder', name, path, children: [], folders: new Map() };
}

function addStatus(root: MutableFolder, status: FileStatus): void {
    const segments = status.path.split('/');
    const fileName = segments.pop();
    if (!fileName) return;

    let folder = root;
    for (const segment of segments) folder = getOrCreateFolder(folder, segment);
    folder.children.push({ kind: 'file', name: fileName, status });
}

function getOrCreateFolder(parent: MutableFolder, name: string): MutableFolder {
    const existing = parent.folders.get(name);
    if (existing) return existing;

    const path = parent.path === '' ? name : `${parent.path}/${name}`;
    const folder = createFolder(name, path);
    parent.folders.set(name, folder);
    parent.children.push(folder);
    return folder;
}

function finalizeFolder(folder: MutableFolder): void {
    for (const child of folder.children) if (child.kind === 'folder') finalizeFolder(child as MutableFolder);
    folder.children.sort(compareTreeNodes);
    delete (folder as Partial<MutableFolder>).folders;
}

function compareTreeNodes(left: StatusTreeNode, right: StatusTreeNode): number {
    const attention = Number(hasAttention(right)) - Number(hasAttention(left));
    if (attention !== 0) return attention;
    return left.name.localeCompare(right.name);
}

function hasAttention(node: StatusTreeNode): boolean {
    return node.kind === 'file'
        ? node.status.status !== 'synced'
        : node.children.some(hasAttention);
}
