import { Platform } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { PushSelectionStore } from '../../logic/source-control/PushSelectionStore';
import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';
import { SourceControlViewModel, type SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
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

type SectionFilter = Exclude<SourceControlFilter, 'all'>;

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
 * Composes the Source Control UI (Header, Filter, ChangeTree/sections, Diff
 * panel) from `SourceControlViewModel` state, per
 * docs/source-control-refactor/phase-3-source-control-ui.md.
 *
 * Pure presentation + wiring: push/diff intent is handed to injected
 * callbacks rather than acted on directly here, so this layer never reaches
 * past the ViewModel to `SyncManager`/a Git provider. Selection toggling is
 * the one exception — it goes straight to `PushSelectionStore` (Phase 1
 * state), since "ready to push" is just a set membership change, not a sync
 * action.
 */
export class SourceControlView {
    private filter: SourceControlFilter = 'all';
    private readonly collapsedSections = new Set<SectionFilter>();
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
    getSelectedChangeId(): ChangeId | null { return this.selectedChangeId; }

    private rerender(): void {
        if (this.container) this.render(this.container);
    }

    private renderMain(container: HTMLElement): void {
        const state = this.viewModel.getState(this.filter);

        renderSourceControlHeader(
            container,
            { readyToPushCount: state.counts['ready-to-push'] },
            { onPush: () => { void this.callbacks.onPush(this.selection.getSelectedChangeIds()); } },
        );

        renderFilterMenu(container, this.filter, state.counts, (filter) => {
            this.filter = filter;
            this.rerender();
        });

        const body = container.createDiv({ cls: 'scv-body' });
        if (state.items.length === 0) {
            body.createDiv({ cls: 'scv-empty', text: t('sourceControl.empty') });
            return;
        }

        const treeCallbacks: ChangeTreeCallbacks = {
            onToggleFolder: (path) => this.toggleFolder(path),
            onToggleSelect: (id, selected) => this.toggleSelect(id, selected),
            onOpenDiff: (item) => this.openDiff(item),
        };

        if (this.filter === 'all') {
            this.renderSections(body, treeCallbacks);
        } else {
            renderChangeTree(body, state.items, this.collapsedFolders, treeCallbacks);
        }
    }

    private renderSections(body: HTMLElement, treeCallbacks: ChangeTreeCallbacks): void {
        for (const sectionFilter of SECTION_FILTERS) {
            const items = this.viewModel.getState(sectionFilter).items;
            if (items.length === 0) continue;

            renderChangeSection(
                body,
                {
                    id: sectionFilter,
                    title: t(SECTION_TITLE_KEYS[sectionFilter]),
                    items,
                    collapsed: this.collapsedSections.has(sectionFilter),
                    collapsedFolders: this.collapsedFolders,
                },
                {
                    ...treeCallbacks,
                    onToggleSection: (id) => this.toggleSection(id),
                },
            );
        }
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
        const item = this.viewModel.getState('all').items.find(i => i.id === changeId);
        if (!item) return;

        const content = await this.callbacks.loadDiffContent(item);
        // Stale response guard: the selection may have moved on while awaiting.
        if (!content || this.selectedChangeId !== changeId) return;
        renderDiffPanel(container, content.remote, content.local);
    }

    private toggleSection(id: SectionFilter): void {
        if (this.collapsedSections.has(id)) this.collapsedSections.delete(id);
        else this.collapsedSections.add(id);
        this.rerender();
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
