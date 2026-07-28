import { App, Modal, setIcon, ButtonComponent } from 'obsidian';
import { t, TranslationKey } from '../i18n';
import { SyncPlan, SyncPlanEntry } from './types';
import { ICONS } from './components/icons';

export type SyncPlanDirection = 'push' | 'pull' | 'delete';

const SECTION_ORDER: Array<{ key: keyof SyncPlan; icon: string; titleKey: TranslationKey; destructive: boolean }> = [
    { key: 'additions', icon: ICONS.addition, titleKey: 'syncPlanModal.section.additions', destructive: false },
    { key: 'modifications', icon: ICONS.modified, titleKey: 'syncPlanModal.section.modifications', destructive: false },
    { key: 'moves', icon: ICONS.moved, titleKey: 'syncPlanModal.section.moves', destructive: false },
    { key: 'deletions', icon: ICONS.delete, titleKey: 'syncPlanModal.section.deletions', destructive: true },
];

/**
 * Terraform-style plan review shown before a push, pull, or remote deletion
 * actually applies. Deletions are rendered in their own visually distinct
 * section so a destructive remote change is never buried among ordinary
 * additions/modifications.
 */
export class SyncPlanModal extends Modal {
    private readonly plan: SyncPlan;
    private readonly direction: SyncPlanDirection;
    private readonly onConfirm: () => void;
    private readonly onCancel?: () => void;
    private readonly description?: string;

    constructor(app: App, plan: SyncPlan, direction: SyncPlanDirection, onConfirm: () => void, onCancel?: () => void, description?: string) {
        super(app);
        this.plan = plan;
        this.direction = direction;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        this.description = description;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('sync-plan-modal');

        contentEl.createEl('h2', { text: t(`syncPlanModal.title.${this.direction}`) });
        if (this.description) {
            contentEl.createEl('p', { text: this.description, cls: 'sync-plan-description' });
        }

        const listEl = contentEl.createDiv({ cls: 'sync-plan-sections' });
        for (const section of SECTION_ORDER) {
            const entries = this.plan[section.key];
            if (entries.length === 0) continue;
            this.renderSection(listEl, section.titleKey, section.icon, entries, section.destructive);
        }

        const buttonContainer = contentEl.createDiv({ cls: 'sync-plan-buttons modal-button-container' });

        new ButtonComponent(buttonContainer)
            .setButtonText(t('syncPlanModal.cancel'))
            .onClick(() => {
                this.close();
                if (this.onCancel) this.onCancel();
            });

        const confirmBtn = new ButtonComponent(buttonContainer)
            .setButtonText(t('syncPlanModal.confirm'))
            .setCta()
            .onClick(() => {
                this.close();
                this.onConfirm();
            });
        if (this.plan.deletions.length > 0) {
            const setWarning = (confirmBtn as unknown as { setWarning?: () => unknown }).setWarning;
            if (typeof setWarning === 'function') setWarning.call(confirmBtn);
        }
    }

    private renderSection(
        container: HTMLElement,
        titleKey: TranslationKey,
        icon: string,
        entries: SyncPlanEntry[],
        destructive: boolean
    ): void {
        const section = container.createDiv({ cls: `sync-plan-section${destructive ? ' is-destructive' : ''}` });
        const heading = section.createDiv({ cls: 'sync-plan-section-heading' });
        const iconEl = heading.createSpan({ cls: 'sync-plan-section-icon' });
        setIcon(iconEl, icon);
        heading.createSpan({ text: `${t(titleKey)} (${entries.length})` });

        if (destructive) {
            section.createDiv({ cls: 'sync-plan-warning', text: t('syncPlanModal.deletionWarning', { count: entries.length }) });
        }

        const list = section.createEl('ul', { cls: 'sync-plan-file-list' });
        for (const entry of entries) {
            const item = list.createEl('li', { cls: 'sync-plan-file-item' });
            item.createSpan({ cls: 'sync-plan-file-path', text: entry.path });
            if (entry.movedFrom) {
                item.createSpan({ cls: 'sync-plan-file-moved-from', text: t('syncPlanModal.movedFrom', { path: entry.movedFrom }) });
            }
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
