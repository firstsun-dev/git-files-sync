import { debounce, Platform, setIcon, setTooltip } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { PushSelectionStore } from '../../logic/source-control/PushSelectionStore';
import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';
import { SourceControlViewModel, type SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeId } from '../../logic/source-control/types';
import type { ChangeStat } from './ChangePresentation';
import { ICONS } from '../components/icons';
import { renderDiffLayoutToggle, type DiffLayout } from '../components/DiffLayoutToggle';
import { renderDiffPanel } from '../components/DiffPanel';
import { renderChangeTree, type ChangeTreeCallbacks } from './ChangeTree';
import { renderChangeItem } from './ChangeItem';
import { renderFilterMenu } from './FilterMenu';
import { renderSourceControlHeader, type SourceControlWorkspaceInfo } from './SourceControlHeader';

export interface SourceControlDiffContent {
    remote: string;
    local: string;
}

export interface SourceControlViewCallbacks {
    /** Hands push intent off to whatever wires this view to the sync pipeline; never called by the UI directly against a Git provider. */
    onPush: (changeIds: ChangeId[]) => void | Promise<void>;
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
     * Supplies the +/- diff stat for a change row. For a `local-only` change
     * this is expected to be a cheap in-memory read (no provider call); for
     * others it may involve a remote fetch. The view caches results and
     * clears the cache on refresh. Omit to leave rows without a stat.
     */
    loadDiffStat?: (item: SourceControlItem) => Promise<ChangeStat | null>;
}

/** Active-filter header title keys. Every filter renders one header + a flat tree (no section breakdown). */
const FILTER_HEADER_KEYS: Record<SourceControlFilter, TranslationKey> = {
    all:               'sourceControl.section.all',
    changes:           'sourceControl.section.changes',
    'ready-to-push':   'sourceControl.section.readyToPush',
    'remote-changes':  'sourceControl.section.remoteChanges',
    conflicts:         'sourceControl.section.conflicts',
    synced:            'sourceControl.section.synced',
};

/** Tree shaping so the change tree stays a compact change view, not a full Explorer. */
const TREE_OPTIONS = { collapseSingleChild: true };
/** Mobile tree: collapse single-child folders and cap depth so the tree stays flat on a phone. */
const MOBILE_TREE_OPTIONS = { collapseSingleChild: true, maxDepth: 2 };

/**
 * Composes the Source Control UI (Header, Filter, change tree, Diff panel)
 * from `SourceControlViewModel` state, per
 * docs/source-control-refactor/phase-3-source-control-ui.md.
 *
 * Pure presentation + wiring: push/diff intent is handed to injected
 * callbacks rather than acted on directly here, so this layer never reaches
 * past the ViewModel to `SyncManager`/a Git provider. Selection toggling is
 * the one exception — it goes straight to `PushSelectionStore` (Phase 1
 * state), since "ready to push" is just a set membership change, not a sync
 * action.
 *
 * Rendering semantics (status-grouping fix):
 * - Every filter — including "All" — renders a single flat tree. "All" no
 *   longer breaks the view into CHANGES / REMOTE CHANGES / SYNCED sections, so
 *   a change never appears twice and SYNCED never leaks into All.
 * - Synced is not surfaced in the UI: there is no `synced` chip and no
 *   "Show synced" toggle, so a quiet workspace stays quiet. The domain
 *   `synced` filter/summary are still computed by the ViewModel but simply
 *   have no entry point here.
 * - Selected changes get a first-class "SELECTED FOR SYNC (N)" region
 *   (between the filter and the tree) listing the working push batch; the
 *   same rows remain in the tree, visually muted via `is-selected`.
 */
export class SourceControlView {
    private filter: SourceControlFilter = 'all';
    private searchQuery = '';
    private readonly collapsedFolders = new Set<string>();
    private selectedChangeId: ChangeId | null = null;
    /** Cached +/- diff stats per change id (null = attempted but unavailable), cleared on refresh. */
    private readonly diffStatCache = new Map<ChangeId, ChangeStat | null>();
    /** Mobile detail view only: which layout the diff renders in, toggled explicitly rather than by container width, so only one ever takes up space. */
    private mobileDiffLayout: DiffLayout = 'unified';
    private container?: HTMLElement;
    private readonly applySearchDebounced = debounce(
        (value: string) => this.applySearch(value),
        150,
        false,
    );

    constructor(
        private readonly viewModel: SourceControlViewModel,
        private readonly selection: PushSelectionStore,
        private readonly callbacks: SourceControlViewCallbacks,
        private readonly getWorkspaceInfo: () => SourceControlWorkspaceInfo,
    ) {}

    render(container: HTMLElement): void {
        this.container = container;
        container.empty();
        container.addClass('scv-root');

        const isMobile = Platform.isMobile;
        container.toggleClass('scv-mobile', isMobile);
        container.toggleClass('scv-desktop', !isMobile);

        if (isMobile && this.selectedChangeId !== null) {
            this.renderDetail(container);
            return;
        }

        const main = container.createDiv({ cls: 'scv-main' });
        this.renderMain(main);
    }

    getFilter(): SourceControlFilter { return this.filter; }
    getSelectedChangeId(): ChangeId | null { return this.selectedChangeId; }

    private rerender(): void {
        if (this.container) this.render(this.container);
    }

    private renderMain(container: HTMLElement): void {
        const state = this.viewModel.getState(this.filter);

        const isMobile = Platform.isMobile;

        renderSourceControlHeader(
            container,
            {
                readyToPushCount: state.counts['ready-to-push'],
                workspaceInfo: this.getWorkspaceInfo(),
                refreshStatus: state.refreshStatus,
            },
            {
                onPush: () => { void this.callbacks.onPush(this.selection.getSelectedChangeIds()); },
                onRefresh: () => {
                    this.diffStatCache.clear();
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
            getDiffStat: (id) => this.diffStatCache.get(id) ?? undefined,
        };

        renderFilterMenu(
            container,
            this.filter,
            state.counts,
            { onFilterChange: (filter) => { this.filter = filter; this.rerender(); } },
            { isMobile },
        );

        const query = this.searchQuery.trim().toLowerCase();
        const items = query ? state.items.filter(item => item.path.toLowerCase().includes(query)) : state.items;

        // The scroll container: selected section + active-filter header + tree
        // all live here so the whole lower region scrolls as one. Pinned
        // controls (header, search, filter) stay outside so they don't scroll
        // away; a tall Selected section therefore scrolls with the tree
        // instead of blowing out the layout under `.scv-root { overflow: hidden }`.
        const body = container.createDiv({ cls: 'scv-body' });
        this.renderSelectedSection(body, state.selectedItems, treeCallbacks);
        this.renderActiveFilterHeader(body, state.filter, items.length);
        if (items.length === 0) {
            body.createDiv({ cls: 'scv-empty', text: t('sourceControl.empty') });
            return;
        }

        renderChangeTree(body, items, this.collapsedFolders, treeCallbacks, isMobile ? MOBILE_TREE_OPTIONS : TREE_OPTIONS);

        this.eagerLoadLocalStats(items);

        if (isMobile) this.renderMobileSyncBar(container, state.counts['ready-to-push']);
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

    /** Renders the single active-filter header (e.g. "ALL (132)") above the flat tree. */
    private renderActiveFilterHeader(container: HTMLElement, filter: SourceControlFilter, count: number): void {
        const header = container.createDiv({ cls: 'scv-active-filter-header' });
        header.createSpan({ cls: 'scv-active-filter-title', text: t(FILTER_HEADER_KEYS[filter]) });
        header.createSpan({ cls: 'scv-active-filter-count', text: String(count) });
    }

    /**
     * Renders the "SELECTED FOR SYNC (N)" workspace — a first-class region
     * (not just a count) that lists every actionable change the user has
     * ticked for push, each as a full row whose checkbox unselects it. Sits
     * between the filter and the tree so the working push batch stays
     * visible regardless of the active filter, and the same items remain in
     * the tree (visually muted via `is-selected`) so context isn't lost.
     * The set comes straight from the ViewModel's single-source
     * `selectedItems` projection (same definition as the Sync button count),
     * so the section and the button can never drift.
     */
    private renderSelectedSection(
        container: HTMLElement,
        selectedItems: readonly SourceControlItem[],
        callbacks: ChangeTreeCallbacks,
    ): void {
        if (selectedItems.length === 0) return;
        const section = container.createDiv({ cls: 'scv-selected-section' });
        const header = section.createDiv({ cls: 'scv-selected-section-header' });
        header.createSpan({ cls: 'scv-selected-section-title', text: t('sourceControl.section.selectedForSync') });
        header.createSpan({ cls: 'scv-selected-section-count', text: String(selectedItems.length) });

        const clearBtn = header.createEl('button', {
            cls: 'scv-selected-section-clear',
            attr: { type: 'button' },
        });
        clearBtn.createSpan({ cls: 'scv-selected-section-clear-label', text: t('sourceControl.section.clearSelection') });
        setTooltip(clearBtn, t('sourceControl.section.clearSelection.tooltip'));
        clearBtn.addEventListener('click', () => this.clearSelection(selectedItems));

        const list = section.createDiv({ cls: 'scv-selected-section-list' });
        for (const item of selectedItems) {
            renderChangeItem(list, item, basename(item.path), callbacks);
        }
    }

    /** Unselects every change currently in the Selected section in one shot. */
    private clearSelection(items: readonly SourceControlItem[]): void {
        for (const item of items) this.selection.excludeFromPush(item.id);
        this.rerender();
    }

    private renderDetail(root: HTMLElement): void {
        const detail = root.createDiv({ cls: 'scv-detail' });
        const bar = detail.createDiv({ cls: 'scv-detail-bar' });

        const backBtn = bar.createEl('button', { cls: 'scv-detail-back' });
        setIcon(backBtn.createSpan({ cls: 'scv-detail-back-icon' }), ICONS.back);
        backBtn.createSpan({ cls: 'scv-detail-back-label', text: t('sourceControl.detail.back') });
        backBtn.addEventListener('click', () => {
            this.selectedChangeId = null;
            this.rerender();
        });

        renderDiffLayoutToggle(bar, this.mobileDiffLayout, (next) => {
            this.mobileDiffLayout = next;
            this.rerender();
        });

        const diffContainer = detail.createDiv({ cls: `scv-detail-diff scv-diff-layout-${this.mobileDiffLayout}` });
        if (this.selectedChangeId) void this.loadAndRenderDiff(diffContainer, this.selectedChangeId);
    }

    private async loadAndRenderDiff(container: HTMLElement, changeId: ChangeId): Promise<void> {
        if (!this.callbacks.loadDiffContent) return;
        const item = this.viewModel.getState('all').items.find(i => i.id === changeId)
            ?? this.viewModel.getState('synced', true).items.find(i => i.id === changeId);
        if (!item) return;

        const content = await this.callbacks.loadDiffContent(item);
        // Stale response guard: the selection may have moved on while awaiting.
        if (!content || this.selectedChangeId !== changeId) return;
        renderDiffPanel(container, content.remote, content.local);
    }

    private toggleFolder(path: string): void {
        if (this.collapsedFolders.has(path)) this.collapsedFolders.delete(path);
        else this.collapsedFolders.add(path);
        this.rerender();
    }

    private toggleSelect(id: ChangeId, selected: boolean): void {
        if (selected) this.selection.includeForPush(id);
        else this.selection.excludeFromPush(id);
        this.rerender();
    }

    private toggleFolderSelect(ids: readonly ChangeId[], selected: boolean): void {
        for (const id of ids) {
            if (selected) this.selection.includeForPush(id);
            else this.selection.excludeFromPush(id);
        }
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

        this.selectedChangeId = item.id;
        if (this.callbacks.onOpenDiff) void this.callbacks.onOpenDiff(item);
        // Lazy-load the diff stat for two-sided changes (local-only is eager);
        // re-render once it lands so the row shows its +/- without blocking.
        void this.lazyLoadStat(item);
        this.rerender();
    }

    /**
     * Eagerly resolves +/- stats for visible `local-only` rows: these are
     * cheap in-memory reads (no provider call), so showing them immediately
     * keeps the change list informative without a remote round-trip. Fires
     * once per render for any uncached local-only item and re-renders a
     * single time when the batch settles. A `null` result (binary/missing
     * content) is cached too, so it isn't retried on every rerender.
     */
    private eagerLoadLocalStats(items: readonly SourceControlItem[]): void {
        if (!this.callbacks.loadDiffStat) return;
        const pending = items.filter(item => item.kind === 'local-only' && !this.diffStatCache.has(item.id));
        if (pending.length === 0) return;
        void Promise.all(pending.map(async item => {
            const stat = await this.callbacks.loadDiffStat!(item);
            this.diffStatCache.set(item.id, stat ?? null);
        })).then(() => this.rerender());
    }

    /**
     * Lazily resolves the +/- stat for a single two-sided change on open,
     * caching it so subsequent renders show the stat without a refetch.
     */
    private async lazyLoadStat(item: SourceControlItem): Promise<void> {
        if (!this.callbacks.loadDiffStat || this.diffStatCache.has(item.id)) return;
        const stat = await this.callbacks.loadDiffStat(item);
        this.diffStatCache.set(item.id, stat ?? null);
        if (stat) this.rerender();
    }

    /**
     * Mobile-only sticky bottom bar: a single Sync button spanning the row,
     * shown when there's at least one change selected for push. The header's
     * push button is hidden on mobile to save vertical space.
     */
    private renderMobileSyncBar(container: HTMLElement, readyCount: number): void {
        if (readyCount === 0) return;
        const bar = container.createDiv({ cls: 'scv-mobile-sync-bar' });
        const btn = bar.createEl('button', { cls: 'scv-mobile-sync-btn' });
        btn.createSpan({ cls: 'scv-mobile-sync-label', text: t('sourceControl.section.selectedForSync') });
        btn.createSpan({ cls: 'scv-mobile-sync-count', text: String(readyCount) });
        btn.addEventListener('click', () => { void this.callbacks.onPush(this.selection.getSelectedChangeIds()); });
    }
}

/** Last path segment of a change path, for the Selected section's flat row labels. */
function basename(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? path : path.slice(slash + 1);
}