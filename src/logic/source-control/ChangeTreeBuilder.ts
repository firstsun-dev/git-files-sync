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
 * Presentation-only controls for tree rendering, so the Source Control tree
 * stays a compact change view rather than reproducing the full file Explorer.
 *
 * - `maxDepth`: the maximum number of folder nesting levels rendered as
 *   separate, collapsible nodes. Deeper folders are folded into a single
 *   flattened path segment (e.g. `02_Areas/blog/_pixnet/zh-tw/tech`) instead of
 *   five nested expandable rows. Files always render at their real depth; only
 *   intermediate folders are flattened. Defaults to unlimited depth (legacy
 *   behavior) when omitted.
 * - `collapseSingleChild`: when true, a folder that contains exactly one
 *   child folder (no files) is merged with that child into one combined folder
 *   node, reducing pointless single-step nesting like `tech › tech › tech`.
 *   Defaults to false to preserve the existing rendering when omitted.
 */
export interface TreeDisplayOptions {
    maxDepth?: number;
    collapseSingleChild?: boolean;
}

const DEFAULT_OPTIONS: Required<Pick<TreeDisplayOptions, 'maxDepth' | 'collapseSingleChild'>> = {
    maxDepth: Number.POSITIVE_INFINITY,
    collapseSingleChild: false,
};

/**
 * Turns a flat `SyncChange[]` into a folder/file tree for rendering.
 * A renamed/moved file is placed at its *current* path — `previousPath`
 * travels with the file node purely for display (e.g. "old → new"), it does
 * not create a second tree entry.
 */
export class ChangeTreeBuilder {
    build(changes: readonly SyncChange[], options: TreeDisplayOptions = {}): ChangeTreeNode[] {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const root: ChangeTreeFolderNode = { type: 'folder', name: '', path: '', children: [] };
        for (const change of changes) {
            this.insert(root, change);
        }
        const nodes = this.collapseAndLimit(root.children, opts, 0);
        return nodes;
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

    /**
     * Applies `collapseSingleChild` and `maxDepth` to a depth's children.
     *
     * `collapseSingleChild` merges a folder whose only child is a single folder
     * (no file siblings) into one combined node, joining names/paths with `/`.
     * The merge repeats along a run of single-child folders so
     * `a/b/c/d.md` collapses to `a/b/c` (one node) when every level has only one
     * child folder. Files break the run, so `a/x.md` + `a/b/c/y.md` keeps `a`
     * separate from the collapsed `b/c`.
     *
     * `maxDepth` flattens any folder nesting deeper than the limit into a
     * single path-labelled node whose children are the files/subfolders at that
     * point (no further nesting is rendered).
     */
    private collapseAndLimit(
        nodes: ChangeTreeNode[],
        opts: Required<Pick<TreeDisplayOptions, 'maxDepth' | 'collapseSingleChild'>>,
        depth: number,
    ): ChangeTreeNode[] {
        const result: ChangeTreeNode[] = [];
        for (const node of nodes) {
            if (node.type === 'file') {
                result.push(node);
                continue;
            }

            const collapsed = this.collapseSingleChildRun(node, opts);
            const atDepthLimit = depth >= opts.maxDepth;

            if (atDepthLimit) {
                // Flatten deeper structure into one folder node holding all descendants' files.
                result.push(this.flattenFolder(collapsed));
                continue;
            }

            collapsed.children = this.collapseAndLimit(collapsed.children, opts, depth + 1);
            result.push(collapsed);
        }
        return result;
    }

    private collapseSingleChildRun(
        folder: ChangeTreeFolderNode,
        opts: Required<Pick<TreeDisplayOptions, 'maxDepth' | 'collapseSingleChild'>>,
    ): ChangeTreeFolderNode {
        if (!opts.collapseSingleChild) return folder;

        let current = folder;
        // Walk down while the current folder has exactly one child and it is a folder.
        let onlyChild = current.children[0];
        while (current.children.length === 1 && onlyChild && onlyChild.type === 'folder') {
            current = this.mergeFolders(current, onlyChild);
            onlyChild = current.children[0];
        }
        return current;
    }

    private mergeFolders(parent: ChangeTreeFolderNode, child: ChangeTreeFolderNode): ChangeTreeFolderNode {
        return {
            type: 'folder',
            name: `${parent.name}/${child.name}`,
            path: child.path,
            children: child.children,
        };
    }

    private flattenFolder(folder: ChangeTreeFolderNode): ChangeTreeFolderNode {
        const files = this.collectFiles(folder);
        return {
            type: 'folder',
            name: folder.name,
            path: folder.path,
            children: files,
        };
    }

    private collectFiles(folder: ChangeTreeFolderNode): ChangeTreeNode[] {
        const files: ChangeTreeNode[] = [];
        for (const child of folder.children) {
            if (child.type === 'file') {
                files.push(child);
            } else {
                files.push(...this.collectFiles(child));
            }
        }
        return files;
    }
}