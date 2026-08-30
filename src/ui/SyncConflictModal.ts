import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';
import { isBinaryPath } from '../utils/path';
import { renderDiffViewer, currentDiffLayout, rememberDiffLayout } from './components/DiffViewer';

/**
 * Apply the "destructive" button style, but only when the running Obsidian
 * supports it. ButtonComponent.setDestructive() was added in Obsidian 1.13; on
 * older versions (down to this plugin's minAppVersion, 1.11.0) the method is
 * absent, so we skip it instead of throwing "setDestructive is not a function".
 * Returns the same button so it can be chained.
 */
export function applyDestructiveStyle<T extends object>(btn: T): T {
    const setDestructive = (btn as { setDestructive?: () => unknown }).setDestructive;
    if (typeof setDestructive === 'function') {
        setDestructive.call(btn);
    }
    return btn;
}

export class SyncConflictModal extends Modal {
    private readonly fileName: string;
    private readonly localContent: string | ArrayBuffer;
    private readonly remoteContent: string | ArrayBuffer;
    private readonly onChoose: (choice: 'local' | 'remote') => void;
    private readonly isBinary: boolean;

    constructor(app: App, fileName: string, local: string | ArrayBuffer, remote: string | ArrayBuffer, onChoose: (choice: 'local' | 'remote') => void) {
        super(app);
        this.fileName = fileName;
        this.localContent = local;
        this.remoteContent = remote;
        this.onChoose = onChoose;
        this.isBinary = isBinaryPath(fileName) || typeof local !== 'string' || typeof remote !== 'string';
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        modalEl.addClass('gfs-conflict-modal');
        modalEl.addClass('gfs-conflict-modal--single');
        modalEl.addClass('gfs-diff-surface');

        // Fixed header: identity + view controls (Differences / layout
        // toggle). flex-shrink: 0 in CSS — scrolls away never.
        const header = contentEl.createDiv({ cls: 'conflict-header' });
        header.createEl('h2', { text: t('syncConflictModal.title', { fileName: this.fileName }) });
        header.createEl('p', {
            text: t('syncConflictModal.description'),
            cls: 'conflict-description'
        });

        // Fixed footer FIRST in the flex column's content plan is not needed
        // — order below is header, scroller, footer; footer is after the
        // scroll area in the DOM too, pinned by flex-shrink: 0.

        if (this.isBinary) {
            const scroll = contentEl.createDiv({ cls: 'conflict-content-area' });
            scroll.createEl('p', { text: t('syncConflictModal.binaryChanged'), cls: 'conflict-binary-notice' });
            this.renderButtons(contentEl);
            return;
        }

        this.renderTextComparison(contentEl);
        this.renderButtons(contentEl);
    }

    private renderButtons(contentEl: HTMLElement): void {
        const buttonContainer = contentEl.createDiv({ cls: 'conflict-buttons' });

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText(t('syncConflictModal.keepLocal'))
                .setTooltip(t('syncConflictModal.keepLocal.tooltip'))
                .setCta()
                .onClick(() => {
                    this.onChoose('local');
                    this.close();
                }))
            .addButton(btn => applyDestructiveStyle(btn)
                .setButtonText(t('syncConflictModal.keepRemote'))
                .setTooltip(t('syncConflictModal.keepRemote.tooltip'))
                .onClick(() => {
                    this.onChoose('remote');
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText(t('syncConflictModal.cancel'))
                .onClick(() => {
                    this.close();
                }));
    }

    /**
     * The split diff layout already lays local and remote content side by
     * side (with per-line highlighting, unlike a plain full-text dump), so a
     * separate Local/Remote tab pair would just duplicate it -- this renders
     * the diff view directly with no tab switching needed.
     */
    private renderTextComparison(contentEl: HTMLElement) {
        const localContent = this.localContent as string;
        const remoteContent = this.remoteContent as string;

        // "Differences + layout toggle" is a VIEW control: it stays in the
        // fixed header region (outside the scroll container) so it remains
        // reachable while a long diff scrolls below it. Only diff lines and
        // the binary notice live inside the scroller.
        const header = contentEl.createDiv({ cls: 'conflict-diff-header' });
        header.createEl('h3', { text: t('syncConflictModal.differences') });
        const toggleSlot = header.createDiv({ cls: 'conflict-diff-header-toggle' });

        const scrollArea = contentEl.createDiv({ cls: 'conflict-content-area' });
        const diffSection = scrollArea.createDiv({ cls: 'conflict-diff-section' });

        // One shared default/policy for all surfaces (see DiffViewer):
        // split on wide desktop viewport, unified on phones — and whatever
        // layout the user last picked anywhere in the session.
        renderDiffViewer(diffSection, {
            remote: remoteContent,
            local: localContent,
            layout: currentDiffLayout(),
            toggleHost: toggleSlot,
            onLayoutChange: rememberDiffLayout,
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
