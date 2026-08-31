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

	it('renders the diff view directly with no redundant Local/Remote tabs', () => {
		const modal = new SyncConflictModal(new App(), 'note.md', 'local', 'remote', vi.fn());
		modal.contentEl = createContainer();

		modal.onOpen();

		const contentEl = modal.contentEl;
		expect(contentEl.querySelector('.conflict-diff-section')).not.toBeNull();
		expect(contentEl.querySelector('.conflict-tabs')).toBeNull();
		expect(contentEl.querySelector('.conflict-tab')).toBeNull();
		expect(contentEl.querySelector('.conflict-diff-container')).toBeNull();
	});

	describe('diff layout toggle', () => {
		// Desktop (vitest Node env is not mobile): opens in split, matching
		// the desktop diff tab's default — the wide modal exists to show
		// side-by-side.
		it('renders the shared diff panel defaulting to the split layout on desktop', () => {
			const modal = new SyncConflictModal(new App(), 'note.md', 'local', 'remote', vi.fn());
			modal.contentEl = createContainer();

			modal.onOpen();

			const body = modal.contentEl.querySelector('.scv-diff-tab-body');
			expect(body?.classList.contains('scv-diff-layout-split')).toBe(true);
			expect(modal.contentEl.querySelector('.ssv-diff-split')).not.toBeNull();
		});

		it('switches to the unified layout when the toggle button is clicked, never showing both at once', () => {
			const modal = new SyncConflictModal(new App(), 'note.md', 'local', 'remote', vi.fn());
			modal.contentEl = createContainer();

			modal.onOpen();
			(modal.contentEl.querySelector('.scv-diff-layout-toggle') as HTMLButtonElement).click();

			const body = modal.contentEl.querySelector('.scv-diff-tab-body');
			expect(body?.classList.contains('scv-diff-layout-unified')).toBe(true);
			expect(body?.classList.contains('scv-diff-layout-split')).toBe(false);
		});
	});
});
