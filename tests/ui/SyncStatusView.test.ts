/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { SyncStatusView } from '../../src/ui/SyncStatusView';
import { WorkspaceLeaf, Notice, TFile } from 'obsidian';
import type GitLabFilesPush from '../../src/main';
import { setupObsidianDOM } from './setup-dom';
import type { FileStatus } from '../../src/ui/types';
import type { GitTreeEntry } from '../../src/services/git-service-interface';
import { SyncPlanModal } from '../../src/ui/SyncPlanModal';
import { ConfirmModal } from '../../src/ui/ConfirmModal';
import { gitBlobSha } from '../../src/utils/git-blob-sha';

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
    adapterRead?: ReturnType<typeof vi.fn>;
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
                read: overrides.adapterRead ?? vi.fn().mockResolvedValue(''),
            },
            getAbstractFileByPath: overrides.getAbstractFileByPath ?? vi.fn().mockReturnValue(null),
        },
    };

    const settings: { branch: string; vaultFolder: string; syncMetadata?: Record<string, { lastSyncedSha: string; lastSyncedAt: number; lastKnownPath: string; renamedFrom?: string }> } = { branch: 'main', vaultFolder };
    const plugin = {
        settings,
        gitService: { deleteFile, deleteBatch: overrides.deleteBatch },
        sync: {
            // Mirrors SyncManager.trackRename closely enough for these tests:
            // moves the metadata entry to the new path and records renamedFrom.
            async trackRename(newPath: string, oldPath: string): Promise<void> {
                const meta = settings.syncMetadata?.[oldPath];
                if (!meta) return;
                delete settings.syncMetadata![oldPath];
                const remotePath = meta.renamedFrom ?? oldPath;
                settings.syncMetadata![newPath] = {
                    ...meta,
                    lastKnownPath: newPath,
                    ...(newPath === remotePath ? {} : { renamedFrom: remotePath }),
                };
            },
            // Mirrors SyncManager.updateMetadata.
            async updateMetadata(path: string, sha: string): Promise<void> {
                settings.syncMetadata = settings.syncMetadata ?? {};
                settings.syncMetadata[path] = { lastSyncedSha: sha, lastSyncedAt: 0, lastKnownPath: path };
            },
        },
        getNormalizedPath(path: string): string {
            if (!vaultFolder) return path;
            const prefix = `${vaultFolder}/`;
            if (path.startsWith(prefix)) return path.substring(prefix.length);
            if (path === vaultFolder) return '';
            return path;
        },
        filterPathByVaultFolder(path: string): boolean {
            if (!vaultFolder) return true;
            const prefix = `${vaultFolder}/`;
            return path.startsWith(prefix) || path === vaultFolder;
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

    // The modal is opened internally by confirmDeletion, so there's no
    // reference to it up front; wrap `open` to capture `this` (the real
    // instance, still rendered for real) as it's constructed.
    function captureNextSyncPlanModal(): { contentEl: HTMLElement } {
        const captured: { contentEl: HTMLElement } = { contentEl: undefined as unknown as HTMLElement };
        const original = SyncPlanModal.prototype.open;
        vi.spyOn(SyncPlanModal.prototype, 'open').mockImplementationOnce(function (this: SyncPlanModal & { contentEl: HTMLElement }) {
            captured.contentEl = this.contentEl;
            return original.call(this);
        });
        return captured;
    }

    it('shows the plan-review modal (not a plain confirm) before any remote deletion', async () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const captured = captureNextSyncPlanModal();

        const confirmPromise = (view as unknown as {
            confirmDeletion(local: FileStatus[], remote: FileStatus[]): Promise<boolean>
        }).confirmDeletion([], [{ path: 'gone.md', status: 'remote-only' }]);

        const deletionPath = captured.contentEl.querySelector('.sync-plan-section.is-destructive .sync-plan-file-path');
        expect(deletionPath?.textContent).toBe('gone.md');

        const applyBtn = Array.from(captured.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Apply');
        applyBtn?.dispatchEvent(new Event('click'));

        expect(await confirmPromise).toBe(true);
    });

    it('resolves false when the remote-deletion plan is cancelled', async () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const captured = captureNextSyncPlanModal();

        const confirmPromise = (view as unknown as {
            confirmDeletion(local: FileStatus[], remote: FileStatus[]): Promise<boolean>
        }).confirmDeletion([], [{ path: 'gone.md', status: 'remote-only' }]);

        const cancelBtn = Array.from(captured.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Cancel');
        cancelBtn?.dispatchEvent(new Event('click'));

        expect(await confirmPromise).toBe(false);
    });

    it('uses the plain confirm dialog (no plan) for a local-only deletion', async () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const openSpy = vi.spyOn(SyncPlanModal.prototype, 'open');
        openSpy.mockClear();

        const originalConfirmOpen = ConfirmModal.prototype.open;
        let confirmContentEl: HTMLElement | undefined;
        vi.spyOn(ConfirmModal.prototype, 'open').mockImplementationOnce(function (this: ConfirmModal & { contentEl: HTMLElement }) {
            confirmContentEl = this.contentEl;
            return originalConfirmOpen.call(this);
        });

        const confirmPromise = (view as unknown as {
            confirmDeletion(local: FileStatus[], remote: FileStatus[]): Promise<boolean>
        }).confirmDeletion([{ path: 'local.md', status: 'synced' }], []);

        expect(openSpy).not.toHaveBeenCalled();

        const confirmBtn = Array.from(confirmContentEl!.querySelectorAll('button')).find(b => b.textContent === 'Confirm');
        confirmBtn?.dispatchEvent(new Event('click'));

        expect(await confirmPromise).toBe(true);
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

    // The old path of a pending move is represented by the 'moved' row at its
    // new path, not a separate remote-only row — otherwise every move would
    // show a stale row whose most prominent button (Pull) undoes the move.
    it('skips a remote-only row for a path that is the old side of a pending move', async () => {
        const { plugin, leaf } = makePlugin();
        plugin.settings.syncMetadata = {
            'notes/new.md': { lastSyncedSha: 'sha', lastSyncedAt: 0, lastKnownPath: 'notes/new.md', renamedFrom: 'notes/old.md' },
        };
        const view = new SyncStatusView(leaf, plugin);

        const remoteMap = new Map<string, GitTreeEntry>([
            ['notes/old.md', { path: 'notes/old.md', symlink: false, sha: 'sha' }],
        ]);

        const extra = await (view as unknown as {
            identifyExtraFiles(remoteMap: Map<string, GitTreeEntry>, localFilePaths: Set<string>, allLocalFileMap: Map<string, unknown>, pendingMoveOldPaths: Set<string>): Promise<unknown[]>
        }).identifyExtraFiles(remoteMap, new Set(), new Map(), new Set(['notes/old.md']));

        expect(extra).toEqual([]);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        expect(statuses.has('notes/old.md')).toBe(false);
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

    // Root cause of a real report: a file whose content already matches the
    // remote (e.g. never pushed/pulled through this plugin -- cloned in, or
    // coincidentally identical) showed 'synced' in the panel but had no
    // syncMetadata entry. Renaming/moving it then found no metadata at the old
    // path, so SyncManager.trackRename silently no-opped and the move showed
    // as a stray remote-only + unsynced pair instead of 'moved'. Classifying a
    // file as 'synced' must backfill syncMetadata so a later move is tracked.
    it('backfills syncMetadata when a sha-based comparison finds a file already synced', async () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        vi.spyOn(view as unknown as { readLocalContentForSha(...args: unknown[]): Promise<string> }, 'readLocalContentForSha')
            .mockResolvedValue('same content');

        await (view as unknown as {
            refreshFileStatusBySha(fileOrPath: string, remoteEntry: GitTreeEntry): Promise<void>
        }).refreshFileStatusBySha('notes/pre-existing.md', { path: 'notes/pre-existing.md', symlink: false, sha: await gitBlobSha('same content') });

        expect(plugin.settings.syncMetadata?.['notes/pre-existing.md']).toMatchObject({ lastKnownPath: 'notes/pre-existing.md' });
    });

    it('backfills syncMetadata when a content-based comparison finds a file already synced', async () => {
        const getFile = vi.fn().mockResolvedValue({ content: 'same content', sha: 'remote-sha' });
        const { plugin, leaf } = makePlugin({ adapterExists: vi.fn().mockResolvedValue(true) });
        (plugin.gitService as unknown as { getFile: typeof getFile }).getFile = getFile;

        const view = new SyncStatusView(leaf, plugin);
        vi.spyOn(view as unknown as { readFileContent(f: unknown, b: boolean, s: boolean): Promise<string> }, 'readFileContent')
            .mockResolvedValue('same content');

        await (view as unknown as {
            refreshFileStatusByContent(fileOrPath: string): Promise<void>
        }).refreshFileStatusByContent('notes/pre-existing.md');

        expect(plugin.settings.syncMetadata?.['notes/pre-existing.md']).toMatchObject({ lastSyncedSha: 'remote-sha' });
    });

    it('end-to-end: a rename right after a sha-based synced classification is tracked as moved, not a stray remote-only + unsynced pair', async () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        vi.spyOn(view as unknown as { readLocalContentForSha(...args: unknown[]): Promise<string> }, 'readLocalContentForSha')
            .mockResolvedValue('same content');
        const sha = await gitBlobSha('same content');

        // First refresh: the file was never pushed/pulled through the plugin,
        // but its content already matches remote -- classified 'synced' from a
        // clean slate, same as a freshly opened vault.
        await (view as unknown as {
            refreshFileStatusBySha(fileOrPath: string, remoteEntry: GitTreeEntry): Promise<void>
        }).refreshFileStatusBySha('notes/old.md', { path: 'notes/old.md', symlink: false, sha });

        // Then the user renames it inside Obsidian -- mirrors main.ts's rename handler.
        await plugin.sync.trackRename('notes/new.md', 'notes/old.md');

        expect(plugin.settings.syncMetadata?.['notes/old.md']).toBeUndefined();
        expect(plugin.settings.syncMetadata?.['notes/new.md']).toMatchObject({ renamedFrom: 'notes/old.md' });
    });

    it('classifies a tracked pending move as "moved" from metadata alone, with no tree/content lookup', async () => {
        const getFile = vi.fn();
        const { plugin, leaf } = makePlugin();
        plugin.settings.syncMetadata = {
            'notes/new.md': { lastSyncedSha: 'sha', lastSyncedAt: 0, lastKnownPath: 'notes/new.md', renamedFrom: 'notes/old.md' },
        };
        (plugin.gitService as unknown as { getFile: typeof getFile }).getFile = getFile;
        const view = new SyncStatusView(leaf, plugin);

        await (view as unknown as {
            refreshFileStatus(fileOrPath: string, remoteEntry: GitTreeEntry | undefined): Promise<void>
        }).refreshFileStatus('notes/new.md', { path: 'notes/new.md', symlink: false, sha: 'irrelevant' });

        expect(getFile).not.toHaveBeenCalled();
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        expect(statuses.get('notes/new.md')).toMatchObject({ path: 'notes/new.md', status: 'moved', movedFrom: 'notes/old.md' });
    });
});

// A move that happens while the plugin isn't observing the vault's live
// 'rename' event (Obsidian was closed, the move came from another device/OS
// tool, or the plugin hadn't loaded yet) leaves no `renamedFrom` in metadata.
// The status refresh path has no fallback for this: identifyExtraFiles only
// treats a remote path as the old side of a move via pendingMoveOldPaths,
// which is built purely from live-tracked `renamedFrom` entries — never from
// comparing content. So the old path is misclassified 'remote-only' and the
// new path 'unsynced', instead of both being recognized as a 'moved' pair.
describe('SyncStatusView move detection without a live rename event', () => {
    beforeAll(() => { setupObsidianDOM(); });

    it('still classifies an out-of-band folder move as moved, not remote-only + unsynced', async () => {
        const { gitBlobSha } = await import('../../src/utils/git-blob-sha');
        const content = 'same content, moved without the plugin watching';
        const sha = await gitBlobSha(content);

        const adapterRead = vi.fn().mockResolvedValue(content);
        const { plugin, leaf } = makePlugin({ adapterRead });
        // Sync metadata still points at the old path — no renamedFrom, because
        // the vault 'rename' event never fired for this move.
        plugin.settings.syncMetadata = {
            'Notes/Projects/a.md': { lastSyncedSha: sha, lastSyncedAt: 0, lastKnownPath: 'Notes/Projects/a.md' },
        };
        const view = new SyncStatusView(leaf, plugin);

        const remoteMap = new Map<string, GitTreeEntry>([
            ['Notes/Projects/a.md', { path: 'Notes/Projects/a.md', symlink: false, sha }],
        ]);

        // No pendingMoveOldPaths, since none was ever live-tracked.
        const extra = await (view as unknown as {
            identifyExtraFiles(remoteMap: Map<string, GitTreeEntry>, localFilePaths: Set<string>, allLocalFileMap: Map<string, unknown>, pendingMoveOldPaths: Set<string>): Promise<unknown[]>
        }).identifyExtraFiles(remoteMap, new Set(), new Map(), new Set());

        // The file now lives at Archive/Projects/a.md locally, with no remote entry yet.
        await (view as unknown as {
            refreshFileStatus(fileOrPath: string, remoteEntry: GitTreeEntry | undefined): Promise<void>
        }).refreshFileStatus('Archive/Projects/a.md', undefined);

        await (view as unknown as {
            reconcileOutOfBandMoves(remoteMap: Map<string, GitTreeEntry>): Promise<void>
        }).reconcileOutOfBandMoves(remoteMap);

        expect(extra).toEqual([]);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        expect(statuses.get('Archive/Projects/a.md')).toMatchObject({
            status: 'moved',
            movedFrom: 'Notes/Projects/a.md',
        });
        expect(statuses.has('Notes/Projects/a.md')).toBe(false);
    });

    // Regression test for the hazard behind the out-of-band fix above: an
    // external move often reaches Obsidian's vault watcher as a bare delete of
    // the old path (no correlated rename), so any code path that reacts to
    // that delete by wiping syncMetadata[oldPath] destroys the exact evidence
    // this reconciler needs. If that race wins, the move degenerates back into
    // the original #66 bug: a permanent 'remote-only' ghost plus a plain
    // 'unsynced' new file, never paired as 'moved'.
    it('cannot recognize an out-of-band move once its old-path metadata has already been cleared', async () => {
        const { gitBlobSha } = await import('../../src/utils/git-blob-sha');
        const content = 'moved while a delete handler raced ahead and cleared metadata first';
        const sha = await gitBlobSha(content);

        const adapterRead = vi.fn().mockResolvedValue(content);
        const { plugin, leaf } = makePlugin({ adapterRead });
        plugin.settings.syncMetadata = {
            'Notes/Projects/a.md': { lastSyncedSha: sha, lastSyncedAt: 0, lastKnownPath: 'Notes/Projects/a.md' },
        };
        const view = new SyncStatusView(leaf, plugin);

        const remoteMap = new Map<string, GitTreeEntry>([
            ['Notes/Projects/a.md', { path: 'Notes/Projects/a.md', symlink: false, sha }],
        ]);

        await (view as unknown as {
            identifyExtraFiles(remoteMap: Map<string, GitTreeEntry>, localFilePaths: Set<string>, allLocalFileMap: Map<string, unknown>, pendingMoveOldPaths: Set<string>): Promise<unknown[]>
        }).identifyExtraFiles(remoteMap, new Set(), new Map(), new Set());

        await (view as unknown as {
            refreshFileStatus(fileOrPath: string, remoteEntry: GitTreeEntry | undefined): Promise<void>
        }).refreshFileStatus('Archive/Projects/a.md', undefined);

        // Simulates a vault 'delete' handler firing for the old path before
        // this refresh's reconciliation pass gets to run.
        delete plugin.settings.syncMetadata['Notes/Projects/a.md'];

        await (view as unknown as {
            reconcileOutOfBandMoves(remoteMap: Map<string, GitTreeEntry>): Promise<void>
        }).reconcileOutOfBandMoves(remoteMap);

        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        expect(statuses.get('Notes/Projects/a.md')).toMatchObject({ status: 'remote-only' });
        expect(statuses.get('Archive/Projects/a.md')).not.toMatchObject({ status: 'moved' });
    });
});

describe('SyncStatusView.handleFileModified', () => {
    beforeAll(() => { setupObsidianDOM(); });

    it('flips a synced row to modified when the edited content no longer matches the known remote sha', async () => {
        const adapterRead = vi.fn().mockResolvedValue('edited content');
        const { plugin, leaf } = makePlugin({ adapterRead });
        const view = new SyncStatusView(leaf, plugin);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        statuses.set('note.md', { path: 'note.md', status: 'synced', localContent: 'old content', remoteSha: 'sha-of-old-content' });

        const file = Object.assign(new TFile(), { path: 'note.md' });
        await view.handleFileModified(file);

        expect(statuses.get('note.md')).toMatchObject({ status: 'modified', localContent: 'edited content' });
    });

    it('leaves a moved row alone -- content edits do not undo a pending move', async () => {
        const adapterRead = vi.fn().mockResolvedValue('edited content');
        const { plugin, leaf } = makePlugin({ adapterRead });
        const view = new SyncStatusView(leaf, plugin);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        statuses.set('new.md', { path: 'new.md', status: 'moved', movedFrom: 'old.md' });

        const file = Object.assign(new TFile(), { path: 'new.md' });
        await view.handleFileModified(file);

        expect(adapterRead).not.toHaveBeenCalled();
        expect(statuses.get('new.md')).toMatchObject({ status: 'moved', movedFrom: 'old.md' });
    });

    it('leaves a remote-only row alone -- there is no local file for it to have changed', async () => {
        const adapterRead = vi.fn().mockResolvedValue('content');
        const { plugin, leaf } = makePlugin({ adapterRead });
        const view = new SyncStatusView(leaf, plugin);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        statuses.set('remote-only.md', { path: 'remote-only.md', status: 'remote-only' });

        const file = Object.assign(new TFile(), { path: 'remote-only.md' });
        await view.handleFileModified(file);

        expect(adapterRead).not.toHaveBeenCalled();
        expect(statuses.get('remote-only.md')).toMatchObject({ status: 'remote-only' });
    });

    it('ignores a path the panel is not currently tracking', async () => {
        const adapterRead = vi.fn().mockResolvedValue('content');
        const { plugin, leaf } = makePlugin({ adapterRead });
        const view = new SyncStatusView(leaf, plugin);

        const file = Object.assign(new TFile(), { path: 'untracked.md' });
        await view.handleFileModified(file);

        expect(adapterRead).not.toHaveBeenCalled();
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        expect(statuses.has('untracked.md')).toBe(false);
    });
});

describe('SyncStatusView.handleFileRenamed', () => {
    beforeAll(() => { setupObsidianDOM(); });

    it('moves a synced row to the new path as \'moved\', reading the renamedFrom trackRename just recorded', () => {
        const { plugin, leaf } = makePlugin();
        plugin.settings.syncMetadata = { 'old.md': { lastSyncedSha: 'sha-1', lastSyncedAt: 0, lastKnownPath: 'old.md' } };
        const view = new SyncStatusView(leaf, plugin);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        statuses.set('old.md', { path: 'old.md', status: 'synced', remoteSha: 'sha-1' });

        // Mirrors what main.ts does: SyncManager.trackRename runs first (moving
        // the metadata entry and setting renamedFrom), then the view is notified.
        void plugin.sync.trackRename('new.md', 'old.md');
        const file = Object.assign(new TFile(), { path: 'new.md' });
        view.handleFileRenamed(file, 'old.md');

        expect(statuses.has('old.md')).toBe(false);
        expect(statuses.get('new.md')).toMatchObject({ status: 'moved', movedFrom: 'old.md' });
    });

    it('keeps a never-pushed file local-only after its rename records no metadata', async () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        statuses.set('draft-old.md', { path: 'draft-old.md', status: 'unsynced', localContent: 'draft' });

        // main.ts always asks SyncManager to track a vault rename first. A
        // never-pushed file has no sync metadata, so this must stay a no-op:
        // treating its rename as a move would later delete an unrelated remote
        // path if one happened to exist.
        await plugin.sync.trackRename('draft-new.md', 'draft-old.md');
        expect(plugin.settings.syncMetadata).toBeUndefined();

        const file = Object.assign(new TFile(), { path: 'draft-new.md' });
        view.handleFileRenamed(file, 'draft-old.md');

        expect(statuses.has('draft-old.md')).toBe(false);
        const renamed = statuses.get('draft-new.md');
        expect(renamed).toMatchObject({ status: 'unsynced', localContent: 'draft' });
        expect(renamed).not.toHaveProperty('movedFrom');
    });

    it('drops the row entirely when the rename moves the file out of the configured vault folder', () => {
        const { plugin, leaf } = makePlugin({ vaultFolder: 'scoped' });
        const view = new SyncStatusView(leaf, plugin);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        statuses.set('scoped/old.md', { path: 'scoped/old.md', status: 'synced', remoteSha: 'sha-1' });

        const file = Object.assign(new TFile(), { path: 'outside/new.md' });
        view.handleFileRenamed(file, 'scoped/old.md');

        expect(statuses.has('scoped/old.md')).toBe(false);
        expect(statuses.has('outside/new.md')).toBe(false);
    });

    it('ignores a rename mid-refresh -- the in-flight refresh will settle it', () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        statuses.set('old.md', { path: 'old.md', status: 'checking' });

        const file = Object.assign(new TFile(), { path: 'new.md' });
        view.handleFileRenamed(file, 'old.md');

        expect(statuses.get('old.md')).toMatchObject({ status: 'checking' });
        expect(statuses.has('new.md')).toBe(false);
    });

    it('ignores a rename the panel is not currently tracking', () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;

        const file = Object.assign(new TFile(), { path: 'new.md' });
        view.handleFileRenamed(file, 'untracked-old.md');

        expect(statuses.has('new.md')).toBe(false);
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

    // Regression test: runSingleFile used to call refreshFileStatus(file, undefined)
    // after a successful push. Passing `undefined` as the remoteEntry means "this
    // path isn't on the remote at all", which forces status back to 'unsynced'
    // right after a successful push. The fix applies the same optimistic-sync
    // approach as the batch path above instead of re-deriving status from a
    // (misleading) "not on remote" signal.
    it('marks a single pushed file synced from the push result instead of forcing unsynced', async () => {
        const pushFile = vi.fn().mockResolvedValue({ sha: 'new-sha' });
        const getFile = vi.fn();

        const plugin = {
            settings: { branch: 'main', vaultFolder: '' },
            gitService: { getFile },
            sync: { pushFile },
        } as unknown as GitLabFilesPush;
        const app = { workspace: noDiffPanes(), vault: { adapter: { exists: vi.fn().mockResolvedValue(false) } } };
        const leaf = { app } as unknown as WorkspaceLeaf;
        const view = new SyncStatusView(leaf, plugin);

        const statuses = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        const fileStatus: FileStatus = { path: 'note.md', status: 'modified', localContent: 'x' };
        statuses.set('note.md', fileStatus);

        await (view as unknown as {
            runSingleFile(fileStatus: FileStatus, op: 'push' | 'pull'): Promise<void>
        }).runSingleFile(fileStatus, 'push');

        expect(pushFile).toHaveBeenCalledTimes(1);
        // No live remote re-check when the push result already confirms sync.
        expect(getFile).not.toHaveBeenCalled();
        expect(statuses.get('note.md')).toMatchObject({ path: 'note.md', status: 'synced', remoteSha: 'new-sha' });
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

describe('SyncStatusView folder-move collapsing (#67)', () => {
    beforeAll(() => { setupObsidianDOM(); });

    type CollapsibleGroups = Map<string, { oldPrefix: string; newPrefix: string; members: FileStatus[] }>;

    function movedStatus(path: string, movedFrom: string): FileStatus {
        return { path, status: 'moved', movedFrom };
    }

    it('collapses every file of a fully-moved folder into a single group', () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const statuses = [
            movedStatus('Archive/Projects/a.md', 'Notes/Projects/a.md'),
            movedStatus('Archive/Projects/b.md', 'Notes/Projects/b.md'),
            movedStatus('Archive/Projects/sub/c.md', 'Notes/Projects/sub/c.md'),
        ];

        const groups = (view as unknown as {
            collapsibleMoveGroups(statuses: FileStatus[]): CollapsibleGroups
        }).collapsibleMoveGroups(statuses);

        expect(groups.size).toBe(1);
        const [group] = [...groups.values()];
        // The differing segment alone: everything after "Notes"/"Archive"
        // (including nested "sub/") matches, so that's the common suffix.
        expect(group).toMatchObject({ oldPrefix: 'Notes', newPrefix: 'Archive' });
        expect(group?.members).toHaveLength(3);
    });

    it('does not collapse a partial move — a file left behind under the old prefix keeps the group expanded', () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const statusStore = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
        statusStore.set('Archive/Projects/a.md', movedStatus('Archive/Projects/a.md', 'Notes/Projects/a.md'));
        statusStore.set('Archive/Projects/b.md', movedStatus('Archive/Projects/b.md', 'Notes/Projects/b.md'));
        // Left behind: still at the old prefix, never moved.
        statusStore.set('Notes/Projects/c.md', { path: 'Notes/Projects/c.md', status: 'synced' });
        const statuses = [...statusStore.values()];

        const groups = (view as unknown as {
            collapsibleMoveGroups(statuses: FileStatus[]): CollapsibleGroups
        }).collapsibleMoveGroups(statuses);

        expect(groups.size).toBe(0);
    });

    it('does not collapse a single moved file — a group of one stays a plain moved row', () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const statuses = [movedStatus('Archive/a.md', 'Notes/a.md')];

        const groups = (view as unknown as {
            collapsibleMoveGroups(statuses: FileStatus[]): CollapsibleGroups
        }).collapsibleMoveGroups(statuses);

        expect(groups.size).toBe(0);
    });

    it('does not merge a file that was renamed as well as moved into the folder group', () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const statuses = [
            movedStatus('Archive/Projects/a.md', 'Notes/Projects/a.md'),
            movedStatus('Archive/Projects/b.md', 'Notes/Projects/b.md'),
            // Same folder move, but this file's own name also changed.
            movedStatus('Archive/Projects/renamed.md', 'Notes/Projects/original.md'),
        ];

        const groups = (view as unknown as {
            collapsibleMoveGroups(statuses: FileStatus[]): CollapsibleGroups
        }).collapsibleMoveGroups(statuses);

        expect(groups.size).toBe(1);
        const [group] = [...groups.values()];
        expect(group?.members.map(m => m.path).sort()).toEqual(['Archive/Projects/a.md', 'Archive/Projects/b.md']);
    });

    it('counts a collapsed group as one row in the moved tab count, not one per file', () => {
        const { plugin, leaf } = makePlugin();
        const view = new SyncStatusView(leaf, plugin);
        const statuses = [
            movedStatus('Archive/Projects/a.md', 'Notes/Projects/a.md'),
            movedStatus('Archive/Projects/b.md', 'Notes/Projects/b.md'),
            movedStatus('Elsewhere/solo.md', 'Somewhere/solo.md'),
        ];

        const count = (view as unknown as {
            movedRowCount(statuses: FileStatus[]): number
        }).movedRowCount(statuses);

        // The 2-file folder group is 1 row, plus 1 ungrouped moved row = 2.
        expect(count).toBe(2);
    });
});
