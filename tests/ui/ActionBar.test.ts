import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { renderActionBar, type ActionBarProps, type ActionBarCallbacks } from '../../src/ui/components/ActionBar';
import { setupObsidianDOM, createContainer } from './setup-dom';

beforeAll(() => { setupObsidianDOM(); });

const baseProps = (overrides?: Partial<ActionBarProps>): ActionBarProps => ({
    hasFiles: true, allSelected: false, indeterminate: false,
    canPush: 1, canPull: 1, canDelete: 1,
    ...overrides,
});

describe('renderActionBar', () => {
    let container: HTMLElement;
    let callbacks: ActionBarCallbacks;

    beforeEach(() => {
        container = createContainer();
        callbacks = {
            onRefresh:   vi.fn(),
            onSelectAll: vi.fn(),
            onPush:      vi.fn(),
            onPull:      vi.fn(),
            onDelete:    vi.fn(),
        };
    });

    describe('refresh button', () => {
        it('always renders when hasFiles is false', () => {
            renderActionBar(container, baseProps({ hasFiles: false }), callbacks);
            expect(container.querySelector('.ssv-btn-refresh')).not.toBeNull();
        });

        it('calls onRefresh when clicked', () => {
            renderActionBar(container, baseProps({ hasFiles: false }), callbacks);
            (container.querySelector('.ssv-btn-refresh') as HTMLButtonElement).click();
            expect(callbacks.onRefresh).toHaveBeenCalledOnce();
        });
    });

    describe('when hasFiles is false', () => {
        it('does not render push / pull / delete buttons', () => {
            renderActionBar(container, baseProps({ hasFiles: false }), callbacks);
            expect(container.querySelector('.ssv-btn-push')).toBeNull();
            expect(container.querySelector('.ssv-btn-pull')).toBeNull();
            expect(container.querySelector('.ssv-btn-danger')).toBeNull();
        });

        it('does not render select-all row', () => {
            renderActionBar(container, baseProps({ hasFiles: false }), callbacks);
            expect(container.querySelector('.ssv-select-row')).toBeNull();
        });
    });

    describe('when hasFiles is true', () => {
        it('renders push, pull, and delete buttons', () => {
            renderActionBar(container, baseProps(), callbacks);
            expect(container.querySelector('.ssv-btn-push')).not.toBeNull();
            expect(container.querySelector('.ssv-btn-pull')).not.toBeNull();
            expect(container.querySelector('.ssv-btn-danger')).not.toBeNull();
        });

        it('renders select-all checkbox', () => {
            renderActionBar(container, baseProps(), callbacks);
            expect(container.querySelector('.ssv-select-row input[type="checkbox"]')).not.toBeNull();
        });

        it('calls onPush when push button clicked', () => {
            renderActionBar(container, baseProps(), callbacks);
            (container.querySelector('.ssv-btn-push') as HTMLButtonElement).click();
            expect(callbacks.onPush).toHaveBeenCalledOnce();
        });

        it('calls onPull when pull button clicked', () => {
            renderActionBar(container, baseProps(), callbacks);
            (container.querySelector('.ssv-btn-pull') as HTMLButtonElement).click();
            expect(callbacks.onPull).toHaveBeenCalledOnce();
        });

        it('calls onDelete when delete button clicked', () => {
            renderActionBar(container, baseProps(), callbacks);
            (container.querySelector('.ssv-btn-danger') as HTMLButtonElement).click();
            expect(callbacks.onDelete).toHaveBeenCalledOnce();
        });

        it('push button is disabled when canPush is 0', () => {
            renderActionBar(container, baseProps({ canPush: 0 }), callbacks);
            expect((container.querySelector('.ssv-btn-push') as HTMLButtonElement).disabled).toBe(true);
        });

        it('pull button is disabled when canPull is 0', () => {
            renderActionBar(container, baseProps({ canPull: 0 }), callbacks);
            expect((container.querySelector('.ssv-btn-pull') as HTMLButtonElement).disabled).toBe(true);
        });

        it('delete button is disabled when canDelete is 0', () => {
            renderActionBar(container, baseProps({ canDelete: 0 }), callbacks);
            expect((container.querySelector('.ssv-btn-danger') as HTMLButtonElement).disabled).toBe(true);
        });

        it('push button is enabled when canPush > 0', () => {
            renderActionBar(container, baseProps({ canPush: 3 }), callbacks);
            expect((container.querySelector('.ssv-btn-push') as HTMLButtonElement).disabled).toBe(false);
        });

        it('select-all checkbox reflects allSelected prop', () => {
            renderActionBar(container, baseProps({ allSelected: true }), callbacks);
            const cb = container.querySelector('.ssv-select-row input') as HTMLInputElement;
            expect(cb.checked).toBe(true);
        });

        it('calls onSelectAll(true) when checkbox is checked', () => {
            renderActionBar(container, baseProps(), callbacks);
            const cb = container.querySelector('.ssv-select-row input') as HTMLInputElement;
            cb.checked = true;
            cb.dispatchEvent(new Event('change'));
            expect(callbacks.onSelectAll).toHaveBeenCalledWith(true);
        });

        it('calls onSelectAll(false) when checkbox is unchecked', () => {
            renderActionBar(container, baseProps({ allSelected: true }), callbacks);
            const cb = container.querySelector('.ssv-select-row input') as HTMLInputElement;
            cb.checked = false;
            cb.dispatchEvent(new Event('change'));
            expect(callbacks.onSelectAll).toHaveBeenCalledWith(false);
        });
    });
});
