import { describe, expect, it } from 'vitest';
import { PushSelectionStore } from '../../../src/logic/source-control/PushSelectionStore';

describe('PushSelectionStore', () => {
    it('includes a change for push', () => {
        const store = new PushSelectionStore();

        store.includeForPush('a.md');

        expect(store.isIncluded('a.md')).toBe(true);
        expect(store.getSelectedPaths()).toEqual(['a.md']);
    });

    it('excludes a change from push', () => {
        const store = new PushSelectionStore();
        store.includeForPush('a.md');

        store.excludeFromPush('a.md');

        expect(store.isIncluded('a.md')).toBe(false);
        expect(store.getSelectedPaths()).toEqual([]);
    });

    it('tracks multiple changes independently', () => {
        const store = new PushSelectionStore();

        store.includeForPush('a.md');
        store.includeForPush('b.md');
        store.excludeFromPush('a.md');

        expect(store.isIncluded('a.md')).toBe(false);
        expect(store.isIncluded('b.md')).toBe(true);
        expect(store.getSelectedPaths()).toEqual(['b.md']);
    });

    it('keeps selection across a refresh when the change is still present', () => {
        const store = new PushSelectionStore();
        store.includeForPush('a.md');

        store.refresh(['a.md', 'b.md']);

        expect(store.isIncluded('a.md')).toBe(true);
    });

    it('clears selection for a change removed by refresh', () => {
        const store = new PushSelectionStore();
        store.includeForPush('a.md');
        store.includeForPush('b.md');

        store.refresh(['b.md']);

        expect(store.isIncluded('a.md')).toBe(false);
        expect(store.isIncluded('b.md')).toBe(true);
        expect(store.getSelectedPaths()).toEqual(['b.md']);
    });
});
