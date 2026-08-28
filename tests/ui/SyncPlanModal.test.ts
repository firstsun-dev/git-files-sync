/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() mocks intentionally reference methods unbound; safe under Vitest's mocking model */
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { App } from 'obsidian';
import { SyncPlanModal } from '../../src/ui/SyncPlanModal';
import { SyncPlan } from '../../src/ui/types';
import { createContainer, setupObsidianDOM } from './setup-dom';

function emptyPlan(): SyncPlan {
    return { additions: [], modifications: [], deletions: [], moves: [] };
}

describe('SyncPlanModal', () => {
    beforeAll(() => { setupObsidianDOM(); });

    it('renders only the sections that have entries', () => {
        const plan: SyncPlan = {
            ...emptyPlan(),
            additions: [{ path: 'new.md', name: 'new.md' }],
            modifications: [{ path: 'changed.md', name: 'changed.md' }],
        };
        const modal = new SyncPlanModal(new App(), plan, 'push', vi.fn());
        modal.contentEl = createContainer();

        modal.onOpen();

        const headings = Array.from(modal.contentEl.querySelectorAll('.sync-plan-section-heading')).map(h => h.textContent);
        expect(headings).toEqual(['Additions (1)', 'Modifications (1)']);
        expect(modal.contentEl.querySelector('.sync-plan-section.is-destructive')).toBeNull();
    });

    it('shows the destructive deletion warning when the plan includes deletions', () => {
        const plan: SyncPlan = { ...emptyPlan(), deletions: [{ path: 'gone.md', name: 'gone.md' }] };
        const modal = new SyncPlanModal(new App(), plan, 'delete', vi.fn());
        modal.contentEl = createContainer();

        modal.onOpen();

        const destructiveSection = modal.contentEl.querySelector('.sync-plan-section.is-destructive');
        expect(destructiveSection).not.toBeNull();
        expect(destructiveSection?.querySelector('.sync-plan-warning')?.textContent).toContain('1');
        expect(destructiveSection?.querySelector('.sync-plan-file-path')?.textContent).toBe('gone.md');
    });

    it('shows a moved-from note for move entries', () => {
        const plan: SyncPlan = { ...emptyPlan(), moves: [{ path: 'new-name.md', name: 'new-name.md', movedFrom: 'old-name.md' }] };
        const modal = new SyncPlanModal(new App(), plan, 'push', vi.fn());
        modal.contentEl = createContainer();

        modal.onOpen();

        expect(modal.contentEl.querySelector('.sync-plan-file-moved-from')?.textContent).toContain('old-name.md');
    });

    it('calls onConfirm and closes when Apply is clicked', () => {
        const onConfirm = vi.fn();
        const plan: SyncPlan = { ...emptyPlan(), additions: [{ path: 'new.md', name: 'new.md' }] };
        const modal = new SyncPlanModal(new App(), plan, 'push', onConfirm);
        modal.contentEl = createContainer();
        modal.close = vi.fn();

        modal.onOpen();

        const buttons = Array.from(modal.contentEl.querySelectorAll('button'));
        const applyBtn = buttons.find(b => b.textContent === 'Apply');
        applyBtn?.dispatchEvent(new Event('click'));

        expect(onConfirm).toHaveBeenCalledOnce();
        expect(modal.close).toHaveBeenCalledOnce();
    });

    it('calls onCancel and not onConfirm when Cancel is clicked', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        const plan: SyncPlan = { ...emptyPlan(), additions: [{ path: 'new.md', name: 'new.md' }] };
        const modal = new SyncPlanModal(new App(), plan, 'push', onConfirm, onCancel);
        modal.contentEl = createContainer();
        modal.close = vi.fn();

        modal.onOpen();

        const buttons = Array.from(modal.contentEl.querySelectorAll('button'));
        const cancelBtn = buttons.find(b => b.textContent === 'Cancel');
        cancelBtn?.dispatchEvent(new Event('click'));

        expect(onCancel).toHaveBeenCalledOnce();
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

/* eslint-enable @typescript-eslint/unbound-method -- re-enable after the whole-file exemption above */
