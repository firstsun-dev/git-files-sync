import { describe, expect, it } from 'vitest';
import { PushSelectionStore } from '../../../src/logic/source-control/PushSelectionStore';
import { toChangeId } from '../../../src/logic/source-control/types';

describe('PushSelectionStore', () => {
    it('includes a change for push', () => {
        const store = new PushSelectionStore();

        store.includeForPush(toChangeId('change-a'));

        expect(store.isIncluded(toChangeId('change-a'))).toBe(true);
        expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-a')]);
    });

    it('excludes a change from push', () => {
        const store = new PushSelectionStore();
        store.includeForPush(toChangeId('change-a'));

        store.excludeFromPush(toChangeId('change-a'));

        expect(store.isIncluded(toChangeId('change-a'))).toBe(false);
        expect(store.getSelectedChangeIds()).toEqual([]);
    });

    it('tracks multiple changes independently', () => {
        const store = new PushSelectionStore();

        store.includeForPush(toChangeId('change-a'));
        store.includeForPush(toChangeId('change-b'));
        store.excludeFromPush(toChangeId('change-a'));

        expect(store.isIncluded(toChangeId('change-a'))).toBe(false);
        expect(store.isIncluded(toChangeId('change-b'))).toBe(true);
        expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-b')]);
    });

    it('keeps selection across a refresh when the change is still present', () => {
        const store = new PushSelectionStore();
        store.includeForPush(toChangeId('change-a'));

        store.refresh([toChangeId('change-a'), toChangeId('change-b')]);

        expect(store.isIncluded(toChangeId('change-a'))).toBe(true);
    });

    it('clears selection for a change removed by refresh', () => {
        const store = new PushSelectionStore();
        store.includeForPush(toChangeId('change-a'));
        store.includeForPush(toChangeId('change-b'));

        store.refresh([toChangeId('change-b')]);

        expect(store.isIncluded(toChangeId('change-a'))).toBe(false);
        expect(store.isIncluded(toChangeId('change-b'))).toBe(true);
        expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-b')]);
    });

    it('keeps selection when path changes but change id stays', () => {
        const store = new PushSelectionStore();
        store.includeForPush(toChangeId('change-1'));

        // old.md renamed to new.md, but the change id is stable
        store.refresh([toChangeId('change-1')]);

        expect(store.isIncluded(toChangeId('change-1'))).toBe(true);
    });

    describe('selectMany / deselectMany (batch ops)', () => {
        it('selectMany includes a batch of changes in one call', () => {
            const store = new PushSelectionStore();

            store.selectMany([toChangeId('change-a'), toChangeId('change-b'), toChangeId('change-c')]);

            expect(store.getSelectedChangeIds()).toEqual([
                toChangeId('change-a'),
                toChangeId('change-b'),
                toChangeId('change-c'),
            ]);
        });

        it('deselectMany removes only the given ids, leaving the rest selected', () => {
            const store = new PushSelectionStore();
            store.selectMany([toChangeId('change-a'), toChangeId('change-b'), toChangeId('change-c')]);

            store.deselectMany([toChangeId('change-a'), toChangeId('change-c')]);

            expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-b')]);
        });

        it('selectMany with an empty list is a no-op', () => {
            const store = new PushSelectionStore();
            store.includeForPush(toChangeId('change-a'));

            store.selectMany([]);

            expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-a')]);
        });
    });
});
