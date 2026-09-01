import { ItemView, Platform, TFile, WorkspaceLeaf, debounce } from 'obsidian';
import GitLabFilesPush from '../../main';
import { t } from '../../i18n';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import { resolveSyncAction } from '../../logic/source-control/ChangeActionPolicy';
import type { FileStatus } from '../../logic/sync-status-service';
import { toChangeId } from '../../logic/source-control/types';
import { SourceControlView, type SourceControlViewCallbacks } from './SourceControlView';
import type { SourceControlWorkspaceInfo } from './SourceControlHeader';
import { addedContentStat, cheapLocalStat, computeDiffStat, deletedContentStat } from './ChangePresentation';
import type { DiffStatLoadResult } from './DiffStatProvider';

// Reuses the legacy sync-status view's registered type string so an already
// open/pinned leaf from before this cutover resolves into the new view
// instead of Obsidian showing an "unrecognized view type" placeholder.
// Keeping that type means only ONE leaf of it may exist workspace-wide;
// enforcing that singleton invariant (deduping legacy persisted duplicates,
// guarding concurrent activation) is a workspace-lifecycle concern owned by
// the plugin (main.ts), not by this view or its view model.
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
    /** Last published diff-stat backing snapshot per path, so a live status update can invalidate only the affected rows' stats. */
    private readonly lastStatusSnapshots = new Map<string, DiffStatFingerprint>();

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

    /**
     * Bridges domain status lifecycle → presentation cache: when a republished
     * status map changes anything a row's diff stat depends on (local content,
     * remote content/SHA, status classification, move source, symlink flag),
     * only that path's row drops its cached diff stat so it recomputes on the
     * next load pass. Paths that dropped out of the map entirely (published
     * over, row removed) get their snapshot cleared so a later path re-publish
     * is treated as fresh. The domain service is never imported by the
     * provider — this view owns the subscription boundary.
     */
    private onStatusesPublished(statuses: ReadonlyMap<string, FileStatus>): void {
        for (const [path, status] of statuses) {
            const previous = this.lastStatusSnapshots.get(path);
            this.lastStatusSnapshots.set(path, statusDiffStatSnapshot(status));
            if (previous !== undefined && hasDiffStatBackingChanged(previous, status)) {
                this.view.invalidateDiffStat(toChangeId(path));
                this.refreshOpenDiffTab(path);
            }
        }
        // Statuses removed from the map (bulk replace / republish): drop
        // their snapshots so a future re-appearance isn't compared against
        // pre-removal data.
        if (this.lastStatusSnapshots.size > statuses.size) {
            for (const path of this.lastStatusSnapshots.keys()) {
                if (!statuses.has(path)) {
                    this.lastStatusSnapshots.delete(path);
                    this.refreshOpenDiffTab(path);
                }
            }
        }
    }

    /**
     * Refreshes the open desktop diff tab when the statuses it was rendered
     * from changed underneath it (e.g. after a Keep Remote resolution the
     * pane must show the new synced parity instead of the stale conflict
     * sides). Mobile's in-panel diff re-renders through the debounced status
     * subscription; this covers the main-area tab, which nothing else
     * re-renders. Re-runs the same loaded-content pipeline as the initial
     * open, preserving its stale-response guard; a null result (binary gone,
     * row gone) clears the pane rather than leaving contradictory sides up.
     */
    private refreshOpenDiffTab(path: string): void {
        const openPath = this.plugin.diffTabPath?.();
        if (!openPath || openPath !== path) return;
        const requestId = ++this.diffTabRequestSeq;
        void (async () => {
            // Project the repository row into the full item shape the diff
            // loader consumes; the repo row dropped means the change is gone
            // and the pane clears rather than showing contradictory sides.
            const change = this.plugin.changeRepository.getById(toChangeId(path));
            if (!change) {
                await this.plugin.openDiffTab(path, null);
                return;
            }
            const item: SourceControlItem = {
                ...change,
                isSelectedForSync: false,
                operationStatus: 'idle',
                syncAction: resolveSyncAction(change.kind),
                hasActionOverride: false,
            };
            const content = await this.plugin.sourceControlActions.loadDiffContent(item);
            if (requestId !== this.diffTabRequestSeq) return;
            await this.plugin.openDiffTab(path, content);
        })();
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
     * call) and counts its lines — content that hasn't been read yet reports
     * `pending` (so the provider retries later) rather than a permanent
     * unavailable. Binary `ArrayBuffer` content has no meaningful line count
     * and is `unavailable`, as are two-sided changes whose diff content can't
     * be fetched. Other kinds reuse the diff content the diff pane would
     * fetch, with one-sided UX direction applied (`remote-only` = +N,
     * `local-deleted` = -N) instead of the raw side-vs-side diff.
     */
    private async loadDiffStat(item: SourceControlItem): Promise<DiffStatLoadResult> {
        if (item.kind === 'local-only') {
            const raw = this.plugin.sync.status.get(item.path)?.localContent;
            if (raw === undefined) return { status: 'pending' };
            // Binary files (ArrayBuffer) have no meaningful line count; skip them.
            if (typeof raw !== 'string') return { status: 'unavailable' };
            return { status: 'ready', stat: cheapLocalStat(raw) };
        }
        const content = await this.plugin.sourceControlActions.loadDiffContent(item);
        if (!content) return { status: 'unavailable' };
        // One-sided changes must not lean on computeDiffStat: both
        // `remote-only` (↓) and `local-deleted` (D) produce a FileDiff with
        // local='' / remote=content, which a plain content-vs-'' diff counts
        // as -N for BOTH — but the UX semantics are ↓ = +N (lines you'd gain
        // by downloading) and D = -N (lines you'd lose by pushing the
        // deletion). The diff pane keeps its download-oriented sides; only
        // the stat is directional.
        if (item.kind === 'remote-only' && typeof content.remote === 'string') {
            return { status: 'ready', stat: addedContentStat(content.remote) };
        }
        if (item.kind === 'local-deleted' && typeof content.remote === 'string') {
            return { status: 'ready', stat: deletedContentStat(content.remote) };
        }
        return { status: 'ready', stat: computeDiffStat(content.remote, content.local) };
    }

    private getWorkspaceInfo(): SourceControlWorkspaceInfo {
        const info = this.plugin.syncWorkspace.getInfo();
        const lastSyncTime = Object.values(this.plugin.settings.syncMetadata)
            .reduce((latest, metadata) => Math.max(latest, metadata.lastSyncedAt), 0);
        const lastCheckedAt = this.plugin.refreshState.getLastCheckedAt();
        return { ...info, lastSyncTime, lastCheckedAt };
    }

    getViewType(): string { return SOURCE_CONTROL_VIEW_TYPE; }
    getDisplayText(): string { return t('sourceControl.viewTitle'); }
    getIcon(): string { return 'git-compare'; }

    onOpen(): Promise<void> {
        this.unsubscribeStatuses = this.plugin.sync.status.subscribe((statuses) => {
            this.onStatusesPublished(statuses);
            this.renderOnStatusChange();
        });
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

/** Everything a row's diff stat depends on, snapshotted per publish for change detection. */
type StatusContent = FileStatus['localContent'];

interface DiffStatFingerprint {
    status: FileStatus['status'];
    localContent: StatusContent;
    remoteContent: StatusContent;
    remoteSha: string | undefined;
    movedFrom: string | undefined;
    isSymlink: boolean | undefined;
}

function statusDiffStatSnapshot(status: FileStatus): DiffStatFingerprint {
    return {
        status: status.status,
        localContent: status.localContent,
        remoteContent: status.remoteContent,
        remoteSha: status.remoteSha,
        movedFrom: status.movedFrom,
        isSymlink: status.isSymlink,
    };
}

/**
 * Whether anything the row's diff stat depends on changed between two
 * publishes. Large strings are compared by shallow re-check, not hashed and
 * not JSON-stringified: content references are compared first (a republish
 * usually carries identical values), falling back to an exact-equality
 * check only when a new object identity arrived — a full string scan is
 * still far cheaper than re-deriving the stat.
 */
function hasDiffStatBackingChanged(previous: DiffStatFingerprint, current: FileStatus): boolean {
    return previous.status !== current.status
        || changed(previous.localContent, current.localContent)
        || changed(previous.remoteContent, current.remoteContent)
        || previous.remoteSha !== current.remoteSha
        || previous.movedFrom !== current.movedFrom
        || previous.isSymlink !== current.isSymlink;
}

function changed(a: StatusContent, b: StatusContent): boolean {
    if (a === b) return false;
    if (a === undefined || b === undefined) return true;
    return a !== b;
}
