import { ItemView, WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import { renderDiffLayoutToggle, type DiffLayout } from '../components/DiffLayoutToggle';
import { renderDiffPanel } from '../components/DiffPanel';

export const SOURCE_CONTROL_DIFF_VIEW_TYPE = 'source-control-diff-view';

export interface DiffTabContent {
    remote: string;
    local: string;
}

/**
 * Shows one change's diff in a full main-area workspace tab. The Source
 * Control panel itself lives in a narrow sidebar, so a side-by-side diff
 * needs the width a main-area tab gives it instead of splitting that
 * sidebar in half (docs/source-control-refactor mirrors the pre-refactor
 * DiffView's rationale). Only one of these is ever open: opening a second
 * change's diff reuses the leaf and replaces the content.
 */
export class DiffTabView extends ItemView {
    private path: string | null = null;
    private content: DiffTabContent | null = null;
    /** Toggled explicitly via the layout button rather than by tab width, so split and unified never both take up space. */
    private layout: DiffLayout = 'split';

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string { return SOURCE_CONTROL_DIFF_VIEW_TYPE; }
    getIcon(): string { return 'file-diff'; }

    getDisplayText(): string {
        return this.path ? t('diffView.titleWithFile', { path: this.path }) : t('diffView.title');
    }

    /** The change currently on screen, so the caller can tell when it goes stale. */
    getPath(): string | null { return this.path; }

    setDiff(path: string, content: DiffTabContent | null): void {
        this.path = path;
        this.content = content;
        // Obsidian reads the tab title from getDisplayText(); nudge it to re-read.
        this.leaf.setViewState({ type: SOURCE_CONTROL_DIFF_VIEW_TYPE, active: true }).catch(() => { /* title only */ });
        this.render();
    }

    onOpen(): Promise<void> {
        this.render();
        return Promise.resolve();
    }

    private render(): void {
        const container = this.containerEl.children[1] as HTMLElement | null;
        if (!container) return;

        container.empty();
        container.addClass('scv-diff-tab');

        if (!this.path || !this.content) {
            container.createDiv({ cls: 'scv-diff-empty', text: t('diffView.empty') });
            return;
        }

        const header = container.createDiv({ cls: 'scv-diff-tab-header' });
        header.createDiv({ cls: 'scv-diff-tab-path', text: this.path });

        renderDiffLayoutToggle(header, this.layout, (next) => {
            this.layout = next;
            this.render();
        });

        const body = container.createDiv({ cls: `scv-diff-tab-body scv-diff-layout-${this.layout}` });
        renderDiffPanel(body, this.content.remote, this.content.local);
    }
}
