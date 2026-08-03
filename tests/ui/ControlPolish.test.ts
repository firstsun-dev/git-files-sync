import { beforeAll, describe, expect, it } from 'vitest';
import { ensureControlPolishStyles } from '../../src/ui/components/ControlPolish';
import { createContainer, setupObsidianDOM } from './setup-dom';

describe('ensureControlPolishStyles', () => {
    beforeAll(() => { setupObsidianDOM(); });

    it('adds one scoped style element to the sync status view', () => {
        const view = createContainer();
        view.className = 'sync-status-view';
        const slot = document.createElement('div');
        view.appendChild(slot);

        ensureControlPolishStyles(slot);
        ensureControlPolishStyles(slot);

        const styles = view.querySelectorAll('style[data-gfs-control-polish]');
        expect(styles).toHaveLength(1);
        expect(styles[0]?.textContent).toContain('--gfs-touch-target: 44px');
        expect(styles[0]?.textContent).toContain('.ssv-btn-delete');
    });
});
