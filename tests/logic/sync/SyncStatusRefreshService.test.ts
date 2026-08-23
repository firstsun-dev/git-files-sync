import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { SyncStatusRefreshService } from '../../../src/logic/sync/SyncStatusRefreshService';
import { SyncStatusService } from '../../../src/logic/sync-status-service';
import type { SyncStatusRefreshDependencies } from '../../../src/logic/sync/SyncStatusRefreshService';

vi.mock('obsidian');

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    return file;
}

function buildService(statuses: SyncStatusService, deps: Partial<SyncStatusRefreshDependencies> = {}): SyncStatusRefreshService {
    const base: SyncStatusRefreshDependencies = {
        app: {
            vault: {
                adapter: { stat: vi.fn().mockResolvedValue(null) },
                getAbstractFileByPath: vi.fn().mockReturnValue(null),
            },
        } as never,
        settings: () => ({ syncMetadata: {}, vaultFolder: '', rootPath: '' }) as never,
        gitService: () => ({}) as never,
        gitignoreManager: () => ({ isIgnored: () => false }) as never,
        syncManager: () => ({}) as never,
        filterFilesByVaultFolder: files => files,
        filterPathByVaultFolder: () => true,
        getNormalizedPath: path => path,
        getVaultPath: path => path,
    };
    return new SyncStatusRefreshService({ ...base, ...deps }, statuses);
}

describe('SyncStatusRefreshService local-change handlers', () => {
    describe('handleFileCreated', () => {
        it('adds a brand-new in-scope file as local-only (unsynced)', () => {
            const statuses = new SyncStatusService();
            const service = buildService(statuses);
            const file = makeFile('new.md');

            const changed = service.handleFileCreated(file);

            expect(changed).toBe(true);
            expect(statuses.get('new.md')?.status).toBe('unsynced');
        });

        it('returns false (no-op) when the path is already tracked', () => {
            const statuses = new SyncStatusService();
            statuses.set({ path: 'note.md', status: 'synced' });
            const service = buildService(statuses);

            const changed = service.handleFileCreated(makeFile('note.md'));

            expect(changed).toBe(false);
            expect(statuses.get('note.md')?.status).toBe('synced');
        });

        it('ignores a file outside the configured vault folder', () => {
            const statuses = new SyncStatusService();
            const service = buildService(statuses, {
                filterPathByVaultFolder: path => path.startsWith('notes/'),
            });

            const changed = service.handleFileCreated(makeFile('outside/new.md'));

            expect(changed).toBe(false);
            expect(statuses.has('outside/new.md')).toBe(false);
        });
    });

    describe('handleFileDeleted', () => {
        it('reclassifies a previously tracked (synced) file as local-deleted', () => {
            const statuses = new SyncStatusService();
            statuses.set({ path: 'note.md', status: 'synced', remoteSha: 'abc' });
            const service = buildService(statuses);

            const changed = service.handleFileDeleted('note.md');

            expect(changed).toBe(true);
            expect(statuses.get('note.md')?.status).toBe('local-deleted');
        });

        it('reclassifies a modified file as local-deleted', () => {
            const statuses = new SyncStatusService();
            statuses.set({ path: 'note.md', status: 'modified', remoteSha: 'abc' });
            const service = buildService(statuses);

            expect(service.handleFileDeleted('note.md')).toBe(true);
            expect(statuses.get('note.md')?.status).toBe('local-deleted');
        });

        it('drops a local-only (unsynced) file entirely', () => {
            const statuses = new SyncStatusService();
            statuses.set({ path: 'new.md', status: 'unsynced' });
            const service = buildService(statuses);

            expect(service.handleFileDeleted('new.md')).toBe(true);
            expect(statuses.has('new.md')).toBe(false);
        });

        it('drops a pending move row so the next refresh reconciles it', () => {
            const statuses = new SyncStatusService();
            statuses.set({ path: 'old.md', status: 'moved', movedFrom: 'older.md' });
            const service = buildService(statuses);

            expect(service.handleFileDeleted('old.md')).toBe(true);
            expect(statuses.has('old.md')).toBe(false);
        });

        it('leaves a remote-only row untouched', () => {
            const statuses = new SyncStatusService();
            statuses.set({ path: 'remote.md', status: 'remote-only' });
            const service = buildService(statuses);

            expect(service.handleFileDeleted('remote.md')).toBe(false);
            expect(statuses.get('remote.md')?.status).toBe('remote-only');
        });

        it('leaves an already-local-deleted row untouched', () => {
            const statuses = new SyncStatusService();
            statuses.set({ path: 'note.md', status: 'local-deleted' });
            const service = buildService(statuses);

            expect(service.handleFileDeleted('note.md')).toBe(false);
            expect(statuses.get('note.md')?.status).toBe('local-deleted');
        });

        it('returns false for an unknown path', () => {
            const statuses = new SyncStatusService();
            const service = buildService(statuses);

            expect(service.handleFileDeleted('ghost.md')).toBe(false);
        });
    });

    describe('identifyExtraFiles local-deleted classification', () => {
        it('classifies a previously-tracked removed file as local-deleted', async () => {
            const statuses = new SyncStatusService();
            const remoteMap = new Map([['note.md', { path: 'note.md', sha: 'abc', symlink: false }]]);
            const service = buildService(statuses, {
                settings: () => ({
                    syncMetadata: { 'note.md': { sha: 'abc', lastSyncedAt: 1, renamedFrom: undefined } },
                    vaultFolder: '',
                    rootPath: '',
                }) as never,
            });

            await service.identifyExtraFiles(remoteMap, new Set(), new Map());

            expect(statuses.get('note.md')?.status).toBe('local-deleted');
        });

        it('classifies a never-tracked remote-only file as remote-only', async () => {
            const statuses = new SyncStatusService();
            const remoteMap = new Map([['remote.md', { path: 'remote.md', sha: 'abc', symlink: false }]]);
            const service = buildService(statuses, {
                settings: () => ({ syncMetadata: {}, vaultFolder: '', rootPath: '' }) as never,
            });

            await service.identifyExtraFiles(remoteMap, new Set(), new Map());

            expect(statuses.get('remote.md')?.status).toBe('remote-only');
        });

        it('treats a path with a pending rename (renamedFrom) as remote-only, not local-deleted', async () => {
            const statuses = new SyncStatusService();
            const remoteMap = new Map([['note.md', { path: 'note.md', sha: 'abc', symlink: false }]]);
            const service = buildService(statuses, {
                settings: () => ({
                    syncMetadata: { 'note.md': { sha: 'abc', lastSyncedAt: 1, renamedFrom: 'old.md' } },
                    vaultFolder: '',
                    rootPath: '',
                }) as never,
            });

            await service.identifyExtraFiles(remoteMap, new Set(), new Map());

            expect(statuses.get('note.md')?.status).toBe('remote-only');
        });
    });
});