import { describe, expect, it } from 'vitest';
import { SyncSelectionStore } from '../../../src/logic/source-control/SyncSelectionStore';
import { toChangeId } from '../../../src/logic/source-control/types';

describe('SyncSelectionStore', () => {
    it('selects a change for sync', () => {
        const store = new SyncSelectionStore();

        store.selectForSync(toChangeId('change-a'));

        expect(store.isIncluded(toChangeId('change-a'))).toBe(true);
        expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-a')]);
    });

    it('deselects a change from sync', () => {
        const store = new SyncSelectionStore();
        store.selectForSync(toChangeId('change-a'));

        store.deselectFromSync(toChangeId('change-a'));

        expect(store.isIncluded(toChangeId('change-a'))).toBe(false);
        expect(store.getSelectedChangeIds()).toEqual([]);
    });

    it('tracks multiple changes independently', () => {
        const store = new SyncSelectionStore();

        store.selectForSync(toChangeId('change-a'));
        store.selectForSync(toChangeId('change-b'));
        store.deselectFromSync(toChangeId('change-a'));

        expect(store.isIncluded(toChangeId('change-a'))).toBe(false);
        expect(store.isIncluded(toChangeId('change-b'))).toBe(true);
        expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-b')]);
    });

    it('keeps selection across a refresh when the change is still present', () => {
        const store = new SyncSelectionStore();
        store.selectForSync(toChangeId('change-a'));

        store.refresh([toChangeId('change-a'), toChangeId('change-b')]);

        expect(store.isIncluded(toChangeId('change-a'))).toBe(true);
    });

    it('clears selection for a change removed by refresh', () => {
        const store = new SyncSelectionStore();
        store.selectForSync(toChangeId('change-a'));
        store.selectForSync(toChangeId('change-b'));

        store.refresh([toChangeId('change-b')]);

        expect(store.isIncluded(toChangeId('change-a'))).toBe(false);
        expect(store.isIncluded(toChangeId('change-b'))).toBe(true);
        expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-b')]);
    });

    it('keeps selection when path changes but change id stays', () => {
        const store = new SyncSelectionStore();
        store.selectForSync(toChangeId('change-1'));

        // old.md renamed to new.md, but the change id is stable
        store.refresh([toChangeId('change-1')]);

        expect(store.isIncluded(toChangeId('change-1'))).toBe(true);
    });

    describe('selectMany / deselectMany (batch ops)', () => {
        it('selectMany includes a batch of changes in one call', () => {
            const store = new SyncSelectionStore();

            store.selectMany([toChangeId('change-a'), toChangeId('change-b'), toChangeId('change-c')]);

            expect(store.getSelectedChangeIds()).toEqual([
                toChangeId('change-a'),
                toChangeId('change-b'),
                toChangeId('change-c'),
            ]);
        });

        it('deselectMany removes only the given ids, leaving the rest selected', () => {
            const store = new SyncSelectionStore();
            store.selectMany([toChangeId('change-a'), toChangeId('change-b'), toChangeId('change-c')]);

            store.deselectMany([toChangeId('change-a'), toChangeId('change-c')]);

            expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-b')]);
        });

        it('selectMany with an empty list is a no-op', () => {
            const store = new SyncSelectionStore();
            store.selectForSync(toChangeId('change-a'));

            store.selectMany([]);

            expect(store.getSelectedChangeIds()).toEqual([toChangeId('change-a')]);
        });
    });

    describe('action overrides', () => {
        it('has no override by default', () => {
            const store = new SyncSelectionStore();
            store.selectForSync(toChangeId('change-a'));

            expect(store.getActionOverride(toChangeId('change-a'))).toBeUndefined();
        });

        it('records and returns an explicit override', () => {
            const store = new SyncSelectionStore();
            store.selectForSync(toChangeId('change-a'));

            store.setActionOverride(toChangeId('change-a'), 'pull');

            expect(store.getActionOverride(toChangeId('change-a'))).toBe('pull');
        });

        it('clearActionOverride reverts to no override', () => {
            const store = new SyncSelectionStore();
            store.selectForSync(toChangeId('change-a'));
            store.setActionOverride(toChangeId('change-a'), 'pull');

            store.clearActionOverride(toChangeId('change-a'));

            expect(store.getActionOverride(toChangeId('change-a'))).toBeUndefined();
        });

        it('deselectFromSync clears the override along with the selection', () => {
            const store = new SyncSelectionStore();
            store.selectForSync(toChangeId('change-a'));
            store.setActionOverride(toChangeId('change-a'), 'pull');

            store.deselectFromSync(toChangeId('change-a'));

            expect(store.getActionOverride(toChangeId('change-a'))).toBeUndefined();
        });

        it('deselectMany clears overrides for all deselected ids', () => {
            const store = new SyncSelectionStore();
            store.selectMany([toChangeId('change-a'), toChangeId('change-b')]);
            store.setActionOverride(toChangeId('change-a'), 'pull');
            store.setActionOverride(toChangeId('change-b'), 'delete-remote');

            store.deselectMany([toChangeId('change-a'), toChangeId('change-b')]);

            expect(store.getActionOverride(toChangeId('change-a'))).toBeUndefined();
            expect(store.getActionOverride(toChangeId('change-b'))).toBeUndefined();
        });

        it('refresh clears the override for a change id that is no longer present', () => {
            const store = new SyncSelectionStore();
            store.selectForSync(toChangeId('change-a'));
            store.setActionOverride(toChangeId('change-a'), 'pull');

            store.refresh([]);

            expect(store.getActionOverride(toChangeId('change-a'))).toBeUndefined();
        });

        it('refresh keeps the override for a change id that is still present', () => {
            const store = new SyncSelectionStore();
            store.selectForSync(toChangeId('change-a'));
            store.setActionOverride(toChangeId('change-a'), 'pull');

            store.refresh([toChangeId('change-a')]);

            expect(store.getActionOverride(toChangeId('change-a'))).toBe('pull');
        });
    });
});
