import { App, Modal, ButtonComponent } from 'obsidian';
import { t } from '../i18n';

export class ConfirmModal extends Modal {
    private readonly message: string;
    private readonly onConfirm: () => void;
    private readonly onCancel?: () => void;

    constructor(app: App, message: string, onConfirm: () => void, onCancel?: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: t('confirmModal.title') });
        contentEl.createEl('p', { text: this.message });

        const buttonContainer = contentEl.createDiv({ cls: 'ssv-confirm-buttons modal-button-container' });

        new ButtonComponent(buttonContainer)
            .setButtonText(t('confirmModal.cancel'))
            .onClick(() => {
                this.close();
                if (this.onCancel) this.onCancel();
            });

        new ButtonComponent(buttonContainer)
            .setButtonText(t('confirmModal.confirm'))
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
