import { describe, it, expect, vi, beforeAll } from 'vitest';
import { SyncStatusView } from '../../src/ui/SyncStatusView';
import { WorkspaceLeaf, Notice } from 'obsidian';
import type GitLabFilesPush from '../../src/main';
import { setupObsidianDOM } from './setup-dom';
import type { FileStatus } from '../../src/ui/types';
import type { GitTreeEntry } from '../../src/services/git-service-interface';

// Minimal fake plugin: only the surface these tests actually exercise.
function makePlugin(overrides: {
    vaultFolder?: string;
    deleteFile?: ReturnType<typeof vi.fn>;
    adapterExists?: ReturnType<typeof vi.fn>;
    adapterStat?: ReturnType<typeof vi.fn>;
    getAbstractFileByPath?: ReturnType<typeof vi.fn>;
} = {}): { plugin: GitLabFilesPush; leaf: WorkspaceLeaf; deleteFile: ReturnType<typeof vi.fn> } {
    const vaultFolder = overrides.vaultFolder ?? '';
    const deleteFile = overrides.deleteFile ?? vi.fn().mockResolvedValue(undefined);

    const app = {
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
        gitService: { deleteFile },
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
