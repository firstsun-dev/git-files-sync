import { ItemView, WorkspaceLeaf } from 'obsidian';
import { renderDiffPanel } from './components/DiffPanel';
import { type FileStatus } from './types';
import { t } from '../i18n';

export const SYNC_DIFF_VIEW_TYPE = 'sync-diff-view';

/**
 * Shows one file's diff in a workspace pane, which is where a wide side-by-side
 * view has room to exist — the sync panel lives in a sidebar and the diff's
 * split/unified switch is a container query against its own width, so the same
 * markup renders side-by-side here without any style of its own.
 *
 * Only one of these is ever open: the sync panel reuses the existing leaf so
 * opening a second file's diff replaces the content rather than stacking panes.
 */
export class DiffView extends ItemView {
    private path: string | null = null;
    private remoteContent?: string | ArrayBuffer;
    private localContent?: string | ArrayBuffer;
    private isSymlink = false;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string { return SYNC_DIFF_VIEW_TYPE; }
    getIcon(): string { return 'file-diff'; }

    getDisplayText(): string {
        return this.path
            ? t('diffView.titleWithFile', { path: this.path })
            : t('diffView.title');
    }

    /** The file currently on screen, so the caller can tell when it goes stale. */
    getPath(): string | null { return this.path; }

    setDiff(fileStatus: FileStatus): void {
        this.path = fileStatus.path;
        this.remoteContent = fileStatus.remoteContent;
        this.localContent = fileStatus.localContent;
        this.isSymlink = fileStatus.isSymlink === true;
        // Obsidian reads the title from getDisplayText(); nudge it to re-read.
        this.leaf.setViewState({ type: SYNC_DIFF_VIEW_TYPE, active: true }).catch(() => { /* title only */ });
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
        container.addClass('sync-diff-view');

        if (!this.path) {
            container.createDiv({ cls: 'ssv-empty', text: t('diffView.empty') });
            return;
        }

        container.createDiv({ cls: 'ssv-diff-pane-path', text: this.path });
        const body = container.createDiv({ cls: 'ssv-diff-pane' });

        if (this.isSymlink) {
            body.createDiv({ cls: 'ssv-diff-binary', text: t('fileListItem.diff.symlinkChanged') });
            return;
        }
        if (typeof this.remoteContent === 'string' && typeof this.localContent === 'string') {
            renderDiffPanel(body, this.remoteContent, this.localContent);
            return;
        }
        body.createDiv({ cls: 'ssv-diff-binary', text: t('fileListItem.diff.binaryChanged') });
    }
}
