import { describe, expect, it } from 'vitest';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { toChangeId, type SyncChange } from '../../../src/logic/source-control/types';

function change(overrides: Partial<SyncChange> & Pick<SyncChange, 'id' | 'path' | 'kind'>): SyncChange {
    return { ...overrides };
}

describe('ChangeRepository', () => {
    it('looks up a change by id', () => {
        const repo = new ChangeRepository();
        const local = change({ id: toChangeId('change-a'), path: 'a.md', kind: 'local-only' });
        repo.replace([local]);

        expect(repo.getById(toChangeId('change-a'))).toEqual(local);
        expect(repo.getById(toChangeId('missing'))).toBeUndefined();
    });

    it('looks up a change by path', () => {
        const repo = new ChangeRepository();
        const remote = change({ id: toChangeId('change-b'), path: 'b.md', kind: 'remote-only' });
        repo.replace([remote]);

        expect(repo.getByPath('b.md')).toEqual(remote);
        expect(repo.getByPath('missing.md')).toBeUndefined();
    });

    it('exposes the current changes collection', () => {
        const repo = new ChangeRepository();
        const a = change({ id: toChangeId('change-a'), path: 'a.md', kind: 'local-only' });
        const b = change({ id: toChangeId('change-b'), path: 'b.md', kind: 'remote-only' });
        repo.replace([a, b]);

        expect(repo.getAll()).toEqual([a, b]);
    });

    it('drops stale entries when replaced', () => {
        const repo = new ChangeRepository();
        repo.replace([change({ id: toChangeId('change-a'), path: 'a.md', kind: 'local-only' })]);

        repo.replace([change({ id: toChangeId('change-b'), path: 'b.md', kind: 'remote-only' })]);

        expect(repo.getById(toChangeId('change-a'))).toBeUndefined();
        expect(repo.getByPath('a.md')).toBeUndefined();
        expect(repo.getAll()).toHaveLength(1);
    });

    it('keeps ChangeId stable across a rename, looked up by the new path', () => {
        const repo = new ChangeRepository();
        const renamed = change({
            id: toChangeId('change-1'),
            path: 'new.md',
            previousPath: 'old.md',
            kind: 'moved',
        });
        repo.replace([renamed]);

        expect(repo.getByPath('new.md')?.id).toBe(toChangeId('change-1'));
        expect(repo.getByPath('old.md')).toBeUndefined();
    });
});
