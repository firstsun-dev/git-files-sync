import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { SyncFileDiscovery } from '../../../src/logic/sync/SyncFileDiscovery';
import type { SyncFileDiscoveryDependencies } from '../../../src/logic/sync/SyncFileDiscovery';
import { SyncStatusService } from '../../../src/logic/sync-status-service';

vi.mock('obsidian');

function buildDiscovery(statuses: SyncStatusService, deps: Partial<SyncFileDiscoveryDependencies> = {}): SyncFileDiscovery {
    const base: SyncFileDiscoveryDependencies = {
        app: {
            vault: {
                adapter: { stat: vi.fn().mockResolvedValue(null) },
                getAbstractFileByPath: vi.fn().mockReturnValue(null),
            },
        } as never,
        settings: () => ({ syncMetadata: {}, vaultFolder: '', rootPath: '' }) as never,
        gitService: () => ({}) as never,
        gitignoreManager: () => ({ isIgnored: () => false }) as never,
        filterFilesByVaultFolder: files => files,
        filterPathByVaultFolder: () => true,
        getNormalizedPath: path => path,
        getVaultPath: path => path,
    };
    return new SyncFileDiscovery({ ...base, ...deps }, statuses);
}

describe('SyncFileDiscovery', () => {
    describe('identifyExtraFiles local-deleted classification', () => {
        it('classifies a previously-tracked removed file as local-deleted', async () => {
            const statuses = new SyncStatusService();
            const remoteMap = new Map([['note.md', { path: 'note.md', sha: 'abc', symlink: false }]]);
            const discovery = buildDiscovery(statuses, {
                settings: () => ({
                    syncMetadata: { 'note.md': { sha: 'abc', lastSyncedAt: 1, renamedFrom: undefined } },
                    vaultFolder: '',
                    rootPath: '',
                }) as never,
            });

            await discovery.identifyExtraFiles(remoteMap, new Set(), new Map());

            expect(statuses.get('note.md')?.status).toBe('local-deleted');
        });

        it('classifies a never-tracked remote-only file as remote-only', async () => {
            const statuses = new SyncStatusService();
            const remoteMap = new Map([['remote.md', { path: 'remote.md', sha: 'abc', symlink: false }]]);
            const discovery = buildDiscovery(statuses, {
                settings: () => ({ syncMetadata: {}, vaultFolder: '', rootPath: '' }) as never,
            });

            await discovery.identifyExtraFiles(remoteMap, new Set(), new Map());

            expect(statuses.get('remote.md')?.status).toBe('remote-only');
        });

        it('treats a path with a pending rename (renamedFrom) as remote-only, not local-deleted', async () => {
            const statuses = new SyncStatusService();
            const remoteMap = new Map([['note.md', { path: 'note.md', sha: 'abc', symlink: false }]]);
            const discovery = buildDiscovery(statuses, {
                settings: () => ({
                    syncMetadata: { 'note.md': { sha: 'abc', lastSyncedAt: 1, renamedFrom: 'old.md' } },
                    vaultFolder: '',
                    rootPath: '',
                }) as never,
            });

            await discovery.identifyExtraFiles(remoteMap, new Set(), new Map());

            expect(statuses.get('note.md')?.status).toBe('remote-only');
        });

        it('leaves an in-scope local file alone (returned as an extra candidate, not classified)', async () => {
            const statuses = new SyncStatusService();
            const file = new TFile();
            file.path = 'note.md';
            const remoteMap = new Map([['note.md', { path: 'note.md', sha: 'abc', symlink: false }]]);
            const discovery = buildDiscovery(statuses);

            const extra = await discovery.identifyExtraFiles(remoteMap, new Set(), new Map([['note.md', file]]));

            expect(extra).toEqual([file]);
            expect(statuses.has('note.md')).toBe(false);
        });
    });

    describe('discoverFiles', () => {
        it('excludes gitignored local and remote paths and normalizes remote paths under rootPath', async () => {
            const statuses = new SyncStatusService();
            const localFile = new TFile();
            localFile.path = 'keep.md';
            const ignoredFile = new TFile();
            ignoredFile.path = 'ignored.md';
            const discovery = buildDiscovery(statuses, {
                app: {
                    vault: {
                        getFiles: () => [localFile, ignoredFile],
                        adapter: { list: vi.fn().mockRejectedValue(new Error('no raw listing')) },
                    },
                } as never,
                settings: () => ({ syncMetadata: {}, vaultFolder: '', rootPath: 'vault' }) as never,
                gitService: () => ({
                    listFilesDetailed: vi.fn().mockResolvedValue([
                        { path: 'vault/keep.md', sha: 'a', symlink: false },
                        { path: 'other/outside.md', sha: 'b', symlink: false },
                    ]),
                }) as never,
                gitignoreManager: () => ({
                    loadGitignores: vi.fn().mockResolvedValue(undefined),
                    isIgnored: (path: string) => path === 'ignored.md',
                }) as never,
                filterFilesByVaultFolder: files => files,
            });

            const result = await discovery.discoverFiles();

            expect(result.local.map(f => f.path)).toEqual(['keep.md']);
            expect(result.remoteMap.has('keep.md')).toBe(true);
            // Remote path outside rootPath is dropped entirely (getNormalizedRemotePath -> null).
            expect(result.remoteMap.size).toBe(1);
        });
    });
});
