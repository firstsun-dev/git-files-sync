import { ItemView, WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import { renderDiffViewer, currentDiffLayout, rememberDiffLayout } from '../components/DiffViewer';

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
        const pathChanged = this.path !== path;
        this.path = path;
        this.content = content;
        // Nudge the tab title to re-read only when the path actually changed —
        // a same-path background refresh (leading title text is the path) must
        // not re-activate the leaf and yank workspace focus.
        if (pathChanged) {
            this.leaf.setViewState({ type: SOURCE_CONTROL_DIFF_VIEW_TYPE, active: true }).catch(() => { /* title only */ });
        }
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
        container.addClass('gfs-diff-surface');

        if (!this.path || !this.content) {
            container.createDiv({ cls: 'scv-diff-empty', text: t('diffView.empty') });
            return;
        }

        const header = container.createDiv({ cls: 'scv-diff-tab-header' });
        header.createDiv({ cls: 'scv-diff-tab-path', text: this.path });
        const toggleSlot = header.createDiv({ cls: 'scv-diff-tab-header-toggle' });

        renderDiffViewer(container, {
            remote: this.content.remote,
            local: this.content.local,
            layout: currentDiffLayout(),
            toggleHost: toggleSlot,
            onLayoutChange: rememberDiffLayout,
        });
    }
}
