import { App, Modal, ButtonComponent } from 'obsidian';
import { t } from '../i18n';
import type { BatchPushConflict, ConflictResolution } from '../logic/sync-manager';
import type { ConflictDiffStatLoader } from '../logic/sync/SyncInteractionPort';
import { isBinaryPath } from '../utils/path';
import { SyncConflictModal } from './SyncConflictModal';
import { DiffStatProvider, type DiffStatItem } from './source-control/DiffStatProvider';
import { renderDiffStat } from './source-control/ChangeItem';

/** A conflict keyed for the shared diff-stat cache by its (unique) path. */
type StatRow = BatchPushConflict & DiffStatItem<string>;

function statItemOf(conflict: BatchPushConflict): StatRow {
    return { ...conflict, id: conflict.path };
}

/**
 * Loads both sides of one conflict's detailed comparison, with remote
 * content fetched/cached/coalesced by the shared {@link SyncDiffService}
 * — the modal never touches a blob reader itself, so a background summary
 * stat and a user-opened diff share one remote round-trip.
 */
export type ConflictDiffLoader = (conflict: {
    path: string;
    localContent: string | ArrayBuffer;
    remoteSha: string;
    repoPath: string;
}) => Promise<{ localContent: string | ArrayBuffer; remoteContent: string | ArrayBuffer } | undefined>;

/**
 * Resolves every conflict from one batch push in a single screen — never one
 * modal per conflicted file. Header states only what drives the decision
 * (how many conflicts, how many other files are riding along) — the push
 * total is redundant listing arithmetic. Bulk actions (Keep Local/Remote/
 * Skip for All) and per-row radios only mutate each conflict's `resolution`
 * in place; nothing is written anywhere until the caller applies the
 * resolved plan after this modal's Continue button. "View Diff" reuses the
 * existing single-file `SyncConflictModal` for the detailed comparison,
 * fetching that row's remote content lazily (only when actually inspected)
 * through the shared `ConflictDiffLoader` so resolving a large batch of
 * conflicts via bulk actions never has to download content nobody looks
 * at.
 *
 * Each row may also show a progressive +/- diff stat when a
 * `ConflictDiffStatLoader` was supplied: the modal opens immediately, stats
 * land in the background through the shared bounded `DiffStatProvider`
 * (max 4 concurrent loads) and fill in as they arrive. A row with no data
 * simply shows no stat — opening the modal never waits on provider fetches.
 * Closing the modal disposes the provider: queued stats are dropped and
 * in-flight ones may not commit.
 */
export class BatchConflictResolutionModal extends Modal {
    private readonly conflicts: BatchPushConflict[];
    private readonly safeCount: number;
    private readonly onResolve: () => void;
    private readonly onCancel: () => void;

    private rowRadios = new Map<string, Record<ConflictResolution, HTMLInputElement>>();
    /** Stat span per conflict path so an async-landing stat can fill in without a full re-render. */
    private statSlots = new Map<string, HTMLElement>();
    private continueBtn?: ButtonComponent;
    /** Per-row in-flight diff loads so double-clicks don't stack two modals/fetches. */
    private readonly diffLoaders = new Map<string, Promise<void>>();
    private readonly diffStat?: DiffStatProvider<string, StatRow>;

    constructor(
        app: App,
        conflicts: BatchPushConflict[],
        safeCount: number,
        onResolve: () => void,
        onCancel: () => void,
        private readonly loadConflictDiff?: ConflictDiffLoader,
        diffStatLoader?: ConflictDiffStatLoader,
    ) {
        super(app);
        this.conflicts = conflicts;
        this.safeCount = safeCount;
        this.onResolve = onResolve;
        this.onCancel = onCancel;
        this.diffStat = diffStatLoader
            ? new DiffStatProvider<string, StatRow>(diffStatLoader, () => this.settleStats())
            : undefined;
    }

    onOpen() {
        const { contentEl, modalEl } = this;

        modalEl.addClass('gfs-conflict-modal');
        modalEl.addClass('gfs-conflict-modal--batch');
        modalEl.addClass('gfs-diff-surface');

        contentEl.createEl('h2', {
            text: t('batchConflictModal.title', { count: this.conflicts.length })
        });
        // Safe-count line is omitted when zero: "0 other files are ready"
        // is noise on top of the conflict list itself.
        if (this.safeCount > 0) {
            contentEl.createEl('p', {
                cls: 'conflict-description',
                text: t('batchConflictModal.description', { safeCount: this.safeCount }),
            });
        }

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
        rowList.querySelector<HTMLElement>('.batch-conflict-row:last-child')?.style.setProperty('border-bottom', 'none');

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

        // Progressive enhancement only: queue background stat loads after
        // the modal is fully rendered. Cheap in-memory stats land within a
        // microtask; remote-backed stats appear as fetches settle. Never
        // blocks or delays the modal opening itself.
        this.diffStat?.loadVisible(this.conflicts.map(statItemOf));
    }

    private renderRow(container: HTMLElement, conflict: BatchPushConflict): void {
        const row = container.createDiv({ cls: 'batch-conflict-row' });
        // A dense-grid row ellipsizes long filenames; the full path stays
        // reachable via native tooltip.
        row.setAttribute('title', conflict.path);

        const info = row.createDiv({ cls: 'batch-conflict-row-info' });
        const nameLine = info.createDiv({ cls: 'batch-conflict-row-name-line' });
        nameLine.createSpan({ cls: 'batch-conflict-row-name', text: conflict.name });
        const statSlot = nameLine.createSpan({ cls: 'batch-conflict-row-stat' });
        this.statSlots.set(conflict.path, statSlot);
        this.paintStat(conflict);
        info.createDiv({ cls: 'batch-conflict-row-dir', text: parentDirOf(conflict.path) });
        if (isBinaryPath(conflict.path)) {
            info.createSpan({ cls: 'batch-conflict-row-binary-badge', text: t('batchConflictModal.row.binary') });
        }

        const actions = row.createDiv({ cls: 'batch-conflict-row-actions' });
        const viewDiffBtn = actions.createEl('button', { cls: 'batch-conflict-view-diff', text: t('batchConflictModal.row.viewDiff') });
        viewDiffBtn.addEventListener('click', () => void this.openDiff(conflict));

        const radios = actions.createDiv({ cls: 'batch-conflict-row-radios' });
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

    /** Writes the conflict's cached stat (if any) into its row's stat slot. */
    private paintStat(conflict: BatchPushConflict): void {
        const slot = this.statSlots.get(conflict.path);
        if (!slot) return;
        slot.empty();
        renderDiffStat(slot, this.diffStat?.get(conflict.path));
    }

    /**
     * Settle callback from the shared {@link DiffStatProvider}: fills in each
     * row's stat in place instead of re-rendering the modal (which would
     * reset radio state inaccessible to a full rebuild).
     */
    private settleStats(): void {
        for (const conflict of this.conflicts) {
            this.paintStat(conflict);
        }
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

    /**
     * Lazily resolves both sides through the shared `ConflictDiffLoader`
     * (SyncDiffService — cached and in-flight-deduped there) and opens the
     * reusable single-file conflict viewer, wiring its choice back into
     * this row's resolution.
     */
    private async openDiff(conflict: BatchPushConflict): Promise<void> {
        const existing = this.diffLoaders.get(conflict.path);
        if (existing) {
            await existing.catch(() => {});
            return;
        }
        const load = (async () => {
            if (!this.loadConflictDiff) return;
            const diff = await this.loadConflictDiff({
                path: conflict.path,
                localContent: conflict.localContent,
                remoteSha: conflict.remoteSha,
                repoPath: conflict.repoPath,
            }).catch(() => undefined);
            if (!diff) return;
            // Fire-and-forget: lazyLoad already swallows loader rejections
            // internally; the empty catch only satisfies the lint rule.
            void this.diffStat?.lazyLoad(statItemOf(conflict)).catch(() => {});

            new SyncConflictModal(this.app, conflict.name, diff.localContent, diff.remoteContent, (choice) => {
                conflict.resolution = choice === 'local' ? 'keep-local' : 'keep-remote';
                const radios = this.rowRadios.get(conflict.path);
                if (radios) {
                    (Object.keys(radios) as ConflictResolution[]).forEach(key => {
                        radios[key].checked = key === conflict.resolution;
                    });
                }
                this.updateContinueState();
            }).open();
        })();
        this.diffLoaders.set(conflict.path, load);
        try {
            await load;
        } finally {
            this.diffLoaders.delete(conflict.path);
        }
    }

    onClose() {
        const { contentEl } = this;
        // Stop all queued/progressive stat work the moment the modal is
        // gone: no more pumps, and any still-running background load's
        // result is generation-invalidated (in-flight calls are simply
        // abandoned, not aborted — they can't commit into a dead cache).
        this.diffStat?.dispose();
        contentEl.empty();
        this.rowRadios.clear();
        this.statSlots.clear();
    }
}

/** Returns the file's parent directory without a trailing slash, or '' for a repo-root file. */
function parentDirOf(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx === -1 ? '' : path.slice(0, idx);
}