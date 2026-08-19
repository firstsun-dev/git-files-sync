import { describe, expect, it, vi } from 'vitest';
import { SyncMetadataStore } from '../../../src/logic/sync/SyncMetadataStore';
import { SyncStatusService } from '../../../src/logic/sync-status-service';
import type { GitLabFilesPushSettings } from '../../../src/settings';

function setup() {
    const settings = { syncMetadata: {} } as unknown as GitLabFilesPushSettings;
    const save = vi.fn().mockResolvedValue(undefined);
    const status = new SyncStatusService();
    status.set({ path: 'a.md', status: 'modified' });
    return { settings, save, status, store: new SyncMetadataStore(settings, save, status) };
}

describe('SyncMetadataStore', () => {
    it('persists a baseline and marks the shared status snapshot synced', async () => {
        const { settings, save, status, store } = setup();

        await store.update('a.md', 'sha');

        expect(settings.syncMetadata['a.md']).toMatchObject({ lastSyncedSha: 'sha', lastKnownPath: 'a.md' });
        expect(status.get('a.md')).toMatchObject({ status: 'synced', remoteSha: 'sha' });
        expect(save).toHaveBeenCalledOnce();
    });

    it('collapses rename chains and cancels a rename back to its remote path', async () => {
        const { settings, store } = setup();
        settings.syncMetadata['a.md'] = { lastSyncedSha: 'sha', lastSyncedAt: 1, lastKnownPath: 'a.md' };

        await store.trackRename('b.md', 'a.md');
        await store.trackRename('c.md', 'b.md');
        expect(settings.syncMetadata['c.md']).toMatchObject({ renamedFrom: 'a.md' });

        await store.trackRename('a.md', 'c.md');
        expect(settings.syncMetadata['a.md']).not.toHaveProperty('renamedFrom');
    });

    it('clears only existing metadata', async () => {
        const { settings, save, store } = setup();
        settings.syncMetadata['a.md'] = { lastSyncedSha: 'sha', lastSyncedAt: 1, lastKnownPath: 'a.md' };

        await store.clear('a.md');
        await store.clear('missing.md');

        expect(settings.syncMetadata).toEqual({});
        expect(save).toHaveBeenCalledOnce();
    });
});
