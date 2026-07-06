import { describe, it, expect, vi } from 'vitest';
import { applyDestructiveStyle } from '../../src/ui/SyncConflictModal';

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
