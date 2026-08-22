import { Platform } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { PushSelectionStore } from '../../logic/source-control/PushSelectionStore';
import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';
import { SourceControlViewModel, type SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeId } from '../../logic/source-control/types';
import { renderDiffPanel } from '../components/DiffPanel';
import { renderChangeTree, type ChangeTreeCallbacks } from './ChangeTree';
import { renderFilterMenu } from './FilterMenu';
import { renderSourceControlHeader } from './SourceControlHeader';

export interface SourceControlDiffContent {
    remote: string;
    local: string;
}

export interface SourceControlViewCallbacks {
    /** Hands push intent off to whatever wires this view to the sync pipeline; never called by the UI directly against a Git provider. */
    onPush: (changeIds: ChangeId[]) => void | Promise<void>;
    /** Notified when a change is selected for diff viewing, in addition to this view's own diff pane rendering. */
    onOpenDiff?: (item: SourceControlItem) => void | Promise<void>;
    /** Supplies diff content for the selected change; omit to leave the diff pane empty. */
    loadDiffContent?: (item: SourceControlItem) => Promise<SourceControlDiffContent | null>;
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
    private readonly collapsedFolders = new Set<string>();
    private selectedChangeId: ChangeId | null = null;
    private container?: HTMLElement;

    constructor(
        private readonly viewModel: SourceControlViewModel,
        private readonly selection: PushSelectionStore,
        private readonly callbacks: SourceControlViewCallbacks,
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

        if (!isMobile) {
            const diffPane = container.createDiv({ cls: 'scv-diff' });
            this.renderDiffPane(diffPane);
        }
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
            { readyToPushCount: state.counts['ready-to-push'] },
            { onPush: () => { void this.callbacks.onPush(this.selection.getSelectedChangeIds()); } },
        );

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

        const body = container.createDiv({ cls: 'scv-body' });
        this.renderActiveFilterHeader(body, state.filter, state.items.length);
        if (state.items.length === 0) {
            body.createDiv({ cls: 'scv-empty', text: t('sourceControl.empty') });
            return;
        }

        const treeCallbacks: ChangeTreeCallbacks = {
            onToggleFolder: (path) => this.toggleFolder(path),
            onToggleSelect: (id, selected) => this.toggleSelect(id, selected),
            onOpenDiff: (item) => this.openDiff(item),
        };

        renderChangeTree(body, state.items, this.collapsedFolders, treeCallbacks, TREE_OPTIONS);
    }

    /** Renders the single active-filter header (e.g. "ALL (132)") above the flat tree. */
    private renderActiveFilterHeader(container: HTMLElement, filter: SourceControlFilter, count: number): void {
        const header = container.createDiv({ cls: 'scv-active-filter-header' });
        header.createSpan({ cls: 'scv-active-filter-title', text: t(FILTER_HEADER_KEYS[filter]) });
        header.createSpan({ cls: 'scv-active-filter-count', text: String(count) });
    }

    private renderDiffPane(container: HTMLElement): void {
        if (!this.selectedChangeId) {
            container.createDiv({ cls: 'scv-diff-empty', text: t('sourceControl.diff.selectPrompt') });
            return;
        }
        void this.loadAndRenderDiff(container, this.selectedChangeId);
    }

    private renderDetail(root: HTMLElement): void {
        const detail = root.createDiv({ cls: 'scv-detail' });
        const backBtn = detail.createEl('button', { cls: 'scv-detail-back', text: t('sourceControl.detail.back') });
        backBtn.addEventListener('click', () => {
            this.selectedChangeId = null;
            this.rerender();
        });

        const diffContainer = detail.createDiv({ cls: 'scv-detail-diff' });
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

    private openDiff(item: SourceControlItem): void {
        this.selectedChangeId = item.id;
        if (this.callbacks.onOpenDiff) void this.callbacks.onOpenDiff(item);
        this.rerender();
    }
}