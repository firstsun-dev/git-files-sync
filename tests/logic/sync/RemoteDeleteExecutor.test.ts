import { describe, expect, it, vi } from 'vitest';
import { RemoteDeleteExecutor } from '../../../src/logic/sync/RemoteDeleteExecutor';
import type { GitServiceInterface } from '../../../src/services/git-service-interface';

function service(overrides: Partial<GitServiceInterface> = {}): GitServiceInterface {
    return {
        deleteFile: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as GitServiceInterface;
}

describe('RemoteDeleteExecutor', () => {
    it('uses the provider batch boundary and reports deleted vault paths', async () => {
        const deleteBatch = vi.fn().mockResolvedValue(undefined);
        const executor = new RemoteDeleteExecutor(service({ deleteBatch }), 'main', 2);

        const result = await executor.execute([
            { path: 'Vault/a.md', repoPath: 'a.md' },
            { path: 'Vault/b.md', repoPath: 'b.md' },
            { path: 'Vault/c.md', repoPath: 'c.md' },
        ]);

        expect(deleteBatch).toHaveBeenCalledTimes(2);
        expect(result.deletedPaths).toEqual(['Vault/a.md', 'Vault/b.md', 'Vault/c.md']);
        expect(result.errors).toEqual([]);
    });

    it('marks every item in a failed atomic chunk and continues later chunks', async () => {
        const deleteBatch = vi.fn()
            .mockRejectedValueOnce(new Error('provider unavailable'))
            .mockResolvedValueOnce(undefined);
        const executor = new RemoteDeleteExecutor(service({ deleteBatch }), 'main', 2);

        const result = await executor.execute([
            { path: 'a.md', repoPath: 'a.md' },
            { path: 'b.md', repoPath: 'b.md' },
            { path: 'c.md', repoPath: 'c.md' },
        ]);

        expect(result.deletedPaths).toEqual(['c.md']);
        expect(result.errors).toEqual([
            { path: 'a.md', message: 'provider unavailable' },
            { path: 'b.md', message: 'provider unavailable' },
        ]);
    });

    it('falls back to sequential deletion with partial success', async () => {
        const deleteFile = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('locked'));
        const executor = new RemoteDeleteExecutor(service({ deleteFile }), 'main');

        const result = await executor.execute([
            { path: 'a.md', repoPath: 'a.md' },
            { path: 'b.md', repoPath: 'b.md' },
        ]);

        expect(result.deletedPaths).toEqual(['a.md']);
        expect(result.errors).toEqual([{ path: 'b.md', message: 'locked' }]);
    });
});
