import { App, Modal, ButtonComponent } from 'obsidian';
import { type ChangelogRelease, entryText, resolveText } from '../changelog';
import { t } from '../i18n';

const CHANGELOG_URL = 'https://github.com/firstsun-dev/git-files-sync/blob/main/CHANGELOG.md';
const REPOSITORY_URL = 'https://github.com/firstsun-dev/git-files-sync';

export class WhatsNewModal extends Modal {
    private readonly releases: ChangelogRelease[];
    private readonly onOpenSourceControl?: () => void;

    constructor(app: App, releases: ChangelogRelease[], onOpenSourceControl?: () => void) {
        super(app);
        this.releases = releases;
        this.onOpenSourceControl = onOpenSourceControl;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: t('whatsNew.title') });

        for (const release of this.releases) {
            if (release.headline && release.onboarding) {
                this.renderOnboardingRelease(contentEl, release);
            } else {
                this.renderLegacyRelease(contentEl, release);
            }
        }

        const buttonContainer = contentEl.createDiv({ cls: 'ssv-confirm-buttons modal-button-container' });
        const primaryRelease = this.releases[0];

        if (primaryRelease?.onboarding?.action === 'open-source-control') {
            new ButtonComponent(buttonContainer)
                .setButtonText(t('whatsNew.openSourceControl'))
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onOpenSourceControl?.();
                });

            new ButtonComponent(buttonContainer)
                .setButtonText(t('whatsNew.viewChangelog'))
                .onClick(() => window.open(CHANGELOG_URL, '_blank', 'noopener'));

            new ButtonComponent(buttonContainer)
                .setButtonText(t('whatsNew.close'))
                .onClick(() => this.close());
        } else {
            new ButtonComponent(buttonContainer)
                .setButtonText(t('whatsNew.viewOnGitHub'))
                .onClick(() => window.open(REPOSITORY_URL, '_blank', 'noopener'));

            new ButtonComponent(buttonContainer)
                .setButtonText(t('whatsNew.viewChangelog'))
                .onClick(() => window.open(CHANGELOG_URL, '_blank', 'noopener'));

            new ButtonComponent(buttonContainer)
                .setButtonText(t('whatsNew.gotIt'))
                .setCta()
                .onClick(() => this.close());
        }
    }

    private renderLegacyRelease(contentEl: HTMLElement, release: ChangelogRelease): void {
        contentEl.createEl('h4', { text: `v${release.version}` });
        const list = contentEl.createEl('ul', { cls: 'ssv-whats-new-list' });
        for (const entry of release.entries) {
            const item = list.createEl('li', { cls: entry.notable ? 'ssv-whats-new-notable' : undefined });
            item.setText(entryText(entry));
        }
    }

    private renderOnboardingRelease(contentEl: HTMLElement, release: ChangelogRelease): void {
        contentEl.createEl('h4', { text: resolveText(release.headline!) });
        if (release.summary) {
            contentEl.createEl('p', { text: resolveText(release.summary), cls: 'ssv-whats-new-summary' });
        }

        const steps = contentEl.createEl('ol', { cls: 'ssv-whats-new-steps' });
        release.onboarding!.steps.forEach((step, index) => {
            const item = steps.createEl('li', { cls: 'ssv-whats-new-step' });
            item.createEl('span', { cls: 'ssv-whats-new-step-label', text: t('whatsNew.stepLabel', { number: index + 1 }) });
            item.createEl('strong', { text: resolveText(step.title) });
            if (step.description) {
                item.createEl('p', { text: resolveText(step.description) });
            }
        });

        const list = contentEl.createEl('ul', { cls: 'ssv-whats-new-list' });
        for (const entry of release.entries) {
            const item = list.createEl('li', { cls: entry.notable ? 'ssv-whats-new-notable' : undefined });
            item.setText(entryText(entry));
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
