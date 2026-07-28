import { describe, expect, it } from 'vitest';
import { SyncStatusService, type SyncStatusFacts } from '../../src/logic/sync-status-service';

describe('SyncStatusService', () => {
    const service = new SyncStatusService();

    it.each<[string, SyncStatusFacts, string]>([
        ['a tracked rename', { movedFrom: 'old.md' }, 'moved'],
        ['a local-only file', { localExists: true, remoteExists: false }, 'unsynced'],
        ['a remote-only file', { localExists: false, remoteExists: true }, 'remote-only'],
        ['matching local and remote content', { localExists: true, remoteExists: true, contentsEqual: true }, 'synced'],
        ['different local and remote content', { localExists: true, remoteExists: true, contentsEqual: false }, 'modified'],
    ])('classifies %s as %s', (_description, facts, expected) => {
        expect(service.classify(facts)).toBe(expected);
    });

    it('owns the status snapshot and publishes each change to subscribers', () => {
        const observed: Array<string | undefined> = [];
        const unsubscribe = service.subscribe(statuses => {
            observed.push(statuses.get('note.md')?.status);
        });

        service.set({ path: 'note.md', status: 'checking' });
        service.set({ path: 'note.md', status: 'synced', remoteSha: 'abc' });
        unsubscribe();
        service.delete('note.md');

        expect(service.get('note.md')).toBeUndefined();
        expect(observed).toEqual([undefined, 'checking', 'synced']);
    });
});
