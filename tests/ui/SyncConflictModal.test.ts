import { beforeAll, describe, it, expect, vi } from 'vitest';
import { App } from 'obsidian';
import { applyDestructiveStyle, SyncConflictModal } from '../../src/ui/SyncConflictModal';
import { createContainer, setupObsidianDOM } from './setup-dom';

// Guards the backward-compatibility fix that lets the plugin run on Obsidian
// down to minAppVersion 1.11.0. ButtonComponent.setDestructive() only exists on
// Obsidian >= 1.13; calling it unconditionally would throw on older versions.
describe('applyDestructiveStyle (Obsidian version compatibility)', () => {
	it('applies the destructive style on Obsidian >= 1.13 (method present)', () => {
		const setDestructive = vi.fn();
		const btn = { setDestructive };

		expect(applyDestructiveStyle(btn)).toBe(btn);
		expect(setDestructive).toHaveBeenCalledOnce();
	});

	it('degrades gracefully on Obsidian < 1.13 (method absent) without throwing', () => {
		const btn = {}; // an older ButtonComponent has no setDestructive()

		expect(() => applyDestructiveStyle(btn)).not.toThrow();
		expect(applyDestructiveStyle(btn)).toBe(btn);
	});

	it('ignores a non-function setDestructive rather than crashing', () => {
		const btn = { setDestructive: 'nope' as unknown as () => unknown };

		expect(() => applyDestructiveStyle(btn)).not.toThrow();
	});
});

describe('SyncConflictModal', () => {
	beforeAll(() => { setupObsidianDOM(); });

	it('defaults to the diff panel and switches panels via tabs', () => {
		const modal = new SyncConflictModal(new App(), 'note.md', 'local', 'remote', vi.fn());
		modal.contentEl = createContainer();

		modal.onOpen();

		const contentEl = modal.contentEl;
		const tabs = Array.from(contentEl.querySelectorAll<HTMLElement>('.conflict-tab'));
		const panels = Array.from(contentEl.querySelectorAll<HTMLElement>('.conflict-panel'));

		const activePanel = () => panels.find(panel => panel.classList.contains('is-active'));
		const activeTab = () => tabs.find(tab => tab.classList.contains('is-active'));

		expect(activeTab()?.textContent).toBe('Diff');
		expect(activePanel()?.classList.contains('conflict-diff-section')).toBe(true);

		const localTab = tabs.find(tab => tab.textContent === 'Local');
		localTab?.dispatchEvent(new Event('click'));

		expect(activeTab()?.textContent).toBe('Local');
		expect(activePanel()?.classList.contains('conflict-section')).toBe(true);
	});
});
