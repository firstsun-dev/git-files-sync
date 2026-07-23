import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { SyncStatusView } from '../../src/ui/SyncStatusView';
import { WorkspaceLeaf, TFile } from 'obsidian';
import type GitLabFilesPush from '../../src/main';
import { setupObsidianDOM } from './setup-dom';
import type { FileStatus } from '../../src/ui/types';
import type { GitLabFilesPushSettings } from '../../src/settings';
import { renderFileItem, type FileItemCallbacks } from '../../src/ui/components/FileListItem';

function makeSettings(overrides: Partial<GitLabFilesPushSettings> = {}): GitLabFilesPushSettings {
    return {
        serviceType: 'github',
        gitlabToken: '', gitlabBaseUrl: 'https://gitlab.com', projectId: '',
        githubToken: '', githubOwner: 'firstsun-dev', githubRepo: 'git-files-sync',
        giteaToken: '', giteaBaseUrl: '', giteaOwner: '', giteaRepo: '',
        branch: 'main', syncMetadata: {}, rootPath: '', vaultFolder: '',
        symlinkHandling: 'follow', ignorePatterns: '',
        lastSeenVersion: '', bannerDismissedVersion: '', language: 'en',
        ...overrides,
    } as GitLabFilesPushSettings;
}

function makeView(settings = makeSettings(), getFileByPath = vi.fn().mockReturnValue(null)) {
    const openFile = vi.fn().mockResolvedValue(undefined);
    const getLeaf = vi.fn().mockReturnValue({ openFile });

    const plugin = {
        settings,
        gitService: {},
        getNormalizedPath(path: string): string {
            const folder = settings.vaultFolder;
            if (!folder) return path;
            const prefix = `${folder}/`;
            return path.startsWith(prefix) ? path.substring(prefix.length) : path;
        },
    } as unknown as GitLabFilesPush;

    const leaf = {
        app: {
            workspace: { getLeaf },
            vault: { getFileByPath, adapter: { exists: vi.fn().mockResolvedValue(false) } },
        },
    } as unknown as WorkspaceLeaf;

    return { view: new SyncStatusView(leaf, plugin), getLeaf, openFile, getFileByPath };
}

type Internals = {
    openTargetFor(fs: FileStatus): { kind: 'local' | 'remote' } | null;
    openFileFromRow(fs: FileStatus, newLeaf: boolean): boolean;
    fileItemCallbacks(): FileItemCallbacks;
};
const internals = (view: SyncStatusView): Internals => view as unknown as Internals;

describe('SyncStatusView path open target', () => {
    beforeAll(() => { setupObsidianDOM(); });

    let windowOpen: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        windowOpen = vi.fn();
        (globalThis as unknown as { window: { open: unknown } }).window.open = windowOpen;
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('opens a local file in the vault', () => {
        const file = new TFile();
        const { view, getLeaf, openFile } = makeView();
        const fs: FileStatus = { path: 'notes/todo.md', status: 'modified', file };

        expect(internals(view).openFileFromRow(fs, false)).toBe(true);
        expect(getLeaf).toHaveBeenCalledWith(false);
        expect(openFile).toHaveBeenCalledWith(file);
        expect(windowOpen).not.toHaveBeenCalled();
    });

    it('honours a modifier by requesting a new leaf', () => {
        const { view, getLeaf } = makeView();
        const fs: FileStatus = { path: 'notes/todo.md', status: 'modified', file: new TFile() };

        internals(view).openFileFromRow(fs, true);

        expect(getLeaf).toHaveBeenCalledWith(true);
    });

    it('falls back to the vault index when the status carries no TFile', () => {
        const file = new TFile();
        const { view, openFile } = makeView(makeSettings(), vi.fn().mockReturnValue(file));

        expect(internals(view).openFileFromRow({ path: 'notes/todo.md', status: 'unsynced' }, false)).toBe(true);
        expect(openFile).toHaveBeenCalledWith(file);
    });

    it('opens a remote-only file on the provider instead of the vault', () => {
        const { view, getLeaf } = makeView();

        expect(internals(view).openFileFromRow({ path: 'notes/todo.md', status: 'remote-only' }, false)).toBe(true);
        expect(windowOpen).toHaveBeenCalledWith(
            'https://github.com/firstsun-dev/git-files-sync/blob/main/notes/todo.md', '_blank');
        expect(getLeaf).not.toHaveBeenCalled();
    });

    it('strips the vaultFolder prefix before building the remote URL', () => {
        const { view } = makeView(makeSettings({ vaultFolder: '02_Areas/blog' }));

        internals(view).openFileFromRow({ path: '02_Areas/blog/notes/todo.md', status: 'remote-only' }, false);

        expect(windowOpen).toHaveBeenCalledWith(
            'https://github.com/firstsun-dev/git-files-sync/blob/main/notes/todo.md', '_blank');
    });

    // A local-only file isn't on the remote, so there is nothing to fall back
    // to — it must not silently open a URL that 404s.
    it('reports no target for a local path Obsidian cannot open', () => {
        const { view } = makeView();
        const fs: FileStatus = { path: '.hidden/data.json', status: 'unsynced' };

        expect(internals(view).openTargetFor(fs)).toBeNull();
        expect(internals(view).openFileFromRow(fs, false)).toBe(false);
        expect(windowOpen).not.toHaveBeenCalled();
    });

    it('reports no target when the provider settings yield no web URL', () => {
        const { view } = makeView(makeSettings({ serviceType: 'gitlab', projectId: '12345678' }));

        expect(internals(view).openTargetFor({ path: 'a.md', status: 'remote-only' })).toBeNull();
    });
});

describe('file row path rendering', () => {
    beforeAll(() => { setupObsidianDOM(); });

    function renderRow(view: SyncStatusView, fs: FileStatus): HTMLElement {
        const container = document.createElement('div');
        renderFileItem(container, fs, false, internals(view).fileItemCallbacks());
        return container;
    }

    it('renders an openable path as a link', () => {
        const { view } = makeView();
        const container = renderRow(view, { path: 'notes/todo.md', status: 'modified', file: new TFile() });

        expect(container.querySelector('.ssv-file-path-link')).not.toBeNull();
    });

    it('renders a path with no target as plain text', () => {
        const { view } = makeView();
        const container = renderRow(view, { path: '.hidden/data.json', status: 'unsynced' });

        expect(container.querySelector('.ssv-file-path')).not.toBeNull();
        expect(container.querySelector('.ssv-file-path-link')).toBeNull();
    });
});
