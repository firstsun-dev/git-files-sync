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
});
