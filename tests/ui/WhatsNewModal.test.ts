import { beforeAll, describe, it, expect, vi, afterEach } from 'vitest';
import { App } from 'obsidian';
import { WhatsNewModal } from '../../src/ui/WhatsNewModal';
import { createContainer, setupObsidianDOM } from './setup-dom';
import type { ChangelogRelease } from '../../src/changelog';

describe('WhatsNewModal', () => {
    beforeAll(() => { setupObsidianDOM(); });

    afterEach(() => { vi.restoreAllMocks(); });

    const releases: ChangelogRelease[] = [
        {
            version: '1.3.0',
            entries: [
                { text: { en: 'Notable highlight' }, notable: true },
                { text: { en: 'Minor fix' } },
            ],
        },
        {
            version: '1.2.1',
            entries: [
                { text: { en: 'Older release note' } },
            ],
        },
    ];

    function openModal(rels: ChangelogRelease[]): HTMLElement {
        const modal = new WhatsNewModal(new App(), rels);
        modal.contentEl = createContainer();
        modal.onOpen();
        return modal.contentEl;
    }

    it('renders a heading for each release version', () => {
        const contentEl = openModal(releases);
        const headings = Array.from(contentEl.querySelectorAll('h4')).map(h => h.textContent);
        expect(headings).toEqual(['v1.3.0', 'v1.2.1']);
    });

    it('renders every entry as a list item', () => {
        const contentEl = openModal(releases);
        const items = Array.from(contentEl.querySelectorAll('li')).map(li => li.textContent);
        expect(items).toEqual(['Notable highlight', 'Minor fix', 'Older release note']);
    });

    it('marks notable entries distinctly from non-notable ones', () => {
        const contentEl = openModal(releases);
        const items = Array.from(contentEl.querySelectorAll('li'));
        expect(items[0]?.classList.contains('ssv-whats-new-notable')).toBe(true);
        expect(items[1]?.classList.contains('ssv-whats-new-notable')).toBe(false);
    });

    it('opens the full changelog URL when "View full changelog" is clicked', () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        const contentEl = openModal(releases);
        const buttons = Array.from(contentEl.querySelectorAll('button'));
        const changelogBtn = buttons.find(b => b.textContent?.includes('View full changelog'));

        changelogBtn?.click();

        expect(openSpy).toHaveBeenCalledWith(
            'https://github.com/firstsun-dev/git-files-sync/blob/main/CHANGELOG.md',
            '_blank',
            'noopener'
        );
    });

    it('closes the modal when "Got it" is clicked', () => {
        const modal = new WhatsNewModal(new App(), releases);
        modal.contentEl = createContainer();
        modal.onOpen();
        const closeSpy = vi.spyOn(modal, 'close');

        const buttons = Array.from(modal.contentEl.querySelectorAll('button'));
        const gotItBtn = buttons.find(b => b.textContent?.includes('Got it'));
        gotItBtn?.click();

        expect(closeSpy).toHaveBeenCalledOnce();
    });
});
