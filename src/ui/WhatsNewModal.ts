import { App, Modal, ButtonComponent } from 'obsidian';
import { type ChangelogRelease } from '../changelog';

const CHANGELOG_URL = 'https://github.com/firstsun-dev/git-files-sync/blob/main/CHANGELOG.md';

export class WhatsNewModal extends Modal {
    private readonly releases: ChangelogRelease[];

    constructor(app: App, releases: ChangelogRelease[]) {
        super(app);
        this.releases = releases;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: "What's new" });

        for (const release of this.releases) {
            contentEl.createEl('h4', { text: `v${release.version}` });
            const list = contentEl.createEl('ul', { cls: 'ssv-whats-new-list' });
            for (const entry of release.entries) {
                const item = list.createEl('li', { cls: entry.notable ? 'ssv-whats-new-notable' : undefined });
                item.setText(entry.text);
            }
        }

        const buttonContainer = contentEl.createDiv({ cls: 'ssv-confirm-buttons modal-button-container' });

        new ButtonComponent(buttonContainer)
            .setButtonText('View full changelog')
            .onClick(() => window.open(CHANGELOG_URL, '_blank', 'noopener'));

        new ButtonComponent(buttonContainer)
            .setButtonText('Got it')
            .setCta()
            .onClick(() => this.close());
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
