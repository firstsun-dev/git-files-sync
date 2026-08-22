import { describe, expect, it } from 'vitest';
import { ChangeTreeBuilder, type ChangeTreeFolderNode } from '../../../src/logic/source-control/ChangeTreeBuilder';
import { toChangeId, type SyncChange } from '../../../src/logic/source-control/types';

describe('ChangeTreeBuilder', () => {
    it('maps a local change as a top-level file node', () => {
        const builder = new ChangeTreeBuilder();
        const change: SyncChange = { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' };

        const tree = builder.build([change]);

        expect(tree).toEqual([
            { type: 'file', id: toChangeId('c-1'), name: 'a.md', path: 'a.md', previousPath: undefined, kind: 'local-only' },
        ]);
    });

    it('maps a remote change the same way as a local one', () => {
        const builder = new ChangeTreeBuilder();
        const change: SyncChange = { id: toChangeId('c-1'), path: 'notes/b.md', kind: 'remote-only' };

        const tree = builder.build([change]);
        const folder = tree[0] as ChangeTreeFolderNode;

        expect(folder).toMatchObject({ type: 'folder', name: 'notes', path: 'notes' });
        expect(folder.children).toEqual([
            { type: 'file', id: toChangeId('c-1'), name: 'b.md', path: 'notes/b.md', previousPath: undefined, kind: 'remote-only' },
        ]);
    });

    it('maps a conflict change preserving its ChangeId', () => {
        const builder = new ChangeTreeBuilder();
        const change: SyncChange = { id: toChangeId('c-conflict'), path: 'c.md', kind: 'conflict' };

        const tree = builder.build([change]);

        expect(tree[0]).toMatchObject({ id: toChangeId('c-conflict'), kind: 'conflict' });
    });

    it('groups files ready to push under the same folder hierarchy', () => {
        const builder = new ChangeTreeBuilder();
        const changes: SyncChange[] = [
            { id: toChangeId('c-1'), path: 'notes/a.md', kind: 'local-only' },
            { id: toChangeId('c-2'), path: 'notes/b.md', kind: 'local-modified' },
        ];

        const tree = builder.build(changes);
        const folder = tree[0] as ChangeTreeFolderNode;

        expect(tree).toHaveLength(1);
        expect(folder.children.map(child => child.name)).toEqual(['a.md', 'b.md']);
    });

    it('keeps ChangeId stable for a rename and carries previousPath for display', () => {
        const builder = new ChangeTreeBuilder();
        const change: SyncChange = {
            id: toChangeId('c-1'),
            path: 'folder/new.md',
            previousPath: 'folder/old.md',
            kind: 'moved',
        };

        const tree = builder.build([change]);
        const folder = tree[0] as ChangeTreeFolderNode;
        const file = folder.children[0];

        expect(file).toEqual({
            type: 'file',
            id: toChangeId('c-1'),
            name: 'new.md',
            path: 'folder/new.md',
            previousPath: 'folder/old.md',
            kind: 'moved',
        });
    });

    it('builds nested folder hierarchy for deeply nested paths', () => {
        const builder = new ChangeTreeBuilder();
        const changes: SyncChange[] = [
            { id: toChangeId('c-1'), path: 'a/b/c/d.md', kind: 'local-only' },
        ];

        const tree = builder.build(changes);
        const a = tree[0] as ChangeTreeFolderNode;
        const b = a.children[0] as ChangeTreeFolderNode;
        const c = b.children[0] as ChangeTreeFolderNode;

        expect(a).toMatchObject({ type: 'folder', name: 'a', path: 'a' });
        expect(b).toMatchObject({ type: 'folder', name: 'b', path: 'a/b' });
        expect(c).toMatchObject({ type: 'folder', name: 'c', path: 'a/b/c' });
        expect(c.children).toEqual([
            { type: 'file', id: toChangeId('c-1'), name: 'd.md', path: 'a/b/c/d.md', previousPath: undefined, kind: 'local-only' },
        ]);
    });
});
