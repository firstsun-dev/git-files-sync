import { debounce, Platform, setIcon, setTooltip } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { PushSelectionStore } from '../../logic/source-control/PushSelectionStore';
import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';
import { SourceControlViewModel, type SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeId } from '../../logic/source-control/types';
import { ICONS } from '../components/icons';
import { renderDiffLayoutToggle, type DiffLayout } from '../components/DiffLayoutToggle';
import { renderDiffPanel } from '../components/DiffPanel';
import { renderChangeTree, type ChangeTreeCallbacks } from './ChangeTree';
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
 * - Synced is hidden by default (`showSynced = false`): the `synced` chip is
 *   absent and synced rows render nowhere. The "Show synced" toggle opts in.
 */
export class SourceControlView {
    private filter: SourceControlFilter = 'all';
    private showSynced = false;
    private searchQuery = '';
    private readonly collapsedFolders = new Set<string>();
    private selectedChangeId: ChangeId | null = null;
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
    getShowSynced(): boolean { return this.showSynced; }
    getSelectedChangeId(): ChangeId | null { return this.selectedChangeId; }

    private rerender(): void {
        if (this.container) this.render(this.container);
    }

    private renderMain(container: HTMLElement): void {
        const state = this.viewModel.getState(this.filter, this.showSynced);

        renderSourceControlHeader(
            container,
            {
                readyToPushCount: state.counts['ready-to-push'],
                workspaceInfo: this.getWorkspaceInfo(),
                refreshStatus: state.refreshStatus,
            },
            {
                onPush: () => { void this.callbacks.onPush(this.selection.getSelectedChangeIds()); },
                onRefresh: () => this.callbacks.onRefresh(),
            },
        );

        this.renderSearchBox(container);

        renderFilterMenu(
            container,
            this.filter,
            state.counts,
            this.showSynced,
            {
                onFilterChange: (filter) => { this.filter = filter; this.rerender(); },
                onToggleShowSynced: (show) => {
                    this.showSynced = show;
                    // If the user hid synced while viewing it, fall back to All.
                    if (!show && this.filter === 'synced') this.filter = 'all';
                    this.rerender();
                },
            },
        );

        const query = this.searchQuery.trim().toLowerCase();
        const items = query ? state.items.filter(item => item.path.toLowerCase().includes(query)) : state.items;

        this.renderSelectedSection(container, state.selectedItems);

        const body = container.createDiv({ cls: 'scv-body' });
        this.renderActiveFilterHeader(body, state.filter, items.length);
        if (items.length === 0) {
            body.createDiv({ cls: 'scv-empty', text: t('sourceControl.empty') });
            return;
        }

        const treeCallbacks: ChangeTreeCallbacks = {
            onToggleFolder: (path) => this.toggleFolder(path),
            onToggleSelect: (id, selected) => this.toggleSelect(id, selected),
            onToggleFolderSelect: (ids, selected) => this.toggleFolderSelect(ids, selected),
            onOpenDiff: (item) => this.openDiff(item),
        };

        renderChangeTree(body, items, this.collapsedFolders, treeCallbacks, TREE_OPTIONS);
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
     * Renders the "SELECTED FOR SYNC (N)" summary, only when the user has at
     * least one actionable change selected for push. Sits above the tree so the
     * current push batch is always visible regardless of the active filter.
     * The count comes straight from the ViewModel's single-source
     * `selectedItems` projection (same definition as the Sync button count),
     * so the two can never drift.
     */
    private renderSelectedSection(container: HTMLElement, selectedItems: readonly SourceControlItem[]): void {
        if (selectedItems.length === 0) return;
        const section = container.createDiv({ cls: 'scv-selected-section' });
        section.createSpan({ cls: 'scv-selected-section-title', text: t('sourceControl.section.selectedForSync') });
        section.createSpan({ cls: 'scv-selected-section-count', text: String(selectedItems.length) });
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
        const item = this.viewModel.getState('all', this.showSynced).items.find(i => i.id === changeId)
            ?? this.viewModel.getState('synced', this.showSynced).items.find(i => i.id === changeId);
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
        this.rerender();
    }
}