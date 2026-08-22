import { ItemView, WorkspaceLeaf, debounce } from 'obsidian';
import GitLabFilesPush from '../../main';
import { t } from '../../i18n';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import { SourceControlView, type SourceControlViewCallbacks } from './SourceControlView';

// Reuses the legacy sync-status view's registered type string so an already
// open/pinned leaf from before this cutover resolves into the new view
// instead of Obsidian showing an "unrecognized view type" placeholder.
export const SOURCE_CONTROL_VIEW_TYPE = 'sync-status-view';

/**
 * Obsidian `ItemView` host for `SourceControlView` (Phase 3). Owns nothing
 * beyond render lifecycle and live-refresh wiring -- all sync state and
 * action handling live in `SourceControlViewModel` / `SourceControlActionService`
 * (Phase 1/2), reached only through `plugin.sourceControl*`, per
 * docs/source-control-refactor/phase-4-legacy-cleanup.md.
 */
export class SourceControlItemView extends ItemView {
    private static readonly RENDER_THROTTLE_MS = 150;
    private readonly view: SourceControlView;
    private unsubscribeStatuses?: () => void;
    private readonly renderOnStatusChange = debounce(
        () => this.renderView(),
        SourceControlItemView.RENDER_THROTTLE_MS,
        false,
    );

    constructor(leaf: WorkspaceLeaf, private readonly plugin: GitLabFilesPush) {
        super(leaf);
        const callbacks: SourceControlViewCallbacks = {
            onPush: (changeIds) => this.runAction(this.plugin.sourceControlActions.push(changeIds)),
            loadDiffContent: (item: SourceControlItem) => this.plugin.sourceControlActions.loadDiffContent(item),
        };
        this.view = new SourceControlView(
            this.plugin.sourceControlViewModel,
            callbacks,
        );
    }

    getViewType(): string { return SOURCE_CONTROL_VIEW_TYPE; }
    getDisplayText(): string { return t('sourceControl.viewTitle'); }
    getIcon(): string { return 'git-compare'; }

    onOpen(): Promise<void> {
        this.unsubscribeStatuses = this.plugin.sync.status.subscribe(() => this.renderOnStatusChange());
        this.renderView();
        return Promise.resolve();
    }

    onClose(): Promise<void> {
        this.unsubscribeStatuses?.();
        this.unsubscribeStatuses = undefined;
        return Promise.resolve();
    }

    private renderView(): void {
        const container = this.containerEl.children[1] as HTMLElement | null;
        if (container) this.view.render(container);
    }

    /**
     * `SourceControlActionService` marks each targeted change 'running'
     * synchronously before its first internal `await` (see
     * `SourceControlActionService.startAll`), so by the time the promise it
     * returns has been constructed, that state is already visible to the
     * next render -- render immediately to reflect it, then again once the
     * operation settles. A successful push/pull also updates
     * `plugin.sync.status` (via `SyncMetadataStore.update`), which re-renders
     * through the subscription above; the explicit re-render here is what
     * covers the failure path, where nothing else republishes status.
     */
    private runAction(action: Promise<unknown>): void {
        this.renderView();
        void action.finally(() => this.renderView());
    }
}
