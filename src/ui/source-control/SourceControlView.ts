import { Platform } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import { SourceControlViewModel, type SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { SectionFilter } from '../../logic/source-control/state/ExpandedNodesState';
import type { ChangeId } from '../../logic/source-control/types';
import { renderDiffPanel } from '../components/DiffPanel';
import { renderChangeSection } from './ChangeSection';
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

/** The five Source Control sections, in the order the spec lists them. */
const SECTION_FILTERS: SectionFilter[] = ['ready-to-push', 'changes', 'remote-changes', 'conflicts', 'synced'];

const SECTION_TITLE_KEYS: Record<SectionFilter, TranslationKey> = {
    'ready-to-push':  'sourceControl.section.readyToPush',
    changes:          'sourceControl.section.changes',
    'remote-changes': 'sourceControl.section.remoteChanges',
    conflicts:        'sourceControl.section.conflicts',
    synced:           'sourceControl.section.synced',
};

/**
 * Pure layout + event binding for the Source Control UI (Header, Filter,
 * ChangeTree/sections, Diff panel), composed from `SourceControlViewModel`
 * state, per docs/source-control-refactor/roadmap.md.
 *
 * This layer holds **no state of its own** — the active filter, collapsed
 * sections/folders, and selected change all live in `SourceControlState`,
 * reached only through the ViewModel. Push/diff intent is handed to injected
 * callbacks rather than acted on directly, so this layer never reaches past
 * the ViewModel to `SyncManager`/a Git provider.
 */
export class SourceControlView {
    private container?: HTMLElement;

    constructor(
        private readonly viewModel: SourceControlViewModel,
        private readonly callbacks: SourceControlViewCallbacks,
    ) {}

    render(container: HTMLElement): void {
        this.container = container;
        container.empty();
        container.addClass('scv-root');

        const isMobile = Platform.isMobile;
        container.toggleClass('scv-mobile', isMobile);
        container.toggleClass('scv-desktop', !isMobile);

        if (isMobile && this.viewModel.getSelectedChangeId() !== null) {
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

    private rerender(): void {
        if (this.container) this.render(this.container);
    }

    private renderMain(container: HTMLElement): void {
        const filter = this.viewModel.getFilter();
        const state = this.viewModel.getState(filter);

        renderSourceControlHeader(
            container,
            { readyToPushCount: state.counts['ready-to-push'] },
            { onPush: () => { void this.callbacks.onPush(this.viewModel.getSelectedChangeIds()); } },
        );

        renderFilterMenu(container, filter, state.counts, (next) => {
            this.viewModel.setFilter(next);
            this.rerender();
        });

        const body = container.createDiv({ cls: 'scv-body' });
        if (state.items.length === 0) {
            body.createDiv({ cls: 'scv-empty', text: t('sourceControl.empty') });
            return;
        }

        const treeCallbacks: ChangeTreeCallbacks = {
            onToggleFolder: (path) => { this.viewModel.toggleFolder(path); this.rerender(); },
            onToggleSelect: (id, selected) => {
                if (selected) this.viewModel.selectForPush(id);
                else this.viewModel.deselectFromPush(id);
                this.rerender();
            },
            onOpenDiff: (item) => this.openDiff(item),
        };

        if (filter === 'all') {
            this.renderSections(body, treeCallbacks);
        } else {
            renderChangeTree(body, state.items, this.viewModel.getCollapsedFolders(), treeCallbacks);
        }
    }

    private renderSections(body: HTMLElement, treeCallbacks: ChangeTreeCallbacks): void {
        const collapsedFolders = this.viewModel.getCollapsedFolders();
        for (const sectionFilter of SECTION_FILTERS) {
            const items = this.viewModel.getState(sectionFilter).items;
            if (items.length === 0) continue;

            renderChangeSection(
                body,
                {
                    id: sectionFilter,
                    title: t(SECTION_TITLE_KEYS[sectionFilter]),
                    items,
                    collapsed: this.viewModel.isSectionCollapsed(sectionFilter),
                    collapsedFolders,
                },
                {
                    ...treeCallbacks,
                    onToggleSection: (id) => { this.viewModel.toggleSection(id); this.rerender(); },
                },
            );
        }
    }

    private renderDiffPane(container: HTMLElement): void {
        const selected = this.viewModel.getSelectedChangeId();
        if (!selected) {
            container.createDiv({ cls: 'scv-diff-empty', text: t('sourceControl.diff.selectPrompt') });
            return;
        }
        void this.loadAndRenderDiff(container, selected);
    }

    private renderDetail(root: HTMLElement): void {
        const detail = root.createDiv({ cls: 'scv-detail' });
        const backBtn = detail.createEl('button', { cls: 'scv-detail-back', text: t('sourceControl.detail.back') });
        backBtn.addEventListener('click', () => {
            this.viewModel.clearSelection();
            this.rerender();
        });

        const diffContainer = detail.createDiv({ cls: 'scv-detail-diff' });
        const selected = this.viewModel.getSelectedChangeId();
        if (selected) void this.loadAndRenderDiff(diffContainer, selected);
    }

    private async loadAndRenderDiff(container: HTMLElement, changeId: ChangeId): Promise<void> {
        if (!this.callbacks.loadDiffContent) return;
        const item = this.viewModel.getState('all').items.find(i => i.id === changeId);
        if (!item) return;

        const content = await this.callbacks.loadDiffContent(item);
        // Stale response guard: the selection may have moved on while awaiting.
        if (!content || this.viewModel.getSelectedChangeId() !== changeId) return;
        renderDiffPanel(container, content.remote, content.local);
    }

    private openDiff(item: SourceControlItem): void {
        this.viewModel.selectForDiff(item.id);
        if (this.callbacks.onOpenDiff) void this.callbacks.onOpenDiff(item);
        this.rerender();
    }
}