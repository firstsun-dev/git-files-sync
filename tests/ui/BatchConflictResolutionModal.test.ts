import { beforeAll, describe, it, expect, vi } from 'vitest';
import { App } from 'obsidian';
import { BatchConflictResolutionModal, type ConflictDiffLoader } from '../../src/ui/BatchConflictResolutionModal';
import type { BatchPushConflict } from '../../src/logic/sync-manager';
import type { DiffStatLoadResult } from '../../src/ui/source-control/DiffStatProvider';
import { createContainer, setupObsidianDOM } from './setup-dom';

function makeConflicts(): BatchPushConflict[] {
    return [
        { path: 'a.md', name: 'a.md', repoPath: 'a.md', localContent: 'local a', remoteSha: 'sha-a' },
        { path: 'b.md', name: 'b.md', repoPath: 'b.md', localContent: 'local b', remoteSha: 'sha-b' },
    ];
}

function newModal(
    conflicts: BatchPushConflict[],
    options: {
        safeCount?: number;
        onResolve?: () => void;
        onCancel?: () => void;
        loadConflictDiff?: ConflictDiffLoader;
        diffStatLoader?: (conflict: never) => Promise<DiffStatLoadResult>;
    } = {},
) {
    const { safeCount = 0, onResolve = vi.fn(), onCancel = vi.fn(), loadConflictDiff, diffStatLoader } = options;
    const modal = new BatchConflictResolutionModal(
        new App(), conflicts, safeCount, onResolve, onCancel,
        loadConflictDiff, diffStatLoader,
    );
    modal.contentEl = createContainer();
    return modal;
}

async function flushMicrotasks(): Promise<void> {
    await new Promise(resolve => window.setTimeout(resolve, 0));
}

describe('BatchConflictResolutionModal', () => {
    beforeAll(() => { setupObsidianDOM(); });

    it('shows the conflict count in the header and omits the safe-count line when zero', () => {
        const modal = newModal(makeConflicts());

        modal.onOpen();

        expect(modal.contentEl.querySelector('h2')?.textContent).toContain('2');
        expect(modal.contentEl.querySelector('h2')?.textContent).not.toContain('5');
        expect(modal.contentEl.querySelector('.conflict-description')).toBeNull();
    });

    it('mentions how many other files are ready when there are safe files alongside conflicts', () => {
        const modal = newModal(makeConflicts(), { safeCount: 3 });

        modal.onOpen();

        expect(modal.contentEl.querySelector('.conflict-description')?.textContent).toContain('3');
    });

    it('renders one row per conflict with a radio per resolution and a full-path tooltip', () => {
        const modal = newModal(makeConflicts());

        modal.onOpen();

        const rows = modal.contentEl.querySelectorAll('.batch-conflict-row');
        expect(rows.length).toBe(2);
        const radios = modal.contentEl.querySelectorAll('input[type="radio"]');
        expect(radios.length).toBe(6); // 3 options × 2 rows
        // A dense-grid row ellipsizes long names; the full path stays on title.
        expect(rows[0]!.getAttribute('title')).toBe('a.md');
    });

    it('disables Continue until every conflict has a resolution, then enables it', () => {
        const conflicts = makeConflicts();
        const onResolve = vi.fn();
        const modal = newModal(conflicts, { onResolve });

        modal.onOpen();

        const buttons = Array.from(modal.contentEl.querySelectorAll('button'));
        const continueBtn = buttons.find(b => b.textContent === 'Continue')!;
        expect(continueBtn.disabled).toBe(true);

        continueBtn.dispatchEvent(new Event('click'));
        expect(onResolve).not.toHaveBeenCalled();

        // Resolve both conflicts via their radios.
        const rows = Array.from(modal.contentEl.querySelectorAll('.batch-conflict-row'));
        for (const row of rows) {
            const radios = Array.from(row.querySelectorAll('input[type="radio"]'));
            const skipRadio = radios[2]! as HTMLInputElement; // keep-local, keep-remote, skip
            skipRadio.checked = true;
            skipRadio.dispatchEvent(new Event('change'));
        }

        expect(continueBtn.disabled).toBe(false);
        continueBtn.dispatchEvent(new Event('click'));
        expect(onResolve).toHaveBeenCalledOnce();
        expect(conflicts.every(c => c.resolution === 'skip')).toBe(true);
    });

    it('"Keep Local for All" sets every conflict\'s resolution and checks the matching radio', () => {
        const conflicts = makeConflicts();
        const modal = newModal(conflicts);

        modal.onOpen();

        const keepLocalAll = Array.from(modal.contentEl.querySelectorAll('.batch-conflict-bulk-actions button'))
            .find(b => b.textContent === 'Keep Local for All')!;
        keepLocalAll.dispatchEvent(new Event('click'));

        expect(conflicts.every(c => c.resolution === 'keep-local')).toBe(true);
        const checkedRadios = Array.from(modal.contentEl.querySelectorAll('input[type="radio"]:checked'));
        expect(checkedRadios.length).toBe(2);
    });

    it('calls onCancel and not onResolve when Cancel is clicked', () => {
        const onResolve = vi.fn();
        const onCancel = vi.fn();
        const modal = newModal(makeConflicts(), { onResolve, onCancel });
        modal.close = vi.fn();

        modal.onOpen();

        const cancelBtn = Array.from(modal.contentEl.querySelectorAll('button'))
            .find(b => b.textContent === 'Cancel')!;
        cancelBtn.dispatchEvent(new Event('click'));

        expect(onCancel).toHaveBeenCalledOnce();
        expect(onResolve).not.toHaveBeenCalled();
    });

    it('marks a binary conflict row without attempting a text diff', () => {
        const conflicts: BatchPushConflict[] = [
            { path: 'image.png', name: 'image.png', repoPath: 'image.png', localContent: new ArrayBuffer(3), remoteSha: 'sha-img' },
        ];
        const loadDiff = vi.fn();
        const statLoader = vi.fn();
        const modal = newModal(conflicts, {
            loadConflictDiff: loadDiff as unknown as ConflictDiffLoader,
            diffStatLoader: statLoader,
        });

        modal.onOpen();

        expect(modal.contentEl.querySelector('.batch-conflict-row-binary-badge')).not.toBeNull();
        modal.onClose();
    });

    // -------------------------------------------------------------------
    // Diff-stat loading lifecycle
    // -------------------------------------------------------------------

    it('fills in a row stat once the loader settles, without resetting radio state', async () => {
        const conflicts = makeConflicts();
        const pending: Array<(result: DiffStatLoadResult) => void> = [];
        const statLoader = vi.fn().mockImplementation(
            () => new Promise<DiffStatLoadResult>(resolve => pending.push(resolve)),
        );
        const modal = newModal(conflicts, { diffStatLoader: statLoader });

        modal.onOpen();
        await flushMicrotasks();
        // Modal opened with empty stat slots; loader called once per row.
        expect(modal.contentEl.querySelectorAll('.scv-diff-stat').length).toBe(0);
        expect(statLoader).toHaveBeenCalledTimes(2);

        // Resolve both rows while their stats are still in flight.
        for (const row of Array.from(modal.contentEl.querySelectorAll('.batch-conflict-row'))) {
            const radio = row.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement; // keep-remote
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
        }

        // Stats land → painted into their slots in place.
        for (const release of pending) {
            release({ status: 'ready', stat: { additions: 3, deletions: 1 } });
        }
        await flushMicrotasks();

        const stats = modal.contentEl.querySelectorAll('.batch-conflict-row-stat .scv-diff-stat-add');
        expect(stats.length).toBe(2);
        expect(stats[0]!.textContent).toBe('+3');

        // The radio choice made during the in-flight window survived the repaint.
        const checked = modal.contentEl.querySelectorAll('input[type="radio"]:checked');
        expect(checked.length).toBe(2);
        expect(conflicts.every(c => c.resolution === 'keep-remote')).toBe(true);
        modal.onClose();
    });

    it('renders one row per conflict for a 40-conflict batch', () => {
        const conflicts = Array.from({ length: 40 }, (_, i) => ({
            path: `f${i}.md`, name: `f${i}.md`, repoPath: `f${i}.md`, localContent: `local ${i}`, remoteSha: `s${i}`,
        }));
        const statLoader = vi.fn().mockResolvedValue({ status: 'unavailable' });
        const modal = newModal(conflicts, { diffStatLoader: statLoader });

        modal.onOpen();

        expect(modal.contentEl.querySelectorAll('.batch-conflict-row').length).toBe(40);
        expect(modal.contentEl.querySelectorAll('.batch-conflict-row-stat').length).toBe(40);
        modal.onClose();
    });

    it('closing the modal stops the stat queue — pending loads never paint afterwards', async () => {
        const conflicts = makeConflicts();
        const pending: Array<(result: DiffStatLoadResult) => void> = [];
        const statLoader = vi.fn().mockImplementation(
            () => new Promise<DiffStatLoadResult>(resolve => pending.push(resolve)),
        );
        const modal = newModal(conflicts, { diffStatLoader: statLoader });

        modal.onOpen();
        await flushMicrotasks();
        const callsAfterOpen = statLoader.mock.calls.length;
        expect(callsAfterOpen).toBe(2);

        modal.onClose();

        // Every in-flight stat settles AFTER the modal closed.
        for (const release of pending) release({ status: 'ready', stat: { additions: 9, deletions: 0 } });
        await flushMicrotasks();

        // Nothing repaints into the emptied DOM, and the loader was never queried again.
        expect(modal.contentEl.textContent).toBe('');
        expect(statLoader.mock.calls.length).toBe(callsAfterOpen);
    });

    it('a stat loader rejecting after close is swallowed — no unhandled rejection', async () => {
        const rejections: Array<(error: unknown) => void> = [];
        const statLoader = vi.fn().mockImplementation(
            () => new Promise<DiffStatLoadResult>((_, reject) => rejections.push(reject)),
        );
        const modal = newModal(makeConflicts(), { diffStatLoader: statLoader });

        modal.onOpen();
        await flushMicrotasks();
        modal.onClose();

        for (const reject of rejections) reject(new Error('late failure'));
        await flushMicrotasks();
        expect(modal.contentEl.textContent).toBe('');
    });

    // -------------------------------------------------------------------
    // View Diff data boundary + modal shell
    // -------------------------------------------------------------------

    it('modalEl carries the shared conflict shell + batch variant + diff surface classes', () => {
        const modal = newModal(makeConflicts());

        modal.onOpen();

        expect(modal.modalEl.classList.contains('gfs-conflict-modal')).toBe(true);
        expect(modal.modalEl.classList.contains('gfs-conflict-modal--batch')).toBe(true);
        expect(modal.modalEl.classList.contains('gfs-diff-surface')).toBe(true);
    });

    it('View Diff resolves both sides through the shared conflict diff loader', async () => {
        const loadDiff = vi.fn().mockImplementation((conflict: { localContent: string }) =>
            Promise.resolve({ localContent: conflict.localContent, remoteContent: 'remote text' }));
        const conflicts = makeConflicts();
        const modal = newModal(conflicts, { loadConflictDiff: loadDiff });

        modal.onOpen();

        const viewDiffBtn = modal.contentEl.querySelector('.batch-conflict-view-diff') as HTMLButtonElement;
        viewDiffBtn.dispatchEvent(new Event('click'));
        await flushMicrotasks();

        expect(loadDiff).toHaveBeenCalledTimes(1);
        expect(loadDiff).toHaveBeenCalledWith({
            path: 'a.md', localContent: 'local a', remoteSha: 'sha-a', repoPath: 'a.md',
        });
        modal.onClose();
    });

    it('a second View Diff click on one row reuses the in-flight load instead of stacking', async () => {
        let release!: () => void;
        const loadDiff = vi.fn().mockImplementation((conflict: { localContent: string }) =>
            new Promise(resolve => {
                release = () => resolve({ localContent: conflict.localContent, remoteContent: 'remote' });
            }));
        const modal = newModal([makeConflicts()[0]!], { loadConflictDiff: loadDiff });

        modal.onOpen();

        const viewDiffBtn = modal.contentEl.querySelector('.batch-conflict-view-diff') as HTMLButtonElement;
        viewDiffBtn.dispatchEvent(new Event('click'));
        await flushMicrotasks();
        viewDiffBtn.dispatchEvent(new Event('click'));
        await flushMicrotasks();

        release();
        await flushMicrotasks();

        expect(loadDiff).toHaveBeenCalledTimes(1);
        modal.onClose();
    });
});