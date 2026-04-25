import { App, Modal, ButtonComponent } from 'obsidian';

export class ConfirmModal extends Modal {
    private message: string;
    private onConfirm: () => void;
    private onCancel?: () => void;

    constructor(app: App, message: string, onConfirm: () => void, onCancel?: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: 'Confirm' });
        contentEl.createEl('p', { text: this.message });

        const buttonContainer = contentEl.createDiv({ cls: 'ssv-confirm-buttons modal-button-container' });

        new ButtonComponent(buttonContainer)
            .setButtonText('Cancel')
            .onClick(() => {
                this.close();
                if (this.onCancel) this.onCancel();
            });

        new ButtonComponent(buttonContainer)
            .setButtonText('Confirm')
            .setCta()
            .onClick(() => {
                this.close();
                this.onConfirm();
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
