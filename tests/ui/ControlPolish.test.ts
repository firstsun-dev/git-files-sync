import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { scheduleControlPolish } from '../../src/ui/components/ControlPolish';
import { createContainer, setupObsidianDOM } from './setup-dom';

describe('scheduleControlPolish', () => {
    beforeAll(() => { setupObsidianDOM(); });
    afterEach(() => { document.body.classList.remove('is-mobile'); });

    it('applies desktop sizing and action hierarchy after the render pass', async () => {
        const view = createContainer();
        view.className = 'sync-status-view';
        const slot = document.createElement('div');
        view.appendChild(slot);

        scheduleControlPolish(slot);

        const row = document.createElement('div');
        row.className = 'ssv-action-bar-row';
        slot.appendChild(row);

        const push = document.createElement('button');
        push.className = 'ssv-btn ssv-btn-push';
        row.appendChild(push);

        const pull = document.createElement('button');
        pull.className = 'ssv-btn ssv-btn-pull';
        row.appendChild(pull);

        const remove = document.createElement('button');
        remove.className = 'ssv-btn ssv-btn-delete';
        row.appendChild(remove);

        const fileAction = document.createElement('button');
        fileAction.className = 'ssv-action-btn push';
        slot.appendChild(fileAction);

        await Promise.resolve();

        expect(push.style.minHeight).toBe('32px');
        expect(push.style.background).toBe('var(--interactive-accent)');
        expect(pull.style.background).toBe('var(--background-secondary)');
        expect(remove.style.background).toBe('transparent');
        expect(remove.style.color).toBe('var(--text-error)');
        expect(fileAction.style.minHeight).toBe('30px');
        expect(fileAction.style.borderColor).toBe('var(--interactive-accent)');
    });

    it('uses 44px touch targets and a two-column mobile toolbar', async () => {
        document.body.classList.add('is-mobile');
        const view = createContainer();
        view.className = 'sync-status-view';
        const slot = document.createElement('div');
        view.appendChild(slot);

        const row = document.createElement('div');
        row.className = 'ssv-action-bar-row';
        slot.appendChild(row);

        const button = document.createElement('button');
        button.className = 'ssv-btn ssv-btn-refresh';
        row.appendChild(button);

        scheduleControlPolish(slot);
        await Promise.resolve();

        expect(row.style.display).toBe('grid');
        expect(row.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
        expect(button.style.minHeight).toBe('44px');
        expect(button.style.gridColumn).toBe('1 / -1');
    });
});
