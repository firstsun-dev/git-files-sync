import { App, Modal, ButtonComponent } from 'obsidian';
import { t } from '../i18n';
import { GitServiceInterface } from '../services/git-service-interface';
import type { BatchPushConflict, ConflictResolution } from '../logic/sync-manager';
import { isBinaryPath } from '../utils/path';
import { SyncConflictModal } from './SyncConflictModal';

/**
 * Resolves every conflict from one batch push in a single screen — never one
 * modal per conflicted file. Bulk actions (Keep Local/Remote/Skip for All)
 * and per-row radios only mutate each conflict's `resolution` in place;
 * nothing is written anywhere until the caller applies the resolved plan
 * after this modal's Continue button. "View Diff" reuses the existing
 * single-file `SyncConflictModal` for the detailed comparison, fetching that
 * row's remote content lazily (only when actually inspected) via
 * `getBlob(remoteSha, repoPath)` so resolving a large batch of conflicts
 * via bulk actions never has to download content nobody looks at.
 */
export class BatchConflictResolutionModal extends Modal {
    private readonly gitService: GitServiceInterface;
    private readonly conflicts: BatchPushConflict[];
    private readonly totalFiles: number;
    private readonly safeCount: number;
    private readonly onResolve: () => void;
    private readonly onCancel: () => void;

    private rowRadios = new Map<string, Record<ConflictResolution, HTMLInputElement>>();
    private continueBtn?: ButtonComponent;
    private remoteContentCache = new Map<string, string | ArrayBuffer>();

    constructor(
        app: App,
        gitService: GitServiceInterface,
        conflicts: BatchPushConflict[],
        totalFiles: number,
        safeCount: number,
        onResolve: () => void,
        onCancel: () => void,
    ) {
        super(app);
        this.gitService = gitService;
        this.conflicts = conflicts;
        this.totalFiles = totalFiles;
        this.safeCount = safeCount;
        this.onResolve = onResolve;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('sync-conflict-modal');
        contentEl.addClass('batch-conflict-modal');

        contentEl.createEl('h2', {
            text: t('batchConflictModal.title', { count: this.conflicts.length, total: this.totalFiles })
        });
        contentEl.createEl('p', {
            cls: 'conflict-description',
            text: t('batchConflictModal.description', {
                safeCount: this.safeCount,
                conflictCount: this.conflicts.length,
            }),
        });

        const bulkActions = contentEl.createDiv({ cls: 'batch-conflict-bulk-actions' });
        new ButtonComponent(bulkActions)
            .setButtonText(t('batchConflictModal.keepLocalAll'))
            .onClick(() => this.setAllResolutions('keep-local'));
        new ButtonComponent(bulkActions)
            .setButtonText(t('batchConflictModal.keepRemoteAll'))
            .onClick(() => this.setAllResolutions('keep-remote'));
        new ButtonComponent(bulkActions)
            .setButtonText(t('batchConflictModal.skipAll'))
            .onClick(() => this.setAllResolutions('skip'));

        const rowList = contentEl.createDiv({ cls: 'batch-conflict-row-list' });
        for (const conflict of this.conflicts) {
            this.renderRow(rowList, conflict);
        }

        const buttonContainer = contentEl.createDiv({ cls: 'conflict-buttons batch-conflict-buttons' });
        new ButtonComponent(buttonContainer)
            .setButtonText(t('batchConflictModal.cancel'))
            .onClick(() => {
                this.close();
                this.onCancel();
            });

        this.continueBtn = new ButtonComponent(buttonContainer)
            .setButtonText(t('batchConflictModal.continue'))
            .setCta()
            .setTooltip(t('batchConflictModal.unresolvedWarning'))
            .onClick(() => {
                if (!this.allResolved()) return;
                this.close();
                this.onResolve();
            });

        this.updateContinueState();
    }

    private renderRow(container: HTMLElement, conflict: BatchPushConflict): void {
        const row = container.createDiv({ cls: 'batch-conflict-row' });

        const info = row.createDiv({ cls: 'batch-conflict-row-info' });
        info.createSpan({ cls: 'batch-conflict-row-path', text: conflict.path });
        info.createSpan({ cls: 'batch-conflict-row-badge', text: t('batchConflictModal.row.badge') });
        if (isBinaryPath(conflict.path)) {
            info.createSpan({ cls: 'batch-conflict-row-binary-badge', text: t('batchConflictModal.row.binary') });
        }

        const viewDiffBtn = row.createEl('button', { cls: 'batch-conflict-view-diff', text: t('batchConflictModal.row.viewDiff') });
        viewDiffBtn.addEventListener('click', () => void this.openDiff(conflict));

        const radios = row.createDiv({ cls: 'batch-conflict-row-radios' });
        const radioEls = {} as Record<ConflictResolution, HTMLInputElement>;
        const options: Array<{ value: ConflictResolution; labelKey: 'batchConflictModal.row.keepLocal' | 'batchConflictModal.row.keepRemote' | 'batchConflictModal.row.skip' }> = [
            { value: 'keep-local', labelKey: 'batchConflictModal.row.keepLocal' },
            { value: 'keep-remote', labelKey: 'batchConflictModal.row.keepRemote' },
            { value: 'skip', labelKey: 'batchConflictModal.row.skip' },
        ];
        for (const option of options) {
            const label = radios.createEl('label', { cls: 'batch-conflict-radio-label' });
            const input = label.createEl('input');
            input.type = 'radio';
            input.name = `batch-conflict-${conflict.path}`;
            input.checked = conflict.resolution === option.value;
            input.addEventListener('change', () => {
                if (!input.checked) return;
                conflict.resolution = option.value;
                this.updateContinueState();
            });
            label.createSpan({ text: t(option.labelKey) });
            radioEls[option.value] = input;
        }
        this.rowRadios.set(conflict.path, radioEls);
    }

    private setAllResolutions(resolution: ConflictResolution): void {
        for (const conflict of this.conflicts) {
            conflict.resolution = resolution;
            const radios = this.rowRadios.get(conflict.path);
            if (!radios) continue;
            (Object.keys(radios) as ConflictResolution[]).forEach(key => {
                radios[key].checked = key === resolution;
            });
        }
        this.updateContinueState();
    }

    private allResolved(): boolean {
        return this.conflicts.every(c => !!c.resolution);
    }

    private updateContinueState(): void {
        if (!this.continueBtn) return;
        this.continueBtn.setDisabled(!this.allResolved());
    }

    /** Lazily fetches this row's remote content (cached once fetched) and opens the reusable single-file conflict viewer for a detailed look, wiring its choice back into this row's resolution. */
    private async openDiff(conflict: BatchPushConflict): Promise<void> {
        let remoteContent = this.remoteContentCache.get(conflict.path);
        if (remoteContent === undefined) {
            try {
                const blob = await this.gitService.getBlob(conflict.remoteSha, conflict.repoPath);
                remoteContent = blob.content;
            } catch {
                return;
            }
            this.remoteContentCache.set(conflict.path, remoteContent);
        }

        new SyncConflictModal(this.app, conflict.name, conflict.localContent, remoteContent, (choice) => {
            conflict.resolution = choice === 'local' ? 'keep-local' : 'keep-remote';
            const radios = this.rowRadios.get(conflict.path);
            if (radios) {
                (Object.keys(radios) as ConflictResolution[]).forEach(key => {
                    radios[key].checked = key === conflict.resolution;
                });
            }
            this.updateContinueState();
        }).open();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
