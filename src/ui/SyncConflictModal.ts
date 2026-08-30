import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';
import { isBinaryPath } from '../utils/path';
import { renderDiffLayoutToggle, type DiffLayout } from './components/DiffLayoutToggle';
import { renderDiffPanel } from './components/DiffPanel';

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
        modalEl.addClass('sync-conflict-modal');

        contentEl.createEl('h2', { text: t('syncConflictModal.title', { fileName: this.fileName }) });
        contentEl.createEl('p', {
            text: t('syncConflictModal.description'),
            cls: 'conflict-description'
        });

        if (this.isBinary) {
            contentEl.createDiv({ cls: 'conflict-content-area' })
                .createEl('p', { text: t('syncConflictModal.binaryChanged'), cls: 'conflict-binary-notice' });
        } else {
            this.renderTextComparison(contentEl);
        }

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

        const contentArea = contentEl.createDiv({ cls: 'conflict-content-area' });
        const diffSection = contentArea.createDiv({ cls: 'conflict-diff-section' });
        this.renderDiffTab(diffSection, remoteContent, localContent);
    }

    /**
     * Renders the "Diff" tab via the shared `renderDiffPanel` (same component
     * as the Source Control diff views) instead of a bespoke line-diff, with
     * a button to switch between split (two-column) and unified (one-column)
     * layout -- defaulting to unified so the modal doesn't open unnecessarily
     * wide. Only one layout is ever visible at a time (see the
     * `scv-diff-layout-*` CSS rules shared with the other diff views).
     */
    private renderDiffTab(container: HTMLElement, remoteContent: string, localContent: string): void {
        const header = container.createDiv({ cls: 'conflict-diff-header' });
        header.createEl('h3', { text: t('syncConflictModal.differences') });
        const toggleSlot = header.createDiv({ cls: 'conflict-diff-header-toggle' });

        const body = container.createDiv({ cls: 'scv-diff-tab-body' });
        renderDiffPanel(body, remoteContent, localContent);

        let layout: DiffLayout = 'unified';
        const applyLayout = (): void => {
            body.className = `scv-diff-tab-body scv-diff-layout-${layout}`;
            toggleSlot.empty();
            renderDiffLayoutToggle(toggleSlot, layout, (next) => {
                layout = next;
                applyLayout();
            });
        };
        applyLayout();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
