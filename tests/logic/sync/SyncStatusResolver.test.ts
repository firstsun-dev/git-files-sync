import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { SyncStatusResolver } from '../../../src/logic/sync/SyncStatusResolver';
import type { SyncStatusResolverDependencies } from '../../../src/logic/sync/SyncStatusResolver';
import { SyncStatusService } from '../../../src/logic/sync-status-service';
import { gitBlobSha } from '../../../src/utils/git-blob-sha';

vi.mock('obsidian');

function buildResolver(statuses: SyncStatusService, deps: Partial<SyncStatusResolverDependencies> = {}): SyncStatusResolver {
    const base: SyncStatusResolverDependencies = {
        app: {
            vault: {
                read: vi.fn().mockResolvedValue(''),
                readBinary: vi.fn(),
                adapter: { read: vi.fn(), readBinary: vi.fn() },
            },
        } as never,
        settings: () => ({ syncMetadata: {}, vaultFolder: '', rootPath: '', branch: 'main' }) as never,
        gitService: () => ({}) as never,
        syncManager: () => ({ updateMetadata: vi.fn().mockResolvedValue(undefined) }) as never,
        getNormalizedPath: path => path,
    };
    return new SyncStatusResolver({ ...base, ...deps }, statuses);
}

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    return file;
}

describe('SyncStatusResolver', () => {
    describe('refreshFileStatusBySha', () => {
        it('classifies synced when local content hashes to the remote sha, and updates metadata', async () => {
            const statuses = new SyncStatusService();
            const content = 'hello world';
            const sha = await gitBlobSha(content);
            const updateMetadata = vi.fn().mockResolvedValue(undefined);
            const resolver = buildResolver(statuses, {
                app: { vault: { read: vi.fn().mockResolvedValue(content), readBinary: vi.fn(), adapter: {} } } as never,
                syncManager: () => ({ updateMetadata }) as never,
            });
            const file = makeFile('note.md');

            await resolver.refreshFileStatusBySha(file, { path: 'note.md', sha, symlink: false });

            expect(statuses.get('note.md')?.status).toBe('synced');
            expect(updateMetadata).toHaveBeenCalledWith('note.md', sha);
        });

        it('classifies modified when local content differs from remote and there is no baseline sha on record', async () => {
            const statuses = new SyncStatusService();
            const resolver = buildResolver(statuses, {
                app: { vault: { read: vi.fn().mockResolvedValue('local content'), readBinary: vi.fn(), adapter: {} } } as never,
            });
            const file = makeFile('note.md');

            await resolver.refreshFileStatusBySha(file, { path: 'note.md', sha: 'b'.repeat(40), symlink: false });

            expect(statuses.get('note.md')?.status).toBe('modified');
        });

        it('classifies remote-modified when local content still matches the last-synced baseline but the remote sha moved', async () => {
            const statuses = new SyncStatusService();
            const baselineContent = 'baseline content';
            const baselineSha = await gitBlobSha(baselineContent);
            const resolver = buildResolver(statuses, {
                app: { vault: { read: vi.fn().mockResolvedValue(baselineContent), readBinary: vi.fn(), adapter: {} } } as never,
                settings: () => ({
                    syncMetadata: { 'note.md': { lastSyncedSha: baselineSha, lastSyncedAt: 1 } },
                    vaultFolder: '',
                    rootPath: '',
                    branch: 'main',
                }) as never,
            });
            const file = makeFile('note.md');

            await resolver.refreshFileStatusBySha(file, { path: 'note.md', sha: 'c'.repeat(40), symlink: false });

            expect(statuses.get('note.md')?.status).toBe('remote-modified');
        });
    });

    describe('refreshFileStatusByContent', () => {
        it('falls back to gitService.getFile content comparison when the remote entry has no sha', async () => {
            const statuses = new SyncStatusService();
            const resolver = buildResolver(statuses, {
                app: { vault: { read: vi.fn().mockResolvedValue('same content'), readBinary: vi.fn(), adapter: {} } } as never,
                gitService: () => ({
                    getFile: vi.fn().mockResolvedValue({ content: 'same content', sha: 'z'.repeat(40) }),
                }) as never,
            });
            const file = makeFile('note.md');

            await resolver.refreshFileStatusByContent(file);

            expect(statuses.get('note.md')?.status).toBe('synced');
        });

        it('classifies unsynced when the remote file does not exist (no sha)', async () => {
            const statuses = new SyncStatusService();
            const resolver = buildResolver(statuses, {
                app: { vault: { read: vi.fn().mockResolvedValue('content'), readBinary: vi.fn(), adapter: {} } } as never,
                gitService: () => ({ getFile: vi.fn().mockResolvedValue({ content: undefined, sha: undefined }) }) as never,
            });
            const file = makeFile('note.md');

            await resolver.refreshFileStatusByContent(file);

            expect(statuses.get('note.md')?.status).toBe('unsynced');
        });
    });

    describe('diffDirection', () => {
        it('returns no direction facts when there is no baseline sha on record', () => {
            const statuses = new SyncStatusService();
            const resolver = buildResolver(statuses, { settings: () => ({ syncMetadata: {}, vaultFolder: '', rootPath: '' }) as never });

            expect(resolver.diffDirection('note.md', 'local-sha', 'remote-sha')).toEqual({});
        });

        it('reports local/remote changed facts relative to the last-synced baseline', () => {
            const statuses = new SyncStatusService();
            const resolver = buildResolver(statuses, {
                settings: () => ({
                    syncMetadata: { 'note.md': { lastSyncedSha: 'base-sha', lastSyncedAt: 1 } },
                    vaultFolder: '',
                    rootPath: '',
                }) as never,
            });

            expect(resolver.diffDirection('note.md', 'local-sha', 'base-sha')).toEqual({ localChanged: true, remoteChanged: false });
        });
    });
});
