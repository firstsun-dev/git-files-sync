import { describe, expect, it } from 'vitest';
import { buildStatusTree, type StatusTreeFolder } from '../../src/ui/components/StatusTree';
import type { FileStatus } from '../../src/ui/types';

function folderNames(folder: StatusTreeFolder): string[] {
    return folder.children.map(child => child.name);
}

const statuses: FileStatus[] = [
    { path: 'Archive/readme.md', status: 'synced' },
    { path: 'Projects/notes/done.md', status: 'synced' },
    { path: 'Projects/notes/today.md', status: 'modified' },
    { path: 'Projects/inbox.md', status: 'unsynced' },
    { path: 'zebra.md', status: 'synced' },
];

describe('buildStatusTree', () => {
    it('creates nested folders from file paths', () => {
        const root = buildStatusTree(statuses);
        const projects = root.children.find(child => child.kind === 'folder' && child.name === 'Projects');

        expect(projects).toMatchObject({ kind: 'folder', path: 'Projects' });
        expect(folderNames(projects as StatusTreeFolder)).toEqual(['inbox.md', 'notes']);
    });

    it('keeps folders together while putting attention items before synced items', () => {
        const root = buildStatusTree(statuses);
        const projects = root.children.find(child => child.kind === 'folder' && child.name === 'Projects') as StatusTreeFolder;
        const notes = projects.children.find(child => child.kind === 'folder' && child.name === 'notes') as StatusTreeFolder;

        expect(folderNames(root)).toEqual(['Projects', 'Archive', 'zebra.md']);
        expect(folderNames(projects)).toEqual(['inbox.md', 'notes']);
        expect(folderNames(notes)).toEqual(['today.md', 'done.md']);
    });

    it('omits synced files when the caller does not supply them', () => {
        const root = buildStatusTree(statuses.filter(status => status.status !== 'synced'));

        expect(folderNames(root)).toEqual(['Projects']);
    });
});
