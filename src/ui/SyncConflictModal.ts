import { App, Modal, Setting, TFile } from 'obsidian';

export class SyncConflictModal extends Modal {
    private file: TFile;
    private localContent: string;
    private remoteContent: string;
    private onChoose: (choice: 'local' | 'remote') => void;

    constructor(app: App, file: TFile, local: string, remote: string, onChoose: (choice: 'local' | 'remote') => void) {
        super(app);
        this.file = file;
        this.localContent = local;
        this.remoteContent = remote;
        this.onChoose = onChoose;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: `Conflict in ${this.file.name}` });
        contentEl.createEl('p', { text: 'The remote file has different content. Which version do you want to keep?' });

        new Setting(contentEl)
            .setName('Keep local')
            .setDesc('Overwrite remote with your local content')
            .addButton(btn => btn
                .setButtonText('Use local')
                .setCta()
                .onClick(() => {
                    this.onChoose('local');
                    this.close();
                }));

        new Setting(contentEl)
            .setName('Keep remote')
            .setDesc('Overwrite local with GitLab content')
            .addButton(btn => btn
                .setButtonText('Use remote')
                .onClick(() => {
                    this.onChoose('remote');
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
