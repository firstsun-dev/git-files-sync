import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { renderDiffPanel } from '../../src/ui/components/DiffPanel';
import { setupObsidianDOM, createContainer } from './setup-dom';

beforeAll(() => { setupObsidianDOM(); });

describe('renderDiffPanel', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = createContainer();
    });

    it('renders the diff grid into the given container', () => {
        renderDiffPanel(container, '', '');
        expect(container.querySelector('.ssv-diff-grid')).not.toBeNull();
    });

    it('renders Remote and Local column headers', () => {
        renderDiffPanel(container, 'a', 'b');
        const headers = container.querySelectorAll('.ssv-diff-hd');
        expect(headers[0]?.textContent).toBe('Remote');
        expect(headers[1]?.textContent).toBe('Local');
    });

    it('renders unchanged lines with unchanged class in both columns', () => {
        renderDiffPanel(container, 'same', 'same');
        const cells = container.querySelectorAll('.ssv-diff-cell.unchanged');
        expect(cells.length).toBeGreaterThanOrEqual(2);
    });

    it('renders added line in unified view', () => {
        renderDiffPanel(container, '', 'new line');
        const added = container.querySelector('.ssv-u-line.added');
        expect(added?.textContent).toContain('new line');
    });

    it('renders removed line in unified view', () => {
        renderDiffPanel(container, 'old line', '');
        const removed = container.querySelector('.ssv-u-line.removed');
        expect(removed?.textContent).toContain('old line');
    });

    it('renders both removed and added lines for a replacement', () => {
        renderDiffPanel(container, 'before', 'after');
        expect(container.querySelector('.ssv-u-line.removed')).not.toBeNull();
        expect(container.querySelector('.ssv-u-line.added')).not.toBeNull();
    });

    it('renders unchanged lines in unified view for identical content', () => {
        renderDiffPanel(container, 'context', 'context');
        expect(container.querySelector('.ssv-u-line.unchanged')).not.toBeNull();
    });
});
