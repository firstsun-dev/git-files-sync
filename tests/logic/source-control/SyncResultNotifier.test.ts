import { describe, expect, it, vi } from 'vitest';
import { SyncResultNotifier } from '../../../src/logic/source-control/SyncResultNotifier';

describe('SyncResultNotifier', () => {
    it('presents all non-zero successful operations in one completion notification', () => {
        const notify = vi.fn();
        const notifier = new SyncResultNotifier(notify);

        notifier.notify({
            added: 1, updated: 2, moved: 0, deleted: 3, downloaded: 1, acceptedRemote: 0,
            failed: 0, conflicts: 0, skippedConflicts: 0, errors: [],
        });

        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith('Sync complete — 1 added, 2 updated, 3 deleted, 1 downloaded');
    });

    it('presents accepted remote together with the other successful counts', () => {
        const notify = vi.fn();
        const notifier = new SyncResultNotifier(notify);

        notifier.notify({
            added: 0, updated: 0, moved: 0, deleted: 0, downloaded: 0, acceptedRemote: 2,
            failed: 0, conflicts: 0, skippedConflicts: 0, errors: [],
        });

        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith('Sync complete — Accepted remote 2');
    });

    it('presents a partial result once instead of splitting success and failure notices', () => {
        const notify = vi.fn();
        const notifier = new SyncResultNotifier(notify);

        notifier.notify({
            added: 0, updated: 1, moved: 0, deleted: 1, downloaded: 0, acceptedRemote: 0,
            failed: 1, conflicts: 0, skippedConflicts: 0, errors: [{ file: 'c.md', error: 'locked' }],
        });

        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith('Sync completed with issues — 1 updated, 1 deleted, 1 failed');
    });

    it('presents a total failure once', () => {
        const notify = vi.fn();
        const notifier = new SyncResultNotifier(notify);

        notifier.notify({
            added: 0, updated: 0, moved: 0, deleted: 0, downloaded: 0, acceptedRemote: 0,
            failed: 1, conflicts: 0, skippedConflicts: 0, errors: [{ file: 'a.md', error: 'offline' }],
        });

        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith('Sync failed — 1 failed');
    });
});
