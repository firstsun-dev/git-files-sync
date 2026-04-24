import { App, Modal, Setting, TFile } from 'obsidian';

export class SyncConflictModal extends Modal {
    private fileName: string;
    private localContent: string;
    private remoteContent: string;
    private onChoose: (choice: 'local' | 'remote') => void;

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

        const diffContainer = contentEl.createDiv({ cls: 'conflict-diff-container' });

        const localSection = diffContainer.createDiv({ cls: 'conflict-section' });
        localSection.createEl('h3', { text: 'Local version' });
        const localPre = localSection.createEl('pre', { cls: 'conflict-content' });
        localPre.createEl('code', { text: this.localContent });

        const remoteSection = diffContainer.createDiv({ cls: 'conflict-section' });
        remoteSection.createEl('h3', { text: 'Remote version' });
        const remotePre = remoteSection.createEl('pre', { cls: 'conflict-content' });
        remotePre.createEl('code', { text: this.remoteContent });

        const diffSection = contentEl.createDiv({ cls: 'conflict-diff-section' });
        diffSection.createEl('h3', { text: 'Differences' });
        const diffPre = diffSection.createEl('pre', { cls: 'conflict-diff' });
        this.renderDiff(diffPre);

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
            .addButton(btn => btn
                .setButtonText('Keep remote')
                .setTooltip('Overwrite local with remote content')
                .setWarning()
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
