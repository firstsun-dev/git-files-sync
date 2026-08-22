import { beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkspaceLeaf } from 'obsidian';
import { SourceControlItemView, SOURCE_CONTROL_VIEW_TYPE } from '../../../src/ui/source-control/SourceControlItemView';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { SourceControlViewModel } from '../../../src/logic/source-control/SourceControlViewModel';
import { SourceControlState } from '../../../src/logic/source-control/state/SourceControlState';
import { OperationState } from '../../../src/logic/source-control/state/OperationState';
import { SelectionState } from '../../../src/logic/source-control/state/SelectionState';
import { toChangeId } from '../../../src/logic/source-control/types';
import { SyncStatusService } from '../../../src/logic/sync-status-service';
import type GitLabFilesPush from '../../../src/main';
import { setupObsidianDOM } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

function buildPlugin() {
    const repository = new ChangeRepository();
    repository.replace([{ id: toChangeId('a.md'), path: 'a.md', kind: 'local-only' }]);
    const selection = new SelectionState();
    const operations = new OperationState();
    const state = new SourceControlState(repository, selection, operations);
    const viewModel = new SourceControlViewModel(state);
    const push = vi.fn().mockResolvedValue(undefined);
    const loadDiffContent = vi.fn().mockResolvedValue(null);
    const status = new SyncStatusService();

    const plugin = {
        changeRepository: repository,
        sourceControlState: state,
        sourceControlViewModel: viewModel,
        sourceControlActions: { push, loadDiffContent },
        sync: { status },
    } as unknown as GitLabFilesPush;

    return { plugin, repository, selection, push, status };
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

    it('forwards push clicks to SourceControlActionService.push, never touching a Git provider directly', async () => {
        const { plugin, selection, push } = buildPlugin();
        selection.includeForPush(toChangeId('a.md'));
        const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as HTMLElement;
        (container.querySelector('.scv-push-btn') as HTMLButtonElement).click();

        expect(push).toHaveBeenCalledWith([toChangeId('a.md')]);
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
        await new Promise(resolve => setTimeout(resolve, 200));

        // The "all" filter groups every change into every section it matches
        // (e.g. a remote-only change appears under both CHANGES and REMOTE
        // CHANGES), so assert distinct ids rather than raw row count.
        const container = view.containerEl.children[1] as HTMLElement;
        const ids = new Set(
            Array.from(container.querySelectorAll('.scv-change-item')).map(el => el.getAttribute('data-change-id')),
        );
        expect(ids).toEqual(new Set(['a.md', 'b.md']));
    });

    it('stops re-rendering once closed', async () => {
        const { plugin, status } = buildPlugin();
        const view = new SourceControlItemView({} as WorkspaceLeaf, plugin);
        await view.onOpen();
        await view.onClose();

        expect(() => status.set({ path: 'z.md', status: 'synced' })).not.toThrow();
    });
});
