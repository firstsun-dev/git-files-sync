import { App, Modal, Setting } from 'obsidian';

type ConflictPanelName = 'diff' | 'local' | 'remote';

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
    private readonly localContent: string;
    private readonly remoteContent: string;
    private readonly onChoose: (choice: 'local' | 'remote') => void;

    constructor(app: App, fileName: string, local: string, remote: string, onChoose: (choice: 'local' | 'remote') => void) {
        super(app);
        this.fileName = fileName;
        this.localContent = local;
        this.remoteContent = remote;
        this.onChoose = onChoose;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('sync-conflict-modal');

        contentEl.createEl('h2', { text: `Conflict in ${this.fileName}` });
        contentEl.createEl('p', {
            text: 'The remote file has different content. Review the differences and choose which version to keep.',
            cls: 'conflict-description'
        });

        const panels = {} as Record<ConflictPanelName, HTMLElement>;
        const tabs = {} as Record<ConflictPanelName, HTMLElement>;

        const setActivePanel = (name: ConflictPanelName) => {
            (Object.keys(panels) as ConflictPanelName[]).forEach(key => {
                panels[key].toggleClass('is-active', key === name);
                tabs[key].toggleClass('is-active', key === name);
            });
        };

        const tabsContainer = contentEl.createDiv({ cls: 'conflict-tabs' });
        const tabLabels: Record<ConflictPanelName, string> = { diff: 'Diff', local: 'Local', remote: 'Remote' };
        (['diff', 'local', 'remote'] as const).forEach(name => {
            const tab = tabsContainer.createEl('button', { text: tabLabels[name], cls: 'conflict-tab' });
            tab.addEventListener('click', () => setActivePanel(name));
            tabs[name] = tab;
        });

        const contentArea = contentEl.createDiv({ cls: 'conflict-content-area' });

        const diffContainer = contentArea.createDiv({ cls: 'conflict-diff-container' });

        const localSection = diffContainer.createDiv({ cls: 'conflict-section conflict-panel' });
        localSection.createEl('h3', { text: 'Local version' });
        const localPre = localSection.createEl('pre', { cls: 'conflict-content' });
        localPre.createEl('code', { text: this.localContent });
        panels.local = localSection;

        const remoteSection = diffContainer.createDiv({ cls: 'conflict-section conflict-panel' });
        remoteSection.createEl('h3', { text: 'Remote version' });
        const remotePre = remoteSection.createEl('pre', { cls: 'conflict-content' });
        remotePre.createEl('code', { text: this.remoteContent });
        panels.remote = remoteSection;

        const diffSection = contentArea.createDiv({ cls: 'conflict-diff-section conflict-panel' });
        diffSection.createEl('h3', { text: 'Differences' });
        const diffPre = diffSection.createEl('pre', { cls: 'conflict-diff' });
        this.renderDiff(diffPre);
        panels.diff = diffSection;

        setActivePanel('diff');

        const buttonContainer = contentEl.createDiv({ cls: 'conflict-buttons' });

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText('Keep local')
                .setTooltip('Overwrite remote with your local content')
                .setCta()
                .onClick(() => {
                    this.onChoose('local');
                    this.close();
                }))
            .addButton(btn => applyDestructiveStyle(btn)
                .setButtonText('Keep remote')
                .setTooltip('Overwrite local with remote content')
                .onClick(() => {
                    this.onChoose('remote');
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => {
                    this.close();
                }));
    }

    private renderDiff(container: HTMLElement) {
        const localLines = this.localContent.split('\n');
        const remoteLines = this.remoteContent.split('\n');

        const createLine = (text: string, type: 'header' | 'added' | 'removed' | 'unchanged') => {
            const lineEl = container.createSpan({ cls: `diff-line ${type}` });
            lineEl.textContent = text + '\n';
        };

        createLine('--- Remote', 'header');
        createLine('+++ Local', 'header');
        createLine('', 'unchanged');

        const maxLines = Math.max(localLines.length, remoteLines.length);

        for (let i = 0; i < maxLines; i++) {
            const remoteLine = remoteLines[i];
            const localLine = localLines[i];

            if (remoteLine !== localLine) {
                if (remoteLine !== undefined) {
                    createLine(`- ${remoteLine}`, 'removed');
                }
                if (localLine !== undefined) {
                    createLine(`+ ${localLine}`, 'added');
                }
            } else if (remoteLine !== undefined) {
                createLine(`  ${remoteLine}`, 'unchanged');
            }
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
