import { describe, it, expect, vi, beforeAll } from 'vitest';
import { SyncStatusView } from '../../src/ui/SyncStatusView';
import { WorkspaceLeaf, Notice } from 'obsidian';
import type GitLabFilesPush from '../../src/main';
import { setupObsidianDOM } from './setup-dom';
import type { FileStatus } from '../../src/ui/types';
import type { GitTreeEntry } from '../../src/services/git-service-interface';

// The diff pane is a separate view; none of these fixtures open one, so the
// stale-pane cleanup just finds nothing.
function noDiffPanes(): { getLeavesOfType: () => unknown[] } {
    return { getLeavesOfType: (): unknown[] => [] };
}

// Minimal fake plugin: only the surface these tests actually exercise.
function makePlugin(overrides: {
    vaultFolder?: string;
    deleteFile?: ReturnType<typeof vi.fn>;
    deleteBatch?: ReturnType<typeof vi.fn>;
    adapterExists?: ReturnType<typeof vi.fn>;
    adapterStat?: ReturnType<typeof vi.fn>;
    getAbstractFileByPath?: ReturnType<typeof vi.fn>;
} = {}): { plugin: GitLabFilesPush; leaf: WorkspaceLeaf; deleteFile: ReturnType<typeof vi.fn> } {
    const vaultFolder = overrides.vaultFolder ?? '';
    const deleteFile = overrides.deleteFile ?? vi.fn().mockResolvedValue(undefined);

    const app = {
        workspace: noDiffPanes(),
        vault: {
            adapter: {
                exists: overrides.adapterExists ?? vi.fn().mockResolvedValue(false),
                stat: overrides.adapterStat ?? vi.fn().mockResolvedValue(null),
            },
            getAbstractFileByPath: overrides.getAbstractFileByPath ?? vi.fn().mockReturnValue(null),
        },
    };

    const plugin = {
        settings: { branch: 'main', vaultFolder },
        gitService: { deleteFile, deleteBatch: overrides.deleteBatch },
        getNormalizedPath(path: string): string {
            if (!vaultFolder) return path;
            const prefix = `${vaultFolder}/`;
            if (path.startsWith(prefix)) return path.substring(prefix.length);
            if (path === vaultFolder) return '';
            return path;
        },
    } as unknown as GitLabFilesPush;

    const leaf = { app } as unknown as WorkspaceLeaf;
    return { plugin, leaf, deleteFile };
}

describe('SyncStatusView remote deletion', () => {
    beforeAll(() => { setupObsidianDOM(); });

    // Regression test for the bug where deleteFile() received the vault-relative
    // path (carrying the vaultFolder prefix) instead of the repo-relative path,
    // causing a spurious "file was not found on branch main" for files the UI
    // itself listed as remote-only.
    it('strips the vaultFolder prefix before calling gitService.deleteFile', async () => {
        const { plugin, leaf, deleteFile } = makePlugin({ vaultFolder: '02_Areas/blog' });
        const view = new SyncStatusView(leaf, plugin);

        const fileStatus: FileStatus = { path: '02_Areas/blog/notes/todo.md', status: 'remote-only' };
        const errors: { path: string, message: string }[] = [];
        const prog = new Notice('', 0);

        // performRemoteDeletion is private; called directly to isolate it from
        // the confirmation dialog and higher-level orchestration in deleteSelected().
        await (view as unknown as {
            performRemoteDeletion(remote: FileStatus[], total: number, localCount: number, prog: Notice, errors: { path: string, message: string }[]): Promise<void>
        }).performRemoteDeletion([fileStatus], 1, 0, prog, errors);

        expect(deleteFile).toHaveBeenCalledWith('notes/todo.md', 'main', expect.any(String));
        expect(errors).toHaveLength(0);
    });

    it('passes the path unchanged when no vaultFolder is configured', async () => {
        const { plugin, leaf, deleteFile } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);

        const fileStatus: FileStatus = { path: 'notes/todo.md', status: 'remote-only' };
        const errors: { path: string, message: string }[] = [];
        const prog = new Notice('', 0);

        await (view as unknown as {
            performRemoteDeletion(remote: FileStatus[], total: number, localCount: number, prog: Notice, errors: { path: string, message: string }[]): Promise<void>
        }).performRemoteDeletion([fileStatus], 1, 0, prog, errors);

        expect(deleteFile).toHaveBeenCalledWith('notes/todo.md', 'main', expect.any(String));
    });

    it('records the real error message instead of swallowing it', async () => {
        const deleteFile = vi.fn().mockRejectedValue(new Error('Cannot delete "notes/todo.md": file was not found on branch "main".'));
        const { plugin, leaf } = makePlugin({ deleteFile });
        const view = new SyncStatusView(leaf, plugin);

        const fileStatus: FileStatus = { path: 'notes/todo.md', status: 'remote-only' };
        const errors: { path: string, message: string }[] = [];
        const prog = new Notice('', 0);

        await (view as unknown as {
            performRemoteDeletion(remote: FileStatus[], total: number, localCount: number, prog: Notice, errors: { path: string, message: string }[]): Promise<void>
        }).performRemoteDeletion([fileStatus], 1, 0, prog, errors);

        expect(errors).toEqual([{ path: 'notes/todo.md', message: 'Cannot delete "notes/todo.md": file was not found on branch "main".' }]);
    });

    it('groups all remote-only deletes into one gitService.deleteBatch call when the provider supports it', async () => {
        const deleteBatch = vi.fn().mockResolvedValue(undefined);
        const { plugin, leaf, deleteFile } = makePlugin({ deleteBatch });
        const view = new SyncStatusView(leaf, plugin);

        const targets: FileStatus[] = [
            { path: 'a.md', status: 'remote-only' },
            { path: 'b.md', status: 'remote-only' },
        ];
        const errors: { path: string, message: string }[] = [];
        const prog = new Notice('', 0);

        await (view as unknown as {
            performRemoteDeletion(remote: FileStatus[], total: number, localCount: number, prog: Notice, errors: { path: string, message: string }[]): Promise<void>
        }).performRemoteDeletion(targets, 2, 0, prog, errors);

        expect(deleteBatch).toHaveBeenCalledTimes(1);
        expect(deleteBatch).toHaveBeenCalledWith(['a.md', 'b.md'], 'main', expect.any(String));
        expect(deleteFile).not.toHaveBeenCalled();
        expect(errors).toHaveLength(0);
    });

    it('marks every path in a failed deleteBatch chunk as failed, not dropped', async () => {
        const deleteBatch = vi.fn().mockRejectedValue(new Error('commit failed'));
        const { plugin, leaf } = makePlugin({ deleteBatch });
        const view = new SyncStatusView(leaf, plugin);

        const targets: FileStatus[] = [
            { path: 'a.md', status: 'remote-only' },
            { path: 'b.md', status: 'remote-only' },
        ];
        const errors: { path: string, message: string }[] = [];
        const prog = new Notice('', 0);

        await (view as unknown as {
            performRemoteDeletion(remote: FileStatus[], total: number, localCount: number, prog: Notice, errors: { path: string, message: string }[]): Promise<void>
        }).performRemoteDeletion(targets, 2, 0, prog, errors);

        expect(errors).toEqual([
            { path: 'a.md', message: 'commit failed' },
            { path: 'b.md', message: 'commit failed' },
        ]);
    });

    it('falls back to the sequential deleteFile loop when the provider has no deleteBatch', async () => {
        const { plugin, leaf, deleteFile } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);

        const targets: FileStatus[] = [
            { path: 'a.md', status: 'remote-only' },
            { path: 'b.md', status: 'remote-only' },
        ];
        const errors: { path: string, message: string }[] = [];
        const prog = new Notice('', 0);

        await (view as unknown as {
            performRemoteDeletion(remote: FileStatus[], total: number, localCount: number, prog: Notice, errors: { path: string, message: string }[]): Promise<void>
        }).performRemoteDeletion(targets, 2, 0, prog, errors);

        expect(deleteFile).toHaveBeenCalledTimes(2);
        expect(deleteFile).toHaveBeenCalledWith('a.md', 'main', expect.any(String));
        expect(deleteFile).toHaveBeenCalledWith('b.md', 'main', expect.any(String));
        expect(errors).toHaveLength(0);
    });
});

describe('SyncStatusView.identifyExtraFiles folder/remote-record collisions', () => {
    beforeAll(() => { setupObsidianDOM(); });

    // Regression test: a local real directory (or a symlink to one) can share a
    // path with a stale remote record (e.g. a folder that used to be a pushed
    // symlink). Treating it as a readable file crashes adapter.read() with EISDIR;
    // it should be classified remote-only instead.
    it('treats a path that exists locally as a folder as remote-only, not a readable file', async () => {
        const adapterStat = vi.fn().mockResolvedValue({ type: 'folder' });
        const adapterExists = vi.fn().mockResolvedValue(true);
        const { plugin, leaf } = makePlugin({ adapterStat, adapterExists });
        const view = new SyncStatusView(leaf, plugin);

        const remoteMap = new Map<string, GitTreeEntry>([
            ['.claude/skills/polish-blog', { path: '.claude/skills/polish-blog', symlink: false }],
        ]);

        const extra = await (view as unknown as {
            identifyExtraFiles(remoteMap: Map<string, GitTreeEntry>, localFilePaths: Set<string>, allLocalFileMap: Map<string, unknown>): Promise<unknown[]>
        }).identifyExtraFiles(remoteMap, new Set(), new Map());

        expect(extra).toEqual([]);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        expect(statuses.get('.claude/skills/polish-blog')).toEqual({ path: '.claude/skills/polish-blog', status: 'remote-only' });
    });

    it('still treats a genuine local file as extra/checkable', async () => {
        const adapterStat = vi.fn().mockResolvedValue({ type: 'file' });
        const adapterExists = vi.fn().mockResolvedValue(true);
        const { plugin, leaf } = makePlugin({ adapterStat, adapterExists });
        const view = new SyncStatusView(leaf, plugin);

        const remoteMap = new Map<string, GitTreeEntry>([
            ['notes/hidden.md', { path: 'notes/hidden.md', symlink: false }],
        ]);

        const extra = await (view as unknown as {
            identifyExtraFiles(remoteMap: Map<string, GitTreeEntry>, localFilePaths: Set<string>, allLocalFileMap: Map<string, unknown>): Promise<unknown[]>
        }).identifyExtraFiles(remoteMap, new Set(), new Map());

        expect(extra).toEqual(['notes/hidden.md']);
    });
});

describe('SyncStatusView local-only status', () => {
    beforeAll(() => { setupObsidianDOM(); });

    it('does not probe Contents API when the remote tree confirms a file is absent', async () => {
        const getFile = vi.fn().mockResolvedValue({ content: '', sha: '' });
        const plugin = {
            settings: { branch: 'main', vaultFolder: '', rootPath: '' },
            gitService: { getFile },
            getNormalizedPath: (path: string) => path,
        } as unknown as GitLabFilesPush;
        const leaf = { app: { workspace: noDiffPanes(), vault: { adapter: { read: vi.fn().mockResolvedValue('new content') } } } } as unknown as WorkspaceLeaf;
        const view = new SyncStatusView(leaf, plugin);

        await (view as unknown as {
            refreshFileStatus(fileOrPath: string, remoteEntry: GitTreeEntry | undefined): Promise<void>
        }).refreshFileStatus('new.md', undefined);

        expect(getFile).not.toHaveBeenCalled();
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        expect(statuses.get('new.md')).toMatchObject({ path: 'new.md', status: 'unsynced', localContent: 'new content' });
    });

    // A tree entry that exists but carries no sha (providers whose listing omits
    // it) still needs the content fetch — that path must stay intact.
    it('still fetches content for a tree entry without a sha', async () => {
        const getFile = vi.fn().mockResolvedValue({ content: 'remote content', sha: 'remote-sha' });
        const { plugin, leaf } = makePlugin({ adapterExists: vi.fn().mockResolvedValue(true) });
        (plugin.gitService as unknown as { getFile: typeof getFile }).getFile = getFile;

        const view = new SyncStatusView(leaf, plugin);
        vi.spyOn(view as unknown as { readFileContent(f: unknown, b: boolean, s: boolean): Promise<string> }, 'readFileContent')
            .mockResolvedValue('remote content');

        await (view as unknown as {
            refreshFileStatus(fileOrPath: string, remoteEntry: GitTreeEntry | undefined): Promise<void>
        }).refreshFileStatus('notes/existing.md', { path: 'notes/existing.md', symlink: false });

        expect(getFile).toHaveBeenCalledWith('notes/existing.md', 'main');
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        expect(statuses.get('notes/existing.md')?.status).toBe('synced');
    });
});

describe('SyncStatusView post-push status update', () => {
    beforeAll(() => { setupObsidianDOM(); });

    // Regression test: GitHub's tree-by-branch-name read can lag a moment behind
    // a just-completed write (GraphQL createCommitOnBranch or otherwise), so
    // re-fetching the remote tree immediately after a push can misreport a file
    // that was just pushed correctly as still "modified". The fix marks
    // successfully-pushed paths 'synced' directly from the push result instead
    // of trusting an immediate remote re-read.
    it('marks pushed files synced from the push result instead of re-fetching the remote tree', async () => {
        const pushAllFiles = vi.fn().mockResolvedValue({
            success: 2, failed: 0, conflicts: 0, errors: [],
            syncedPaths: [{ path: 'a.md', sha: 'sha-a' }, { path: 'b.md', sha: 'sha-b' }],
        });

        const plugin = {
            settings: { branch: 'main', vaultFolder: '' },
            gitService: {},
            sync: { pushAllFiles },
        } as unknown as GitLabFilesPush;
        const app = { workspace: noDiffPanes(), vault: { adapter: { exists: vi.fn().mockResolvedValue(false) } } };
        const leaf = { app } as unknown as WorkspaceLeaf;
        const view = new SyncStatusView(leaf, plugin);

        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        statuses.set('a.md', { path: 'a.md', status: 'modified', localContent: '' });
        statuses.set('b.md', { path: 'b.md', status: 'modified', localContent: '' });

        const refreshSpy = vi.spyOn(view, 'refreshAllStatuses').mockResolvedValue(undefined);

        await (view as unknown as {
            executeBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull', files: Array<string>): Promise<void>
        }).executeBatchOperation('modified', 'push', ['a.md', 'b.md']);

        expect(pushAllFiles).toHaveBeenCalledTimes(1);
        // The fix: no remote tree re-fetch right after push (that read is what
        // can lag GitHub's write and misreport the file as still modified).
        expect(refreshSpy).not.toHaveBeenCalled();
        expect(statuses.get('a.md')).toEqual({ path: 'a.md', status: 'synced', localContent: '', remoteSha: 'sha-a' });
        expect(statuses.get('b.md')).toEqual({ path: 'b.md', status: 'synced', localContent: '', remoteSha: 'sha-b' });
    });

    it('reuses a snapshot only when the branch head is unchanged', async () => {
        const pushAllFiles = vi.fn().mockResolvedValue({ success: 1, failed: 0, conflicts: 0, errors: [], syncedPaths: [] });
        const tree: GitTreeEntry[] = [{ path: 'a.md', symlink: false, sha: 'sha-a' }];
        const getBranchHead = vi.fn().mockResolvedValue('commit-1');
        const plugin = {
            settings: { branch: 'main', vaultFolder: '', rootPath: '' },
            gitService: { getBranchHead }, sync: { pushAllFiles },
        } as unknown as GitLabFilesPush;
        const leaf = { app: { workspace: noDiffPanes(), vault: { adapter: { exists: vi.fn().mockResolvedValue(false) } } } } as unknown as WorkspaceLeaf;
        const view = new SyncStatusView(leaf, plugin);
        (view as unknown as { remoteTreeSnapshot: unknown }).remoteTreeSnapshot = { branch: 'main', rootPath: '', head: 'commit-1', entries: tree };

        await (view as unknown as {
            executeBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull', files: Array<string>): Promise<void>
        }).executeBatchOperation('selected', 'push', ['a.md']);

        expect(pushAllFiles).toHaveBeenCalledWith(['a.md'], expect.any(Function), tree);
    });

    it('fetches a fresh tree when the branch head changed after refresh', async () => {
        const pushAllFiles = vi.fn().mockResolvedValue({ success: 1, failed: 0, conflicts: 0, errors: [], syncedPaths: [] });
        const plugin = {
            settings: { branch: 'main', vaultFolder: '', rootPath: '' },
            gitService: { getBranchHead: vi.fn().mockResolvedValue('commit-2') }, sync: { pushAllFiles },
        } as unknown as GitLabFilesPush;
        const leaf = { app: { workspace: noDiffPanes(), vault: { adapter: { exists: vi.fn().mockResolvedValue(false) } } } } as unknown as WorkspaceLeaf;
        const view = new SyncStatusView(leaf, plugin);
        (view as unknown as { remoteTreeSnapshot: unknown }).remoteTreeSnapshot = {
            branch: 'main', rootPath: '', head: 'commit-1', entries: [{ path: 'a.md', symlink: false }],
        };

        await (view as unknown as {
            executeBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull', files: Array<string>): Promise<void>
        }).executeBatchOperation('selected', 'push', ['a.md']);

        expect(pushAllFiles).toHaveBeenCalledWith(['a.md'], expect.any(Function), undefined);
    });

    it('still does a full remote refresh after a pull (unaffected by this fix)', async () => {
        const pullAllFiles = vi.fn().mockResolvedValue({ success: 1, failed: 0, conflicts: 0, errors: [] });

        const plugin = {
            settings: { branch: 'main', vaultFolder: '' },
            gitService: {},
            sync: { pullAllFiles },
        } as unknown as GitLabFilesPush;
        const app = { workspace: noDiffPanes(), vault: { adapter: { exists: vi.fn().mockResolvedValue(false) } } };
        const leaf = { app } as unknown as WorkspaceLeaf;
        const view = new SyncStatusView(leaf, plugin);

        const refreshSpy = vi.spyOn(view, 'refreshAllStatuses').mockResolvedValue(undefined);

        await (view as unknown as {
            executeBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull', files: Array<string>): Promise<void>
        }).executeBatchOperation('modified', 'pull', ['a.md']);

        expect(pullAllFiles).toHaveBeenCalledTimes(1);
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });
});
