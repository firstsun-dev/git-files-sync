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
        it('adds a brand-new in-scope file as local-only (unsynced)', async () => {
            const statuses = new SyncStatusService();
            const service = buildService(statuses, {
                app: {
                    vault: {
                        read: vi.fn().mockResolvedValue(''),
                        readBinary: vi.fn(),
                        adapter: { stat: vi.fn().mockResolvedValue(null) },
                    },
                } as never,
            });
            const file = makeFile('new.md');

            const changed = await service.handleFileCreated(file);

            expect(changed).toBe(true);
            expect(statuses.get('new.md')?.status).toBe('unsynced');
        });

        it('publishes the row immediately, then lands content async so the row can show its +N stat', async () => {
            const statuses = new SyncStatusService();
            let resolveRead: ((content: string) => void) | undefined;
            const service = buildService(statuses, {
                app: {
                    vault: {
                        read: vi.fn().mockImplementation(() => new Promise<string>(resolve => { resolveRead = resolve; })),
                        readBinary: vi.fn(),
                        adapter: { stat: vi.fn().mockResolvedValue(null), read: vi.fn() },
                    },
                } as never,
            });
            const file = makeFile('new.md');

            await service.handleFileCreated(file);

            // Step 1: row visible without content (no poisoned stat cache).
            expect(statuses.get('new.md')?.status).toBe('unsynced');
            expect(statuses.get('new.md')?.localContent).toBeUndefined();

            // Step 2: the async read lands and is republished.
            resolveRead?.('# Hello\nworld\n');
            await Promise.resolve();
            await Promise.resolve();
            expect(statuses.get('new.md')?.localContent).toBe('# Hello\nworld\n');
        });

        it('keeps the A row visible (pending, uncached) when the initial content read fails', async () => {
            const statuses = new SyncStatusService();
            const service = buildService(statuses, {
                app: {
                    vault: {
                        read: vi.fn().mockRejectedValue(new Error('disk error')),
                        // The adapter fallback also fails, so even readFileContent's
                        // fallback path throws -> the republish is skipped.
                        readBinary: vi.fn(),
                        adapter: { stat: vi.fn().mockResolvedValue(null) },
                    },
                } as never,
            });

            await service.handleFileCreated(makeFile('new.md'));

            expect(statuses.get('new.md')?.status).toBe('unsynced');
            expect(statuses.get('new.md')?.localContent).toBeUndefined();
        });

        it('a create read that lands after a raced modify must not clobber the newer content', async () => {
            const statuses = new SyncStatusService();
            let resolveRead: ((content: string) => void) | undefined;
            let modifyContent = 'older modify content';
            const service = buildService(statuses, {
                app: {
                    vault: {
                        read: vi.fn()
                            .mockImplementationOnce(() => new Promise<string>(resolve => { resolveRead = resolve; }))
                            .mockImplementation(() => Promise.resolve(modifyContent)),
                        readBinary: vi.fn(),
                        adapter: { stat: vi.fn().mockResolvedValue(null), read: vi.fn() },
                    },
                } as never,
            });
            const file = makeFile('new.md');

            await service.handleFileCreated(file);
            // The user edits while the create's read is still in flight.
            statuses.set(file.path, { file, path: file.path, status: 'unsynced' });
            modifyContent = 'newer modify content';
            await service.handleFileModified(file);
            // Now the stale create read resolves — it must lose.
            resolveRead?.('stale create content');
            await Promise.resolve();
            await Promise.resolve();
            await expect.poll(() => statuses.get('new.md')?.localContent).toBe('newer modify content');
        });

        it('reads binary create events through readBinary so content survives for the provider', async () => {
            const statuses = new SyncStatusService();
            const binary = new ArrayBuffer(4);
            const service = buildService(statuses, {
                app: {
                    vault: {
                        read: vi.fn(),
                        readBinary: vi.fn().mockResolvedValue(binary),
                        adapter: { stat: vi.fn().mockResolvedValue(null) },
                    },
                } as never,
            });

            await service.handleFileCreated(makeFile('image.png'));
            await Promise.resolve();
            await Promise.resolve();

            expect(statuses.get('image.png')?.localContent).toBe(binary);
        });

        it('returns false (no-op) when the path is already tracked', async () => {
            const statuses = new SyncStatusService();
            statuses.set({ path: 'note.md', status: 'synced' });
            const service = buildService(statuses);

            const changed = await service.handleFileCreated(makeFile('note.md'));

            expect(changed).toBe(false);
            expect(statuses.get('note.md')?.status).toBe('synced');
        });

        it('ignores a file outside the configured vault folder', async () => {
            const statuses = new SyncStatusService();
            const service = buildService(statuses, {
                filterPathByVaultFolder: path => path.startsWith('notes/'),
            });

            const changed = await service.handleFileCreated(makeFile('outside/new.md'));

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

    describe('handleFileModified', () => {
        it('does not overwrite newer full-refresh state while the modify read is pending (regression)', async () => {
            const statuses = new SyncStatusService();
            let resolveRead: ((content: string) => void) | undefined;
            const file = makeFile('note.md');
            const service = buildService(statuses, {
                app: {
                    vault: {
                        read: vi.fn().mockImplementation(() => new Promise<string>(resolve => { resolveRead = resolve; })),
                        readBinary: vi.fn(),
                        adapter: { stat: vi.fn().mockResolvedValue(null), read: vi.fn() },
                    },
                } as never,
            });

            // Tracked file synced at remoteSha A.
            statuses.set({
                file,
                path: 'note.md',
                status: 'synced',
                remoteSha: 'a'.repeat(40),
                remoteContent: 'old remote',
            });

            // User edits → modify starts, read pending.
            const modifyPromise = service.handleFileModified(file);

            // Full refresh completes while the read is still pending:
            // remoteSha A → B, remoteContent updated.
            statuses.set('note.md', {
                file,
                path: 'note.md',
                status: 'modified',
                remoteSha: 'b'.repeat(40),
                remoteContent: 'latest remote',
            });

            // The modify read lands.
            resolveRead?.('locally edited content');
            await modifyPromise;

            const final = statuses.get('note.md');
            // localContent = the modified content...
            expect(final?.localContent).toBe('locally edited content');
            // ...but the refreshed remote state is preserved, not overwritten
            // by the stale pre-await snapshot.
            expect(final?.remoteSha).toBe('b'.repeat(40));
            expect(final?.remoteContent).toBe('latest remote');
            // Old sha A would have classified "not equal" → modified; new sha B
            // also not equal → still modified, but derived from the CURRENT row.
            expect(final?.status).toBe('modified');
        });

        it('does not resurrect a row deleted while the modify read is pending', async () => {
            const statuses = new SyncStatusService();
            let resolveRead: ((content: string) => void) | undefined;
            const file = makeFile('note.md');
            const service = buildService(statuses, {
                app: {
                    vault: {
                        read: vi.fn().mockImplementation(() => new Promise<string>(resolve => { resolveRead = resolve; })),
                        readBinary: vi.fn(),
                        adapter: { stat: vi.fn().mockResolvedValue(null), read: vi.fn() },
                    },
                } as never,
            });

            statuses.set({ path: 'note.md', status: 'synced', remoteSha: 'abc' });
            const modifyPromise = service.handleFileModified(file);

            // File deleted while the read is pending (synced → local-deleted).
            service.handleFileDeleted('note.md');
            resolveRead?.('late content');
            await modifyPromise;

            // The modify must not resurrect the row as modified/synced with
            // local content — it stays a local deletion, content-less.
            const row = statuses.get('note.md');
            expect(row?.status).toBe('local-deleted');
            expect(row?.localContent).toBeUndefined();
        });

        it('does not write back to a path renamed away while the modify read is pending', async () => {
            const statuses = new SyncStatusService();
            let resolveRead: ((content: string) => void) | undefined;
            const file = makeFile('note.md');
            const service = buildService(statuses, {
                app: {
                    vault: {
                        read: vi.fn().mockImplementation(() => new Promise<string>(resolve => { resolveRead = resolve; })),
                        readBinary: vi.fn(),
                        adapter: { stat: vi.fn().mockResolvedValue(null), read: vi.fn() },
                    },
                } as never,
            });

            statuses.set({ file, path: 'note.md', status: 'synced', remoteSha: 'abc' });
            const modifyPromise = service.handleFileModified(file);

            // Renamed to a different path while pending: the old path's row is
            // re-keyed by handleFileRenamed (same file object moves with it),
            // so the modify read for note.md must not write old-path state.
            const renamed = makeFile('renamed.md');
            service.handleFileRenamed(renamed, 'note.md');
            resolveRead?.('late content');
            await modifyPromise;

            expect(statuses.has('note.md')).toBe(false);
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