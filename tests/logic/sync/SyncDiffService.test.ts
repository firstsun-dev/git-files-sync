import { describe, expect, it, vi } from 'vitest';
import { SyncStatusService } from '../../../src/logic/sync-status-service';
import { SyncDiffService } from '../../../src/logic/sync/SyncDiffService';

describe('SyncDiffService', () => {
    it('loads remote content lazily and returns a FileDiff DTO', async () => {
        const statuses = new SyncStatusService();
        statuses.set({
            path: 'notes/a.md',
            status: 'modified',
            localContent: 'local',
            remoteSha: 'remote-sha',
        });
        const getBlob = vi.fn().mockResolvedValue({ content: 'remote' });
        const service = new SyncDiffService(statuses, getBlob);

        await expect(service.getDiff('notes/a.md')).resolves.toEqual({
            path: 'notes/a.md',
            localContent: 'local',
            remoteContent: 'remote',
            kind: 'text',
        });
        await service.getDiff('notes/a.md');

        expect(getBlob).toHaveBeenCalledOnce();
        expect(getBlob).toHaveBeenCalledWith('remote-sha', 'notes/a.md');
    });

    it.each([
        ['image.png', false, 'binary'],
        ['link.md', true, 'symlink'],
    ] as const)('projects %s as %s content', async (path, isSymlink, kind) => {
        const statuses = new SyncStatusService();
        statuses.set({ path, status: 'modified', localContent: new ArrayBuffer(1), isSymlink });
        const service = new SyncDiffService(statuses, vi.fn());

        await expect(service.getDiff(path)).resolves.toMatchObject({ path, kind });
    });

    it('rejects an unknown path instead of exposing an incomplete view model', async () => {
        const service = new SyncDiffService(new SyncStatusService(), vi.fn());

        await expect(service.getDiff('missing.md')).rejects.toThrow('No sync status for missing.md');
    });

    // -------------------------------------------------------------------
    // One-sided diff semantics (#93 summary stat / unified diff pane)
    // -------------------------------------------------------------------

    it('local-only (A): remote side resolves to "" so the whole local content counts as +N', async () => {
        const statuses = new SyncStatusService();
        statuses.set({ path: 'new.md', status: 'unsynced', localContent: 'whole\nfile' });
        const service = new SyncDiffService(statuses, vi.fn());

        await expect(service.getDiff('new.md')).resolves.toEqual({
            path: 'new.md',
            localContent: 'whole\nfile',
            remoteContent: '',
            kind: 'text',
        });
    });

    it('remote-only (↓): local side resolves to "" and the remote content lands without a phantom deletion', async () => {
        const statuses = new SyncStatusService();
        statuses.set({ path: 'cloud.md', status: 'remote-only', remoteSha: 'sha-1' });
        const getBlob = vi.fn().mockResolvedValue({ content: 'remote\ncontent' });
        const service = new SyncDiffService(statuses, getBlob);

        await expect(service.getDiff('cloud.md')).resolves.toEqual({
            path: 'cloud.md',
            localContent: '',
            remoteContent: 'remote\ncontent',
            kind: 'text',
        });
        expect(getBlob).toHaveBeenCalledWith('sha-1', 'cloud.md');
    });

    it('local-deleted (D): remote content diffs against "" — a pure -N deletion', async () => {
        const statuses = new SyncStatusService();
        statuses.set({ path: 'gone.md', status: 'local-deleted', remoteSha: 'sha-2', remoteContent: 'old\nlines' });
        const service = new SyncDiffService(statuses, vi.fn());

        await expect(service.getDiff('gone.md')).resolves.toEqual({
            path: 'gone.md',
            localContent: '',
            remoteContent: 'old\nlines',
            kind: 'text',
        });
    });

    // -------------------------------------------------------------------
    // In-flight remote fetch deduplication
    // -------------------------------------------------------------------

    it('concurrent getDiff calls for the same remoteSha:path share one readBlob call', async () => {
        const statuses = new SyncStatusService();
        statuses.set({ path: 'big.md', status: 'modified', localContent: 'local', remoteSha: 'sha-1' });
        let release!: (value: { content: string }) => void;
        const getBlob = vi.fn().mockImplementation(() => new Promise<{ content: string }>(resolve => { release = resolve; }));
        const service = new SyncDiffService(statuses, getBlob);

        const first = service.getDiff('big.md');
        const second = service.getDiff('big.md');
        release({ content: 'remote' });

        await Promise.all([first, second]);
        expect(getBlob).toHaveBeenCalledTimes(1);
    });

    it('different paths (or shas) never coalesce onto each other', async () => {
        const statuses = new SyncStatusService();
        statuses.set({ path: 'a.md', status: 'modified', localContent: 'a', remoteSha: 'sha-1' });
        statuses.set({ path: 'b.md', status: 'modified', localContent: 'b', remoteSha: 'sha-1' });
        statuses.set({ path: 'c.md', status: 'modified', localContent: 'c', remoteSha: 'sha-2' });
        const getBlob = vi.fn().mockImplementation((_sha: string, path: string) => Promise.resolve({ content: path }));
        const service = new SyncDiffService(statuses, getBlob);

        await Promise.all([service.getDiff('a.md'), service.getDiff('b.md'), service.getDiff('c.md')]);
        expect(getBlob).toHaveBeenCalledTimes(3);
    });

    it('a failed shared fetch settles all requests and later calls retry the blob', async () => {
        const statuses = new SyncStatusService();
        statuses.set({ path: 'a.md', status: 'modified', localContent: 'local', remoteSha: 'sha-1' });
        const loader: (sha: string, path: string) => Promise<{ content: string }> = vi.fn()
            .mockRejectedValueOnce(new Error('blob fetch failed'))
            .mockResolvedValueOnce({ content: 'remote' });
        const getBlob = loader as ReturnType<typeof vi.fn>;
        const service = new SyncDiffService(statuses, loader);

        const first = service.getDiff('a.md');
        const second = service.getDiff('a.md');
        await expect(first).rejects.toThrow('blob fetch failed');
        await expect(second).rejects.toThrow('blob fetch failed');
        expect(getBlob).toHaveBeenCalledTimes(1);

        // After the shared failure, a new consumer starts a fresh fetch.
        await expect(service.getDiff('a.md')).resolves.toMatchObject({ remoteContent: 'remote' });
        expect(getBlob).toHaveBeenCalledTimes(2);
    });

    // -------------------------------------------------------------------
    // Batch-conflict stats (getConflictStat / getConflictDiff)
    // -------------------------------------------------------------------

    it('getConflictStat: remote = OLD, local = NEW + extra line → expected +N/-N', async () => {
        const remote = 'line1\nline2';
        const local = 'line1\nline2\nline3';
        const getBlob = vi.fn().mockResolvedValue({ content: remote });
        const service = new SyncDiffService(new SyncStatusService(), getBlob);

        await expect(service.getConflictStat({
            path: 'a.md', localContent: local, remoteSha: 'sha-1', repoPath: 'a.md',
        })).resolves.toEqual({ status: 'ready', stat: { additions: 1, deletions: 0 } });
        expect(getBlob).toHaveBeenCalledWith('sha-1', 'a.md');
    });

    it('getConflictDiff returns both sides for a text conflict and builds directly on resolveRemoteContent', async () => {
        const getBlob = vi.fn().mockResolvedValue({ content: 'remote\ncontent' });
        const service = new SyncDiffService(new SyncStatusService(), getBlob);

        await expect(service.getConflictDiff({
            path: 'a.md', localContent: 'local text', remoteSha: 'sha-1', repoPath: 'a.md',
        })).resolves.toEqual({ localContent: 'local text', remoteContent: 'remote\ncontent' });
    });

    it('binary conflicts are terminally unavailable with zero remote fetches (stat and diff)', async () => {
        const getBlob = vi.fn();
        const service = new SyncDiffService(new SyncStatusService(), getBlob);
        const conflict = { path: 'image.png', localContent: new ArrayBuffer(3), remoteSha: 'sha-1', repoPath: 'img' };

        await expect(service.getConflictStat(conflict)).resolves.toEqual({ status: 'unavailable' });
        await expect(service.getConflictDiff(conflict)).resolves.toBeUndefined();
        expect(getBlob).not.toHaveBeenCalled();
    });

    it('two concurrent getConflictStat calls for the same conflict share one blob fetch', async () => {
        let release!: (value: { content: string }) => void;
        const getBlob = vi.fn().mockImplementation(() => new Promise<{ content: string }>(resolve => { release = resolve; }));
        const service = new SyncDiffService(new SyncStatusService(), getBlob);

        const conflict = { path: 'a.md', localContent: 'local', remoteSha: 'sha-1', repoPath: 'a.md' };
        const first = service.getConflictStat(conflict);
        const second = service.getConflictStat(conflict);
        release({ content: 'remote' });

        await Promise.all([first, second]);
        expect(getBlob).toHaveBeenCalledTimes(1);
    });

    it('a background stat racing a user View Diff on the same blob is one round-trip', async () => {
        const getBlob = vi.fn().mockResolvedValue({ content: 'remote' });
        const service = new SyncDiffService(new SyncStatusService(), getBlob);
        const conflict = { path: 'a.md', localContent: 'local', remoteSha: 'sha-1', repoPath: 'a.md' };

        const [stat, diff] = await Promise.all([service.getConflictStat(conflict), service.getConflictDiff(conflict)]);
        expect(stat).toEqual({ status: 'ready', stat: { additions: 1, deletions: 1 } });
        expect(diff).toEqual({ localContent: 'local', remoteContent: 'remote' });
        expect(getBlob).toHaveBeenCalledTimes(1);
    });
});
