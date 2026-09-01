import { describe, expect, it } from 'vitest';
import { SyncSelectionStore } from '../../../src/logic/source-control/SyncSelectionStore';
import { toChangeId, type SyncChange } from '../../../src/logic/source-control/types';

describe('SyncSelectionStore.reconcile', () => {
    it('clears an action override that is no longer legal for the current change kind', () => {
        const store = new SyncSelectionStore();
        const id = toChangeId('change-a');
        store.selectForSync(id);
        store.setActionOverride(id, 'pull');

        const current: SyncChange[] = [{ id, path: 'a.md', kind: 'local-only' }];
        store.reconcile(current);

        expect(store.isIncluded(id)).toBe(true);
        expect(store.getActionOverride(id)).toBeUndefined();
    });

    it('keeps a still-legal explicit override', () => {
        const store = new SyncSelectionStore();
        const id = toChangeId('change-a');
        store.selectForSync(id);
        store.setActionOverride(id, 'pull');

        const current: SyncChange[] = [{ id, path: 'a.md', kind: 'local-modified' }];
        store.reconcile(current);

        expect(store.getActionOverride(id)).toBe('pull');
    });

    it('drops both selection and override when the change disappeared', () => {
        const store = new SyncSelectionStore();
        const id = toChangeId('change-a');
        store.selectForSync(id);
        store.setActionOverride(id, 'pull');

        store.reconcile([]);

        expect(store.isIncluded(id)).toBe(false);
        expect(store.getActionOverride(id)).toBeUndefined();
    });
});
