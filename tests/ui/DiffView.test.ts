import { describe, it, expect, vi, beforeAll } from 'vitest';
import { DiffView, SYNC_DIFF_VIEW_TYPE } from '../../src/ui/DiffView';
import { SyncStatusView } from '../../src/ui/SyncStatusView';
import { WorkspaceLeaf } from 'obsidian';
import type GitLabFilesPush from '../../src/main';
import { setupObsidianDOM } from './setup-dom';
import type { FileStatus } from '../../src/ui/types';

function makeDiffView(): DiffView {
    const leaf = { setViewState: vi.fn().mockResolvedValue(undefined) } as unknown as WorkspaceLeaf;
    return new DiffView(leaf);
}

function body(view: DiffView): HTMLElement {
    return view.containerEl.children[1] as HTMLElement;
}

describe('DiffView', () => {
    beforeAll(() => { setupObsidianDOM(); });

    it('shows an empty state before any file is set', async () => {
        const view = makeDiffView();
        await view.onOpen();

        expect(body(view).querySelector('.ssv-empty')).not.toBeNull();
        expect(view.getPath()).toBeNull();
    });

    it('renders the side-by-side grid for a text diff', async () => {
        const view = makeDiffView();
        await view.onOpen();
        view.setDiff({ path: 'notes/todo.md', status: 'modified', remoteContent: 'a', localContent: 'b' });

        expect(view.getPath()).toBe('notes/todo.md');
        expect(body(view).querySelector('.ssv-diff-grid')).not.toBeNull();
    });

    // The pane carries its own container-type so the split/unified container
    // query resolves against the pane's width rather than the sidebar's.
    it('wraps the diff in its own query container', async () => {
        const view = makeDiffView();
        await view.onOpen();
        view.setDiff({ path: 'a.md', status: 'modified', remoteContent: 'a', localContent: 'b' });

        expect(body(view).querySelector('.ssv-diff-pane')).not.toBeNull();
    });

    it('shows a symlink message instead of a text diff', async () => {
        const view = makeDiffView();
        await view.onOpen();
        view.setDiff({ path: 'link', status: 'modified', isSymlink: true });

        expect(body(view).querySelector('.ssv-diff-binary')?.textContent).toBe('Symlink target changed');
    });

    it('titles the tab with the file it is showing', async () => {
        const view = makeDiffView();
        await view.onOpen();
        expect(view.getDisplayText()).toBe('Diff');

        view.setDiff({ path: 'notes/todo.md', status: 'modified', remoteContent: 'a', localContent: 'b' });
        expect(view.getDisplayText()).toBe('Diff: notes/todo.md');
    });

    it('replaces the previous file rather than appending to it', async () => {
        const view = makeDiffView();
        await view.onOpen();
        view.setDiff({ path: 'a.md', status: 'modified', remoteContent: 'a', localContent: 'b' });
        view.setDiff({ path: 'b.md', status: 'modified', remoteContent: 'c', localContent: 'd' });

        expect(view.getPath()).toBe('b.md');
        expect(body(view).querySelectorAll('.ssv-diff-pane')).toHaveLength(1);
    });
});

describe('SyncStatusView diff pane', () => {
    beforeAll(() => { setupObsidianDOM(); });

    function makeView(openPanes: DiffView[] = []) {
        const leaves = openPanes.map(v => ({ view: v, detach: vi.fn() }));
        const getLeavesOfType = vi.fn().mockImplementation((type: string) =>
            type === SYNC_DIFF_VIEW_TYPE ? leaves : []);
        const newLeaf = { setViewState: vi.fn().mockResolvedValue(undefined), view: makeDiffView() };
        const getLeaf = vi.fn().mockReturnValue(newLeaf);
        const revealLeaf = vi.fn().mockResolvedValue(undefined);

        const plugin = {
            settings: { branch: 'main', vaultFolder: '', rootPath: '' },
            gitService: {},
            getNormalizedPath: (p: string) => p,
        } as unknown as GitLabFilesPush;

        const leaf = {
            app: {
                workspace: { getLeavesOfType, getLeaf, revealLeaf },
                vault: { getFileByPath: vi.fn().mockReturnValue(null), adapter: { exists: vi.fn() } },
            },
        } as unknown as WorkspaceLeaf;

        return { view: new SyncStatusView(leaf, plugin), leaves, getLeaf, newLeaf, revealLeaf };
    }

    type Internals = {
        openDiffPane(fs: FileStatus): Promise<void>;
        closeDiffPaneFor(paths: Iterable<string>): void;
    };
    const internals = (v: SyncStatusView): Internals => v as unknown as Internals;

    const modified = (path: string): FileStatus =>
        ({ path, status: 'modified', remoteContent: 'a', localContent: 'b' });

    it('opens a new tab when no pane exists yet', async () => {
        const { view, getLeaf, newLeaf } = makeView();

        await internals(view).openDiffPane(modified('a.md'));

        expect(getLeaf).toHaveBeenCalledWith('tab');
        expect(newLeaf.setViewState).toHaveBeenCalledWith({ type: SYNC_DIFF_VIEW_TYPE, active: true });
    });

    // Reuse is what keeps the pane wherever the user dragged it, and stops a
    // pane piling up per file.
    it('reuses the existing pane instead of opening another', async () => {
        const existing = makeDiffView();
        const { view, getLeaf } = makeView([existing]);

        await internals(view).openDiffPane(modified('b.md'));

        expect(getLeaf).not.toHaveBeenCalled();
        expect(existing.getPath()).toBe('b.md');
    });

    it('loads a moved file\'s old remote path for comparison', async () => {
        const { view } = makeView();
        const getBlob = vi.fn().mockResolvedValue({ content: 'before move' });
        view.plugin.gitService.getBlob = getBlob;
        const moved = { path: 'new.md', status: 'moved' as const, movedFrom: 'old.md', remoteSha: 'old-sha', localContent: 'after move' };

        await internals(view).openDiffPane(moved);

        expect(getBlob).toHaveBeenCalledWith('old-sha', 'old.md');
    });

    it('closes the pane when the file it shows is pushed', async () => {
        const existing = makeDiffView();
        await existing.onOpen();
        existing.setDiff(modified('a.md'));
        const { view, leaves } = makeView([existing]);

        internals(view).closeDiffPaneFor(['a.md']);

        expect(leaves[0]?.detach).toHaveBeenCalled();
    });

    it('leaves a pane showing an unrelated file alone', async () => {
        const existing = makeDiffView();
        await existing.onOpen();
        existing.setDiff(modified('a.md'));
        const { view, leaves } = makeView([existing]);

        internals(view).closeDiffPaneFor(['other.md']);

        expect(leaves[0]?.detach).not.toHaveBeenCalled();
    });
});
