import { describe, expect, it } from 'vitest';
import { toSyncChanges } from '../../../src/logic/source-control/FileStatusAdapter';
import { toChangeId } from '../../../src/logic/source-control/types';
import type { FileStatus } from '../../../src/logic/sync-status-service';

describe('toSyncChanges', () => {
    it('maps each FileStatus kind to its SyncChangeKind', () => {
        const statuses: FileStatus[] = [
            { path: 'synced.md', status: 'synced' },
            { path: 'modified.md', status: 'modified' },
            { path: 'unsynced.md', status: 'unsynced' },
            { path: 'remote.md', status: 'remote-only' },
            { path: 'new.md', status: 'moved', movedFrom: 'old.md' },
        ];

        expect(toSyncChanges(statuses)).toEqual([
            { id: toChangeId('synced.md'), path: 'synced.md', previousPath: undefined, kind: 'synced' },
            { id: toChangeId('modified.md'), path: 'modified.md', previousPath: undefined, kind: 'local-modified' },
            { id: toChangeId('unsynced.md'), path: 'unsynced.md', previousPath: undefined, kind: 'local-only' },
            { id: toChangeId('remote.md'), path: 'remote.md', previousPath: undefined, kind: 'remote-only' },
            { id: toChangeId('new.md'), path: 'new.md', previousPath: 'old.md', kind: 'moved' },
        ]);
    });

    it('omits rows still in the "checking" state', () => {
        const statuses: FileStatus[] = [
            { path: 'pending.md', status: 'checking' },
            { path: 'settled.md', status: 'synced' },
        ];

        expect(toSyncChanges(statuses)).toEqual([
            { id: toChangeId('settled.md'), path: 'settled.md', previousPath: undefined, kind: 'synced' },
        ]);
    });

    it('returns an empty array for an empty input', () => {
        expect(toSyncChanges([])).toEqual([]);
    });
});
