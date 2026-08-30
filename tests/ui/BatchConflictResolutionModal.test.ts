import { beforeAll, describe, it, expect, vi } from 'vitest';
import { App } from 'obsidian';
import { BatchConflictResolutionModal } from '../../src/ui/BatchConflictResolutionModal';
import type { BatchPushConflict } from '../../src/logic/sync-manager';
import type { GitServiceInterface } from '../../src/services/git-service-interface';
import { createContainer, setupObsidianDOM } from './setup-dom';

function makeConflicts(): BatchPushConflict[] {
    return [
        { path: 'a.md', name: 'a.md', repoPath: 'a.md', localContent: 'local a', remoteSha: 'sha-a' },
        { path: 'b.md', name: 'b.md', repoPath: 'b.md', localContent: 'local b', remoteSha: 'sha-b' },
    ];
}

function fakeGitService(): GitServiceInterface {
    return {
        getBlob: vi.fn().mockResolvedValue({ content: 'remote content', sha: 'sha-a' }),
    } as unknown as GitServiceInterface;
}

describe('BatchConflictResolutionModal', () => {
    beforeAll(() => { setupObsidianDOM(); });

    it('shows the conflict count in the header and omits the safe-count line when zero', () => {
        const conflicts = makeConflicts();
        const modal = new BatchConflictResolutionModal(new App(), fakeGitService(), conflicts, 0, vi.fn(), vi.fn());
        modal.contentEl = createContainer();

        modal.onOpen();

        expect(modal.contentEl.querySelector('h2')?.textContent).toContain('2');
        expect(modal.contentEl.querySelector('h2')?.textContent).not.toContain('5');
        expect(modal.contentEl.querySelector('.conflict-description')).toBeNull();
    });

    it('mentions how many other files are ready when there are safe files alongside conflicts', () => {
        const conflicts = makeConflicts();
        const modal = new BatchConflictResolutionModal(new App(), fakeGitService(), conflicts, 3, vi.fn(), vi.fn());
        modal.contentEl = createContainer();

        modal.onOpen();

        expect(modal.contentEl.querySelector('.conflict-description')?.textContent).toContain('3');
    });

    it('renders one row per conflict with a radio per resolution', () => {
        const conflicts = makeConflicts();
        const modal = new BatchConflictResolutionModal(new App(), fakeGitService(), conflicts, 0, vi.fn(), vi.fn());
        modal.contentEl = createContainer();

        modal.onOpen();

        const rows = modal.contentEl.querySelectorAll('.batch-conflict-row');
        expect(rows.length).toBe(2);
        const radios = modal.contentEl.querySelectorAll('input[type="radio"]');
        expect(radios.length).toBe(6); // 3 options × 2 rows
    });

    it('disables Continue until every conflict has a resolution, then enables it', () => {
        const conflicts = makeConflicts();
        const onResolve = vi.fn();
        const modal = new BatchConflictResolutionModal(new App(), fakeGitService(), conflicts, 0, onResolve, vi.fn());
        modal.contentEl = createContainer();

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
        const modal = new BatchConflictResolutionModal(new App(), fakeGitService(), conflicts, 0, vi.fn(), vi.fn());
        modal.contentEl = createContainer();

        modal.onOpen();

        const bulkButtons = Array.from(modal.contentEl.querySelectorAll('.batch-conflict-bulk-actions button'));
        const keepLocalAll = bulkButtons.find(b => b.textContent === 'Keep Local for All')!;
        keepLocalAll.dispatchEvent(new Event('click'));

        expect(conflicts.every(c => c.resolution === 'keep-local')).toBe(true);
        const checkedRadios = Array.from(modal.contentEl.querySelectorAll('input[type="radio"]:checked'));
        expect(checkedRadios.length).toBe(2);
    });

    it('calls onCancel and not onResolve when Cancel is clicked', () => {
        const onResolve = vi.fn();
        const onCancel = vi.fn();
        const modal = new BatchConflictResolutionModal(new App(), fakeGitService(), makeConflicts(), 0, onResolve, onCancel);
        modal.contentEl = createContainer();
        modal.close = vi.fn();

        modal.onOpen();

        const buttons = Array.from(modal.contentEl.querySelectorAll('button'));
        const cancelBtn = buttons.find(b => b.textContent === 'Cancel')!;
        cancelBtn.dispatchEvent(new Event('click'));

        expect(onCancel).toHaveBeenCalledOnce();
        expect(onResolve).not.toHaveBeenCalled();
    });

    it('marks a binary conflict row without attempting a text diff', () => {
        const conflicts: BatchPushConflict[] = [
            { path: 'image.png', name: 'image.png', repoPath: 'image.png', localContent: new ArrayBuffer(3), remoteSha: 'sha-img' },
        ];
        const modal = new BatchConflictResolutionModal(new App(), fakeGitService(), conflicts, 0, vi.fn(), vi.fn());
        modal.contentEl = createContainer();

        modal.onOpen();

        expect(modal.contentEl.querySelector('.batch-conflict-row-binary-badge')).not.toBeNull();
    });
});
