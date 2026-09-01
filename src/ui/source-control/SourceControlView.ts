import { debounce, Platform, setIcon, setTooltip } from 'obsidian';
import { t } from '../../i18n';
import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';
import { SourceControlViewModel, type SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeId } from '../../logic/source-control/types';
import { defaultSyncAction } from '../../logic/source-control/ChangeActionPolicy';
import { ICONS } from '../components/icons';
import { renderDiffViewer, currentDiffLayout, rememberDiffLayout, type DiffViewerHandle } from '../components/DiffViewer';
import { renderChangeTree, renderChangeList, type ChangeTreeCallbacks } from './ChangeTree';
import { renderChangeItem } from './ChangeItem';
import { DiffStatProvider, type DiffStatLoadResult } from './DiffStatProvider';
import { renderFilterMenu } from './FilterMenu';
import { renderSourceControlHeader, type SourceControlWorkspaceInfo } from './SourceControlHeader';

export interface SourceControlDiffContent {
    remote: string;
    local: string;
}

export interface SourceControlViewCallbacks {
    /**
     * Hands the whole Sync Queue's intent off to whatever wires this view to
     * the sync pipeline — one call per Sync button click, regardless of how
     * many of the queued changes are pushes, pulls, or remote deletions.
     * Never called by the UI directly against a Git provider; the plan
     * building, single confirm, and single commit all happen behind this
     * one call (`SourceControlActionService.sync()`).
     */
    onSync: (changeIds: ChangeId[]) => void | Promise<void>;
    /**
     * Pulls one or more changes — used only by the inline per-row Download
     * button (a single `remote-only`/`local-deleted` row), not by the Sync
     * Queue button.
     */
    onPull?: (changeIds: ChangeId[]) => void | Promise<void>;
    /** Triggers a view-wide refresh; the host wires this to the ViewModel's refresh delegate. */
    onRefresh: () => void;
    /** Notified when a change is selected for diff viewing, in addition to this view's own diff pane rendering. */
    onOpenDiff?: (item: SourceControlItem) => void | Promise<void>;
    /** Supplies diff content for the selected change; omit to leave the diff pane empty. */
    loadDiffContent?: (item: SourceControlItem) => Promise<SourceControlDiffContent | null>;
    /**
     * A `local-only` change has nothing on the remote to diff against, so
     * clicking it opens the file itself instead of an empty diff view.
     */
    onOpenLocalFile?: (item: SourceControlItem) => void | Promise<void>;
    /**
     * A `remote-only` change has nothing local to diff against, so clicking
     * it opens the file on the remote (in the browser) instead.
     */
    onOpenRemoteFile?: (item: SourceControlItem) => void | Promise<void>;
    /**
     * Pulls a single change into the local vault — the inline Download
     * button on a `remote-only` (add it locally) or `local-deleted` (restore
     * it locally) row. Wired to the same pull primitive as {@link onPull};
     * exposed separately so a one-off download doesn't need to go through
     * the Sync Queue.
     */
    onDownload?: (item: SourceControlItem) => void | Promise<void>;
    /**
     * Supplies the +/- diff stat for a change row. See
     * {@link DiffStatLoadResult} for the ready/pending/unavailable contract.
     * The view's provider caches results and clears them on refresh. Omit to
     * leave rows without a stat.
     */
    loadDiffStat?: (item: SourceControlItem) => Promise<DiffStatLoadResult>;
}

/** Tree shaping so the change tree stays a compact change view, not a full Explorer. */
const TREE_OPTIONS = { collapseSingleChild: true };
/** Mobile tree: collapse single-child folders and cap depth so the tree stays flat on a phone. */
const MOBILE_TREE_OPTIONS = { collapseSingleChild: true, maxDepth: 2 };

/**
 * Scroll positions of the main list's independently-scrolling regions,
 * persisted at View level so the mobile list → detail → Back round trip
 * restores position (a single-render capture can't survive the DOM being
 * replaced by the detail view).
 */
interface MainScrollState {
    repository: number;
    queue: number;
}

/**
 * Composes the Source Control UI (Header, Filter, change tree, Diff panel)
 * from `SourceControlViewModel` state, per
 * docs/source-control-refactor/phase-3-source-control-ui.md.
 *
 * Pure presentation + wiring: push/diff intent is handed to injected
 * callbacks rather than acted on directly here, so this layer never reaches
 * past the ViewModel to `SyncManager`/a Git provider. Selection toggling goes
 * through `viewModel.selection` (the `SyncSelectionStore`, exposed by the
 * ViewModel) so the view holds no selection reference of its own and the
 * batch ops (`toggle`/`toggleMany`) live on the store, not inline here.
 *
 * Rendering semantics (status-grouping fix):
 * - Every filter chip renders a single flat tree (or list). "All" composes
 *   the actionable set with the synced bucket (a view-layer composition; the
 *   domain `all` filter still returns actionable rows only), so a change
 *   never appears twice.
 * - Synced is surfaced via its own "Synced" chip and included under "All"
 *   (both opt-in); the default "Needs Sync" chip keeps a quiet workspace
 *   quiet by showing actionable rows only.
 * - The two regions carry distinct role labels instead of just stacking:
 *   a "SYNC QUEUE" region (the working push batch, always a flat list)
 *   above a "Repository Changes" region (the source to pick from, with a
 *   Tree/List view toggle). Checking a repository row moves it up into the
 *   queue and out of the repository view; unchecking it there moves it back
 *   down — mirroring VS Code's Staged/Changes split so a change never
 *   appears in both places at once.
 */
export class SourceControlView {
    /** Active chip, as (domain filter, showSynced). Defaults to "Needs Sync" — the actionable set — so a quiet workspace stays quiet. */
    private filter: SourceControlFilter = 'all';
    private showSynced = false;
    private searchQuery = '';
    /** Repository Changes view: folder tree (default) or flat list. List view trades nesting for a path suffix per row. */
    private viewMode: 'tree' | 'list' = 'tree';
    private readonly collapsedFolders = new Set<string>();
    /** Collapsed section regions ("Sync Queue" / "Repository Changes"), persisted across rerenders like collapsed folders. */
    private readonly collapsedSections = new Set<'checkedChanges' | 'changes'>();
    /** Mobile-only: the Sync Queue starts expanded (matching desktop) so queued changes are directly visible; tapping the header collapses it. */
    private mobileQueueCollapsed = false;
    private selectedChangeId: ChangeId | null = null;
    /** Owns the +/- diff-stat cache + background bounded loading + invalidation, isolating that data concern from rendering. */
    private readonly diffStat: DiffStatProvider<ChangeId, SourceControlItem>;
    /**
     * Navigation scroll state for the mobile list → detail transition. It is
     * captured only when navigating INTO a diff and consumed exactly once by
     * the Back transition's main render — regular rerenders (checkbox,
     * diff-stat settle, status updates) never touch it, so they restore
     * their own captured DOM scroll positions instead.
     */
    private mainScrollState: MainScrollState = { repository: 0, queue: 0 };
    /** Set on mobile Back; the next main render restores the navigation scroll + anchor once, then clears it. */
    private restoreNavigationScrollOnNextRender = false;
    /** The row the user navigated into the diff from; Back re-anchors to it after restoring scrollTop. */
    private navigationAnchorId: ChangeId | null = null;
    private container?: HTMLElement;
    private readonly applySearchDebounced = debounce(
        (value: string) => this.applySearch(value),
        150,
        false,
    );

    constructor(
        private readonly viewModel: SourceControlViewModel,
        private readonly callbacks: SourceControlViewCallbacks,
        private readonly getWorkspaceInfo: () => SourceControlWorkspaceInfo,
    ) {
        this.diffStat = new DiffStatProvider(callbacks.loadDiffStat, () => this.rerender(), item => item.kind === 'local-only');
    }

    /**
     * Independently-scrolling regions whose position must survive a
     * rerender (e.g. toggling a checkbox) instead of resetting to top, since
     * `render()` tears down and rebuilds the whole DOM every time.
     */
    private static readonly SCROLL_REGIONS = ['scv-changes-tree', 'scv-selected-section-list'];

    render(container: HTMLElement): void {
        const scrollState = this.captureScrollState(container);
        this.container = container;
        container.empty();
        container.addClass('scv-root');
        container.addClass('gfs-diff-surface');

        const isMobile = Platform.isMobile;
        container.toggleClass('scv-mobile', isMobile);
        container.toggleClass('scv-desktop', !isMobile);

        if (isMobile && this.selectedChangeId !== null) {
            this.renderDetail(container);
            this.restoreScrollState(container, scrollState);
            return;
        }

        const main = container.createDiv({ cls: 'scv-main' });
        this.renderMain(main);
        if (isMobile && this.restoreNavigationScrollOnNextRender) {
            // Back transition: restore the saved navigation scroll + anchor
            // exactly once. Ordinary rerenders take the captured-DOM path
            // below, so background stat settles don't re-anchor.
            this.restoreMainScrollState(container);
            this.restoreNavigationScrollOnNextRender = false;
        } else {
            this.restoreScrollState(container, scrollState);
        }
    }

    getFilter(): SourceControlFilter { return this.filter; }
    getSelectedChangeId(): ChangeId | null { return this.selectedChangeId; }

    /** Lets the host drop one row's cached diff stat when its backing content changed. */
    invalidateDiffStat(id: ChangeId): void {
        this.diffStat.invalidate(id);
    }

    private rerender(): void {
        if (this.container) this.render(this.container);
    }

    private captureScrollState(container: HTMLElement): Map<string, number> {
        const state = new Map<string, number>();
        for (const cls of SourceControlView.SCROLL_REGIONS) {
            const el = container.querySelector<HTMLElement>(`.${cls}`);
            if (el) state.set(cls, el.scrollTop);
        }
        return state;
    }

    private restoreScrollState(container: HTMLElement, state: Map<string, number>): void {
        for (const [cls, top] of state) {
            const el = container.querySelector<HTMLElement>(`.${cls}`);
            if (el) el.scrollTop = top;
        }
    }

    /** Copies the live DOM scroll positions into the View-level navigation state. */
    private captureMainScrollState(container: HTMLElement): void {
        this.mainScrollState = {
            repository: container.querySelector<HTMLElement>('.scv-changes-tree')?.scrollTop ?? 0,
            queue: container.querySelector<HTMLElement>('.scv-selected-section-list')?.scrollTop ?? 0,
        };
    }

    /**
     * Restores the persisted navigation scroll state after the Back main
     * render, then re-anchors to the row the diff was opened from — pixel
     * offsets alone may be stale if status/stat updates changed row heights
     * or ordering while the diff was open. Only runs on the Back transition;
     * the anchor lives for that single restore.
     */
    private restoreMainScrollState(container: HTMLElement): void {
        const tree = container.querySelector<HTMLElement>('.scv-changes-tree');
        if (tree) tree.scrollTop = this.mainScrollState.repository;
        const list = container.querySelector<HTMLElement>('.scv-selected-section-list');
        if (list) list.scrollTop = this.mainScrollState.queue;

        if (this.navigationAnchorId === null) return;
        const anchor = container.querySelector<HTMLElement>(`[data-change-id="${escapeChangeId(this.navigationAnchorId)}"]`);
        this.navigationAnchorId = null;
        if (!anchor || !tree) return;
        // Only correct the scroll when the anchor row fell outside the tree's
        // viewport — inside it, the pixel restore is already exact.
        const treeTop = tree.getBoundingClientRect().top;
        const anchorTop = anchor.getBoundingClientRect().top;
        const anchorBottom = anchor.getBoundingClientRect().bottom;
        if (anchorTop < treeTop || anchorBottom > treeTop + tree.clientHeight) {
            anchor.scrollIntoView({ block: 'nearest' });
        }
    }

    private renderMain(container: HTMLElement): void {
        const isMobile = Platform.isMobile;

        // Counts for the filter menu always carry the synced count (the menu
        // needs it for the All/Synced chips), so fetch them with showSynced
        // regardless of the active chip. The active chip's own tree items use
        // the per-chip getState call below.
        const counts = this.viewModel.getState('all', true).counts;
        const state = this.viewModel.getState(this.filter, this.showSynced);

        renderSourceControlHeader(
            container,
            {
                readyToPushCount: state.counts['ready-to-push'],
                workspaceInfo: this.getWorkspaceInfo(),
                refreshStatus: state.refreshStatus,
            },
            {
                onPush: () => void this.runSync(state.syncQueue),
                onRefresh: () => {
                    this.diffStat.clear();
                    this.callbacks.onRefresh();
                },
            },
            { isMobile, showPush: !isMobile },
        );

        this.renderSearchBox(container);

        const treeCallbacks: ChangeTreeCallbacks = {
            onToggleFolder: (path) => this.toggleFolder(path),
            onToggleSelect: (id, selected) => this.toggleSelect(id, selected),
            onToggleFolderSelect: (ids, selected) => this.toggleFolderSelect(ids, selected),
            onOpenDiff: (item) => this.openDiff(item),
            onDownload: (item) => this.download(item),
            getDiffStat: (id) => this.diffStat.get(id),
        };

        renderFilterMenu(
            container,
            { filter: this.filter, showSynced: this.showSynced },
            counts,
            { onFilterChange: (filter, showSynced) => { this.filter = filter; this.showSynced = showSynced; this.rerender(); } },
            { isMobile },
        );

        const query = this.searchQuery.trim().toLowerCase();
        // "All" chip composes the actionable set with the synced bucket — the
        // domain `all` filter only returns actionable rows, so the synced rows
        // are appended here in the view rather than via a domain change.
        let items = state.items;
        if (this.filter === 'all' && this.showSynced) {
            items = items.concat(this.viewModel.getState('synced', true).items);
        }
        const filtered = query ? items.filter(item => item.path.toLowerCase().includes(query)) : items;
        // Selected changes live in the "SYNC QUEUE" region above, so the
        // repository view below only carries the remaining (unchecked) rows:
        // a checked row disappears from here and reappears in the queue,
        // mirroring VS Code's Staged/Changes split instead of duplicating it.
        const unchecked = filtered.filter(item => !item.isSelectedForSync);

        // The scroll container: Sync Queue + Repository Changes header + tree
        // all live here so the whole lower region scrolls as one. Pinned
        // controls (header, search, filter) stay outside so they don't scroll
        // away; a tall Sync Queue section therefore scrolls with the
        // tree instead of blowing out the layout under
        // `.scv-root { overflow: hidden }`.
        const body = container.createDiv({ cls: 'scv-body' });
        this.renderSelectedSection(body, state.syncQueue, treeCallbacks);
        // The Changes region is its own flex/scroll area so a tall tree
        // scrolls independently and never pushes the pinned Sync Queue
        // region above it out of view.
        const changesRegion = body.createDiv({ cls: 'scv-changes-region' });
        this.renderRepositoryHeader(changesRegion, unchecked.length);
        if (!this.collapsedSections.has('changes')) {
            const treeWrap = changesRegion.createDiv({ cls: 'scv-changes-tree' });
            if (unchecked.length === 0) {
                treeWrap.createDiv({ cls: 'scv-empty', text: t('sourceControl.empty') });
            } else if (this.viewMode === 'list') {
                renderChangeList(treeWrap, unchecked, treeCallbacks);
            } else {
                renderChangeTree(treeWrap, unchecked, this.collapsedFolders, treeCallbacks, isMobile ? MOBILE_TREE_OPTIONS : TREE_OPTIONS);
            }
        }
        // Only rendered rows background-load their stats: a collapsed
        // Repository Changes section renders no tree, so hidden rows must
        // not fire provider fetches; expanding the section re-renders and
        // queues them then.
        if (!this.collapsedSections.has('changes')) this.diffStat.loadVisible(unchecked);
        // Same scoping for the queue region: desktop collapsed sections and
        // the mobile collapsed queue render no row lists.
        const queueRendered = isMobile ? !this.mobileQueueCollapsed : !this.collapsedSections.has('checkedChanges');
        if (queueRendered) this.diffStat.loadVisible(state.syncQueue);

        if (isMobile) this.renderMobileSyncBar(container, state.counts['ready-to-push'], state.syncQueue);
    }

    /**
     * Renders the path-filter search box. Kept as a normal part of the
     * `rerender()`-driven tree (rather than persisted across renders like the
     * legacy view did), so typing re-focuses the freshly rebuilt input and
     * restores its caret position instead of losing focus on every keystroke.
     */
    private renderSearchBox(container: HTMLElement): void {
        const row = container.createDiv({ cls: 'scv-search' });
        row.toggleClass('has-query', this.searchQuery.length > 0);
        setIcon(row.createSpan({ cls: 'scv-search-icon' }), ICONS.search);

        const input = row.createEl('input', {
            type: 'text',
            cls: 'scv-search-input',
            attr: { placeholder: t('sourceControl.search.placeholder'), spellcheck: 'false' },
        });
        input.value = this.searchQuery;

        const clear = row.createEl('button', { cls: 'scv-search-clear' });
        setIcon(clear, ICONS.clear);
        setTooltip(clear, t('sourceControl.search.clear'));

        input.addEventListener('input', () => this.applySearchDebounced(input.value));
        input.addEventListener('keydown', (evt) => {
            if (evt.key !== 'Escape' || input.value === '') return;
            evt.preventDefault();
            input.value = '';
            this.applySearchDebounced.cancel();
            this.applySearch('');
        });
        clear.addEventListener('click', () => {
            input.value = '';
            input.focus();
            this.applySearchDebounced.cancel();
            this.applySearch('');
        });
    }

    private applySearch(value: string): void {
        if (value === this.searchQuery) return;
        const focused = document.activeElement === this.container?.querySelector('.scv-search-input');
        const cursor = focused ? (this.container?.querySelector<HTMLInputElement>('.scv-search-input')?.selectionStart ?? null) : null;
        this.searchQuery = value;
        this.rerender();
        if (!focused) return;
        const newInput = this.container?.querySelector<HTMLInputElement>('.scv-search-input');
        if (!newInput) return;
        newInput.focus();
        if (cursor !== null) newInput.setSelectionRange(cursor, cursor);
    }

    /**
     * Renders the "Repository Changes (N)" header above the change tree/list.
     * A single role label (not the active filter name — the filter chips above
     * already carry that) makes the section's job — "navigate the source I can
     * pick from" — distinct from the Sync Queue's "what I'm about to push".
     * The whole header collapses/expands the region; the Tree/List view toggle
     * on the right stops propagation so switching presentation doesn't also
     * collapse the section.
     */
    private renderRepositoryHeader(container: HTMLElement, count: number): void {
        const collapsed = this.collapsedSections.has('changes');
        const header = container.createDiv({ cls: 'scv-repository-header scv-collapsible-header' });
        header.setAttr('role', 'button');
        header.setAttr('aria-expanded', String(!collapsed));
        header.createSpan({ cls: 'scv-section-toggle', text: collapsed ? '▶' : '▼' });
        header.createSpan({ cls: 'scv-repository-title', text: t('sourceControl.section.repositoryChanges') });
        header.createSpan({ cls: 'scv-repository-count', text: String(count) });
        header.addEventListener('click', () => this.toggleSection('changes'));
        this.renderViewToggle(header);
    }

    /**
     * Tree/List segmented toggle, scoped to the Repository Changes region only
     * (the Sync Queue is always a flat list, so it gets no such toggle). The
     * active mode is highlighted; clicks stop propagation so they don't also
     * collapse the section via the title area.
     */
    private renderViewToggle(container: HTMLElement): void {
        const toggle = container.createDiv({ cls: 'scv-view-toggle' });
        toggle.setAttr('role', 'group');
        toggle.setAttr('aria-label', t('sourceControl.view.toggleLabel'));
        for (const mode of ['tree', 'list'] as const) {
            const active = this.viewMode === mode;
            const btn = toggle.createEl('button', { cls: `scv-view-toggle-btn${active ? ' is-active' : ''}` });
            btn.setAttr('data-view', mode);
            btn.setAttr('aria-pressed', String(active));
            btn.setAttr('title', mode === 'tree' ? t('sourceControl.view.tree') : t('sourceControl.view.list'));
            setIcon(btn.createSpan({ cls: 'scv-view-toggle-icon' }), mode === 'tree' ? ICONS.viewTree : ICONS.viewList);
            btn.createSpan({ cls: 'scv-view-toggle-label', text: mode === 'tree' ? t('sourceControl.view.tree') : t('sourceControl.view.list') });
            btn.addEventListener('click', (evt) => { evt.stopPropagation(); this.setViewMode(mode); });
        }
    }

    private setViewMode(mode: 'tree' | 'list'): void {
        if (this.viewMode === mode) return;
        this.viewMode = mode;
        this.rerender();
    }

    private toggleSection(key: 'checkedChanges' | 'changes'): void {
        if (this.collapsedSections.has(key)) this.collapsedSections.delete(key);
        else this.collapsedSections.add(key);
        this.rerender();
    }

    /**
     * Renders the "SYNC QUEUE" region — the working push batch, a flat list
     * of the changes selected for sync. Each queued change is a normal change
     * row (badge + name + diff-stat) with its selection checkbox checked:
     * unchecking it here moves the row back down into the repository tree,
     * and checking a repository row moves it up here, so the queue and the
     * tree stay disjoint. The set comes straight from the ViewModel's
     * single-source `syncQueue` projection (same definition as the Sync
     * button count), so the section and the button can never drift.
     *
     * On mobile the queue renders expanded by default (same as desktop) so
     * the upcoming changes are directly visible without an extra tap; the
     * repository tree's own scroll region absorbs the height. Tapping the
     * header collapses it to a header bar (the bottom sync bar still carries
     * the count).
     */
    private renderSelectedSection(
        container: HTMLElement,
        syncQueue: readonly SourceControlItem[],
        callbacks: ChangeTreeCallbacks,
    ): void {
        if (syncQueue.length === 0) return;
        const isMobile = Platform.isMobile;
        const collapsed = isMobile ? this.mobileQueueCollapsed : this.collapsedSections.has('checkedChanges');
        const section = container.createDiv({ cls: 'scv-selected-section' });
        const header = section.createDiv({ cls: 'scv-selected-section-header scv-collapsible-header' });
        header.setAttr('role', 'button');
        header.setAttr('aria-expanded', String(!collapsed));
        header.createSpan({ cls: 'scv-section-toggle', text: collapsed ? '▶' : '▼' });
        header.createSpan({ cls: 'scv-selected-section-title', text: t('sourceControl.section.selectedForSync') });

        const clearBtn = header.createEl('button', {
            cls: 'scv-selected-section-clear',
            attr: { type: 'button' },
        });
        clearBtn.createSpan({ cls: 'scv-selected-section-clear-label', text: t('sourceControl.section.clearSelection') });
        setTooltip(clearBtn, t('sourceControl.section.clearSelection.tooltip'));
        clearBtn.addEventListener('click', (evt) => { evt.stopPropagation(); this.clearSelection(syncQueue); });
        header.addEventListener('click', () => {
            if (isMobile) { this.mobileQueueCollapsed = !this.mobileQueueCollapsed; this.rerender(); }
            else this.toggleSection('checkedChanges');
        });

        if (collapsed) return;
        section.createDiv({
            cls: 'scv-selected-section-subtitle',
            text: t('sourceControl.section.queueSubtitle', { count: syncQueue.length }),
        });
        const list = section.createDiv({ cls: 'scv-selected-section-list' });
        // Group the queue by its default sync action so a mixed batch reads
        // as what the Sync button will actually do (Upload / Download /
        // Delete) rather than a flat list of ambiguous badges. Only surface
        // group labels when more than one action is present in the batch —
        // a single-action queue stays flat (no label noise) and matches the
        // pre-categorization layout.
        const upload = syncQueue.filter(item => defaultSyncAction(item.kind) === 'push');
        const download = syncQueue.filter(item => defaultSyncAction(item.kind) === 'pull');
        const deleteRemote = syncQueue.filter(item => defaultSyncAction(item.kind) === 'delete-remote');
        const groupCount = [upload, download, deleteRemote].filter(group => group.length > 0).length;
        const mixed = groupCount > 1;
        if (mixed && upload.length > 0) list.createDiv({ cls: 'scv-queue-group-label', text: t('sourceControl.queue.upload') });
        for (const item of upload) renderChangeItem(list, item, basename(item.path), callbacks);
        if (mixed && download.length > 0) list.createDiv({ cls: 'scv-queue-group-label', text: t('sourceControl.queue.download') });
        for (const item of download) renderChangeItem(list, item, basename(item.path), callbacks);
        if (mixed && deleteRemote.length > 0) list.createDiv({ cls: 'scv-queue-group-label', text: t('sourceControl.queue.delete') });
        for (const item of deleteRemote) renderChangeItem(list, item, basename(item.path), callbacks);
    }

    /** Unselects every change currently in the Sync Queue in one shot. */
    private clearSelection(items: readonly SourceControlItem[]): void {
        this.viewModel.selection.deselectMany(items.map(item => item.id));
        this.rerender();
    }

    /**
     * Hands the whole Sync Queue to {@link onSync} as one intent — push,
     * pull, and delete-remote kinds are no longer split into separate calls
     * here. That split now happens inside `SourceControlActionService.sync()`,
     * which builds one merged Sync Plan, shows one confirm, and commits the
     * remote mutation set (pushes + moves + deletions) as a single provider
     * commit instead of the previous push-then-delete two-commit sequence.
     */
    private async runSync(queue: readonly SourceControlItem[]): Promise<void> {
        if (queue.length === 0) return;
        await this.callbacks.onSync(queue.map(item => item.id));
    }

    /** Pulls a single remote-only change into the vault — the inline Download button. */
    private download(item: SourceControlItem): void {
        if (this.callbacks.onPull) void this.callbacks.onPull([item.id]);
    }

    private renderDetail(root: HTMLElement): void {
        const detail = root.createDiv({ cls: 'scv-detail' });
        const bar = detail.createDiv({ cls: 'scv-detail-bar' });

        const backBtn = bar.createEl('button', { cls: 'scv-detail-back' });
        setIcon(backBtn.createSpan({ cls: 'scv-detail-back-icon' }), ICONS.back);
        backBtn.createSpan({ cls: 'scv-detail-back-label', text: t('sourceControl.detail.back') });
        backBtn.addEventListener('click', () => {
            this.selectedChangeId = null;
            // Flag — not direct action — so the scroll restore happens on the
            // next main render, after the detail DOM has been torn down.
            this.restoreNavigationScrollOnNextRender = true;
            this.rerender();
        });

        // The toggle re-renders into a dedicated slot: renderDiffViewer
        // empties its host on every switch, so passing the bar itself would
        // wipe the Back button.
        const toggleSlot = bar.createDiv({ cls: 'scv-detail-bar-toggle' });

        // Shared DiffViewer renders an empty placeholder body; the async
        // load below fills it in (stale-guarded) via the returned handle,
        // once the diff content is ready. The viewer appends the body
        // directly to `detail`, so the legacy .scv-detail-diff wrapper's CSS
        // is kept by styling the body itself.
        const viewer = renderDiffViewer(detail, {
            layout: currentDiffLayout(),
            toggleHost: toggleSlot,
            onLayoutChange: (next) => {
                rememberDiffLayout(next);
                this.rerender();
            },
        });
        const diffBody = detail.querySelector<HTMLElement>('.scv-diff-tab-body');
        diffBody?.addClass('scv-detail-diff');
        if (this.selectedChangeId) {
            void this.loadAndRenderDiff(viewer, this.selectedChangeId);
        }
    }

    private async loadAndRenderDiff(viewer: DiffViewerHandle, changeId: ChangeId): Promise<void> {
        if (!this.callbacks.loadDiffContent) return;
        const item = this.viewModel.getState('all').items.find(i => i.id === changeId)
            ?? this.viewModel.getState('synced', true).items.find(i => i.id === changeId);
        if (!item) return;

        const content = await this.callbacks.loadDiffContent(item);
        // Stale response guard: the selection may have moved on while awaiting.
        if (!content || this.selectedChangeId !== changeId) return;
        viewer.setContent(content.remote, content.local);
    }

    private toggleFolder(path: string): void {
        if (this.collapsedFolders.has(path)) this.collapsedFolders.delete(path);
        else this.collapsedFolders.add(path);
        this.rerender();
    }

    private toggleSelect(id: ChangeId, selected: boolean): void {
        if (selected) this.viewModel.selection.selectForSync(id);
        else this.viewModel.selection.deselectFromSync(id);
        this.rerender();
    }

    private toggleFolderSelect(ids: readonly ChangeId[], selected: boolean): void {
        if (selected) this.viewModel.selection.selectMany(ids);
        else this.viewModel.selection.deselectMany(ids);
        this.rerender();
    }

    private openDiff(item: SourceControlItem): void {
        // Neither kind has a counterpart to diff against, so clicking opens
        // the file itself (local-only) or its remote page (remote-only)
        // instead of navigating into an empty diff view.
        if (item.kind === 'local-only' && this.callbacks.onOpenLocalFile) {
            void this.callbacks.onOpenLocalFile(item);
            return;
        }
        if (item.kind === 'remote-only' && this.callbacks.onOpenRemoteFile) {
            void this.callbacks.onOpenRemoteFile(item);
            return;
        }

        // Mobile navigates to a detail view that replaces the whole main
        // list DOM, so the list's scroll positions must be copied into the
        // View-level state BEFORE the render (the per-render capture reads
        // DOM that will be emptied).
        if (Platform.isMobile) {
            if (this.container) this.captureMainScrollState(this.container);
            this.navigationAnchorId = item.id;
        }
        this.selectedChangeId = item.id;
        if (this.callbacks.onOpenDiff) void this.callbacks.onOpenDiff(item);
        // Lazy-load the diff stat for two-sided changes (local-only is
        // background-loaded); re-render once it lands so the row shows its
        // +/- without blocking.
        void this.diffStat.lazyLoad(item);
        this.rerender();
    }

    /**
     * Mobile-only sticky bottom bar: a "N files selected" label plus a Sync
     * button, shown only when at least one change is selected for push. The
     * header's push button is hidden on mobile to save vertical space.
     */
    private renderMobileSyncBar(container: HTMLElement, readyCount: number, queue: readonly SourceControlItem[]): void {
        if (readyCount === 0) return;
        const bar = container.createDiv({ cls: 'scv-mobile-sync-bar' });
        bar.createSpan({ cls: 'scv-mobile-sync-label', text: t('sourceControl.mobile.filesSelected', { count: readyCount }) });
        const btn = bar.createEl('button', { cls: 'scv-mobile-sync-btn' });
        btn.createSpan({ cls: 'scv-mobile-sync-btn-label', text: t('sourceControl.mobile.sync') });
        btn.addEventListener('click', () => void this.runSync(queue));
    }
}

/** Last path segment of a change path, for the Selected section's flat row labels. */
function basename(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? path : path.slice(slash + 1);
}

/** Attribute-safe escaping for a ChangeId used inside a `[data-change-id="…"]` selector. */
function escapeChangeId(id: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
    return id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}