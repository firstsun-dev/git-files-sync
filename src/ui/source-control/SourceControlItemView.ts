import { ItemView, Platform, TFile, WorkspaceLeaf, debounce } from 'obsidian';
import GitLabFilesPush from '../../main';
import { t } from '../../i18n';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import { SourceControlView, type SourceControlViewCallbacks } from './SourceControlView';
import type { SourceControlWorkspaceInfo } from './SourceControlHeader';
import { cheapLocalStat, computeDiffStat, type ChangeStat } from './ChangePresentation';

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
    /** Guards against a slower diff load finishing after a later click and clobbering it in the main-area tab. */
    private diffTabRequestSeq = 0;

    constructor(leaf: WorkspaceLeaf, private readonly plugin: GitLabFilesPush) {
        super(leaf);
        const callbacks: SourceControlViewCallbacks = {
            onSync: (changeIds) => this.runAction(this.plugin.sourceControlActions.sync(changeIds)),
            onPull: (changeIds) => this.runAction(this.plugin.sourceControlActions.pull(changeIds)),
            onDownload: (item) => this.runAction(this.plugin.sourceControlActions.pull([item.id])),
            onRefresh: () => this.runRefresh(),
            loadDiffContent: (item: SourceControlItem) => this.plugin.sourceControlActions.loadDiffContent(item),
            // Local-only stat is a cheap in-memory read (no provider call):
            // additions = local line count, no deletions. Two-sided changes
            // reuse the diff content already fetched for the diff pane and
            // derive the stat from the LCS ops, so no extra round-trip.
            loadDiffStat: (item: SourceControlItem) => this.loadDiffStat(item),
            // Desktop: the panel is a narrow sidebar, so the diff opens in a
            // full-width main-area tab instead of splitting that sidebar.
            // Mobile keeps its own in-panel detail view (SourceControlView).
            onOpenDiff: (item) => { if (!Platform.isMobile) void this.openDesktopDiffTab(item); },
            onOpenLocalFile: (item) => this.openLocalFile(item.path),
            onOpenRemoteFile: (item) => this.openRemoteFile(item.path),
        };
        this.view = new SourceControlView(
            this.plugin.sourceControlViewModel,
            callbacks,
            () => this.getWorkspaceInfo(),
        );
    }

    private async openDesktopDiffTab(item: SourceControlItem): Promise<void> {
        const requestId = ++this.diffTabRequestSeq;
        const content = await this.plugin.sourceControlActions.loadDiffContent(item);
        if (requestId !== this.diffTabRequestSeq) return;
        await this.plugin.openDiffTab(item.path, content);
    }

    private openLocalFile(path: string): void {
        const file = this.app.vault.getFileByPath(path);
        if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
    }

    private openRemoteFile(path: string): void {
        const url = this.plugin.syncWorkspace.getRemoteFileUrl(path);
        if (url) window.open(url, '_blank');
    }

    /**
     * Resolves the +/- diff stat for a change row. `local-only` reads the
     * already-in-memory local content from `sync.status` (no I/O, no provider
     * call) and counts its lines. All other kinds reuse the diff content the
     * diff pane would fetch and derive additions/deletions from the LCS ops.
     */
    private async loadDiffStat(item: SourceControlItem): Promise<ChangeStat | null> {
        if (item.kind === 'local-only') {
            const raw = this.plugin.sync.status.get(item.path)?.localContent;
            // Binary files (ArrayBuffer) have no meaningful line count; skip them.
            if (typeof raw !== 'string') return null;
            return cheapLocalStat(raw);
        }
        const content = await this.plugin.sourceControlActions.loadDiffContent(item);
        if (!content) return null;
        return computeDiffStat(content.remote, content.local);
    }

    private getWorkspaceInfo(): SourceControlWorkspaceInfo {
        const info = this.plugin.syncWorkspace.getInfo();
        const lastSyncTime = Object.values(this.plugin.settings.syncMetadata)
            .reduce((latest, metadata) => Math.max(latest, metadata.lastSyncedAt), 0);
        const lastCheckedAt = this.plugin.refreshState.getLastCheckedAt();
        return { ...info, lastSyncTime, lastCheckedAt };
    }

    getViewType(): string { return SOURCE_CONTROL_VIEW_TYPE; }
    getDisplayText(): string { return t('syncStatus.viewTitle'); }
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
    private runAction(action: Promise<void>): Promise<void> {
        this.renderView();
        return action.finally(() => this.renderView());
    }

    /**
     * Refresh reuses the same render-then-settle pattern as {@link runAction},
     * but the ViewModel's refresh() sets its `RefreshState` to 'loading'
     * synchronously (before the first `await`), so the immediate render shows
     * "Refreshing…". The settle render projects 'idle' on success or
     * 'failed' on rejection. The rejection is swallowed here so a failed
     * refresh surfaces as the button's failed state rather than an unhandled
     * rejection — the state was already recorded on the `RefreshState` holder.
     */
    private runRefresh(): void {
        const refresh = this.plugin.sourceControlViewModel.refresh();
        this.renderView();
        void refresh.then(() => this.renderView(), () => this.renderView());
    }
}
