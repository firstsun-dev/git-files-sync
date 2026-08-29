import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TFile, WorkspaceLeaf } from 'obsidian';
import { SourceControlItemView, SOURCE_CONTROL_VIEW_TYPE } from '../../../src/ui/source-control/SourceControlItemView';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { RefreshState } from '../../../src/logic/source-control/RefreshState';
import { SyncSelectionStore } from '../../../src/logic/source-control/SyncSelectionStore';
import { SourceControlViewModel } from '../../../src/logic/source-control/SourceControlViewModel';
import { toChangeId, type SyncChangeKind } from '../../../src/logic/source-control/types';
import { SyncStatusService } from '../../../src/logic/sync-status-service';
import type GitLabFilesPush from '../../../src/main';
import { setupObsidianDOM } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

function buildPlugin(kind: SyncChangeKind = 'local-only') {
    const repository = new ChangeRepository();
    repository.replace([{ id: toChangeId('a.md'), path: 'a.md', kind }]);
    const selection = new SyncSelectionStore();
    const operations = new OperationState();
    const refreshState = new RefreshState();
    const viewModel = new SourceControlViewModel(repository, selection, operations, vi.fn().mockResolvedValue(undefined), refreshState);
    const sync = vi.fn().mockResolvedValue(undefined);
    const push = vi.fn().mockResolvedValue(undefined);
    const pull = vi.fn().mockResolvedValue(undefined);
    const deleteRemote = vi.fn().mockResolvedValue(undefined);
    const loadDiffContent = vi.fn().mockResolvedValue({ remote: 'remote text', local: 'local text' });
    const openDiffTab = vi.fn().mockResolvedValue(undefined);
    const getRemoteFileUrl = vi.fn().mockReturnValue('https://github.com/owner/repo/blob/main/a.md');
    const status = new SyncStatusService();

    const plugin = {
        changeRepository: repository,
        pushSelectionStore: selection,
        operationState: operations,
        sourceControlViewModel: viewModel,
        sourceControlActions: { sync, push, pull, deleteRemote, loadDiffContent },
        sync: { status },
        syncWorkspace: { getInfo: () => ({ serviceName: 'GitHub', branch: 'main', vaultFolder: '' }), getRemoteFileUrl },
        settings: { syncMetadata: {} },
        refreshState,
        openDiffTab,
    } as unknown as GitLabFilesPush;

    return { plugin, repository, selection, sync, push, pull, deleteRemote, loadDiffContent, openDiffTab, getRemoteFileUrl, status };
}

function buildLeaf() {
    const openFile = vi.fn();
    const app = {
        vault: { getFileByPath: vi.fn().mockReturnValue(null) },
        workspace: { getLeaf: vi.fn().mockReturnValue({ openFile }) },
    };
    return { leaf: { app } as unknown as WorkspaceLeaf, app, openFile };
}

describe('SourceControlItemView', () => {
    it('registers under the legacy sync-status-view type so existing saved leaves resolve', () => {
        const { plugin } = buildPlugin();
        const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);

        expect(view.getViewType()).toBe(SOURCE_CONTROL_VIEW_TYPE);
        expect(SOURCE_CONTROL_VIEW_TYPE).toBe('sync-status-view');
    });

    it('renders the Source Control tree on open', async () => {
        const { plugin } = buildPlugin();
        const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);

        await view.onOpen();

        const container = view.containerEl.children[1] as HTMLElement;
        expect(container.querySelector('.scv-change-item')).not.toBeNull();
    });

    it('forwards Sync Queue clicks to SourceControlActionService.sync, never touching a Git provider directly', async () => {
        const { plugin, selection, sync } = buildPlugin();
        selection.selectForSync(toChangeId('a.md'));
        const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as HTMLElement;
        (container.querySelector('.scv-push-btn') as HTMLButtonElement).click();

        expect(sync).toHaveBeenCalledWith([toChangeId('a.md')]);
    });

    it('waits for sync to settle through the production runAction wiring before re-rendering (regression: runAction used to discard the action promise)', async () => {
        const { plugin, repository, selection, sync } = buildPlugin('local-only');
        repository.replace([
            { id: toChangeId('a.md'), path: 'a.md', kind: 'local-only' },
            { id: toChangeId('b.md'), path: 'b.md', kind: 'remote-only' },
        ]);
        selection.selectForSync(toChangeId('a.md'));
        selection.selectForSync(toChangeId('b.md'));

        let resolveSync!: () => void;
        sync.mockReturnValue(new Promise<void>(resolve => { resolveSync = resolve; }));

        const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as HTMLElement;
        (container.querySelector('.scv-push-btn') as HTMLButtonElement).click();

        expect(sync).toHaveBeenCalledWith([toChangeId('a.md'), toChangeId('b.md')]);

        resolveSync();
        await new Promise(resolve => window.setTimeout(resolve, 0));
        expect(sync).toHaveBeenCalledTimes(1);
    });

    it('forwards refresh clicks to the ViewModel refresh delegate', async () => {
        const { plugin } = buildPlugin();
        const refreshSpy = vi.spyOn(plugin.sourceControlViewModel, 'refresh').mockResolvedValue(undefined);
        const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as HTMLElement;
        (container.querySelector('.scv-refresh-btn') as HTMLButtonElement).click();
        await Promise.resolve();

        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('re-renders when the shared SyncStatusService publishes a change', async () => {
        const { plugin, repository, status } = buildPlugin();
        const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);
        await view.onOpen();

        repository.replace([
            { id: toChangeId('a.md'), path: 'a.md', kind: 'local-only' },
            { id: toChangeId('b.md'), path: 'b.md', kind: 'remote-only' },
        ]);
        status.set({ path: 'b.md', status: 'remote-only' });
        // Render is debounced (150ms) to match the previous sync-status view's throttle.
        await new Promise(resolve => window.setTimeout(resolve, 200));

        // The "all" filter groups every change into every section it matches
        // (e.g. a remote-only change appears under both CHANGES and REMOTE
        // CHANGES), so assert distinct ids rather than raw row count.
        const container = view.containerEl.children[1] as HTMLElement;
        const ids = new Set(
            Array.from(container.querySelectorAll('.scv-change-item')).map(el => el.getAttribute('data-change-id')),
        );
        expect(ids).toEqual(new Set(['a.md', 'b.md']));
    });

    it('opens a change diff in the main-area tab via plugin.openDiffTab on desktop', async () => {
        // local-modified (not local-only/remote-only) has a real diff to show.
        const { plugin, loadDiffContent, openDiffTab } = buildPlugin('local-modified');
        const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as HTMLElement;
        (container.querySelector('.scv-change-item') as HTMLElement).click();
        await Promise.resolve();
        await Promise.resolve();

        expect(loadDiffContent).toHaveBeenCalledWith(expect.objectContaining({ id: toChangeId('a.md') }));
        expect(openDiffTab).toHaveBeenCalledWith('a.md', { remote: 'remote text', local: 'local text' });
    });

    it('opens the local file directly for a local-only change (nothing to diff against)', async () => {
        const { plugin, openDiffTab } = buildPlugin('local-only');
        const { leaf, app, openFile } = buildLeaf();
        const file = Object.assign(new TFile(), { path: 'a.md' });
        (app.vault.getFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(file);
        const view = new SourceControlItemView(leaf, plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as HTMLElement;
        (container.querySelector('.scv-change-item') as HTMLElement).click();

        expect(app.vault.getFileByPath).toHaveBeenCalledWith('a.md');
        expect(openFile).toHaveBeenCalledWith(file);
        expect(openDiffTab).not.toHaveBeenCalled();
    });

    it('opens the remote file in the browser for a remote-only change (nothing local to diff against)', async () => {
        // Capturing window.open reads an unbound method by necessity (save/
        // restore around the stub); the mock never relies on Window's `this`.
        // eslint-disable-next-line @typescript-eslint/unbound-method -- mocking a Window builtin requires capturing the unbound original
        const originalOpen = window.open;
        const windowOpen = vi.fn<(url: string, target: string) => void>();
        window.open = ((_url: string | URL, _target?: string) => {
            windowOpen((_url as string), (_target as string));
        }) as typeof window.open;
        try {
            const { plugin, getRemoteFileUrl, openDiffTab } = buildPlugin('remote-only');
            const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);
            await view.onOpen();

            const container = view.containerEl.children[1] as HTMLElement;
            (container.querySelector('.scv-change-item') as HTMLElement).click();

            expect(getRemoteFileUrl).toHaveBeenCalledWith('a.md');
            expect(windowOpen).toHaveBeenCalledWith('https://github.com/owner/repo/blob/main/a.md', '_blank');
            expect(openDiffTab).not.toHaveBeenCalled();
        } finally {
            window.open = originalOpen;
        }
    });

    it('stops re-rendering once closed', async () => {
        const { plugin, status } = buildPlugin();
        const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);
        await view.onOpen();
        await view.onClose();

        expect(() => status.set({ path: 'z.md', status: 'synced' })).not.toThrow();
    });
});
