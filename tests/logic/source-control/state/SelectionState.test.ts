import { describe, expect, it } from 'vitest';
import { SelectionState } from '../../../../src/logic/source-control/state/SelectionState';
import { toChangeId } from '../../../../src/logic/source-control/types';

describe('SelectionState', () => {
    it('includes a change for push', () => {
        const store = new SelectionState();

        store.includeForPush(toChangeId('change-a'));

        expect(store.isIncluded(toChangeId('change-a'))).toBe(true);
        expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-a')]);
    });

    it('excludes a change from push', () => {
        const store = new SelectionState();
        store.includeForPush(toChangeId('change-a'));

        store.excludeFromPush(toChangeId('change-a'));

        expect(store.isIncluded(toChangeId('change-a'))).toBe(false);
        expect(store.getSelectedChangeIds()).toEqual([]);
    });

    it('tracks multiple changes independently', () => {
        const store = new SelectionState();

        store.includeForPush(toChangeId('change-a'));
        store.includeForPush(toChangeId('change-b'));
        store.excludeFromPush(toChangeId('change-a'));

        expect(store.isIncluded(toChangeId('change-a'))).toBe(false);
        expect(store.isIncluded(toChangeId('change-b'))).toBe(true);
        expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-b')]);
    });

    it('keeps selection across a refresh when the change is still present', () => {
        const store = new SelectionState();
        store.includeForPush(toChangeId('change-a'));

        store.refresh([toChangeId('change-a'), toChangeId('change-b')]);

        expect(store.isIncluded(toChangeId('change-a'))).toBe(true);
    });

    it('clears selection for a change removed by refresh', () => {
        const store = new SelectionState();
        store.includeForPush(toChangeId('change-a'));
        store.includeForPush(toChangeId('change-b'));

        store.refresh([toChangeId('change-b')]);

        expect(store.isIncluded(toChangeId('change-a'))).toBe(false);
        expect(store.isIncluded(toChangeId('change-b'))).toBe(true);
        expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-b')]);
    });

    it('keeps selection when path changes but change id stays', () => {
        const store = new SelectionState();
        store.includeForPush(toChangeId('change-1'));

        // old.md renamed to new.md, but the change id is stable
        store.refresh([toChangeId('change-1')]);

        expect(store.isIncluded(toChangeId('change-1'))).toBe(true);
    });
});
