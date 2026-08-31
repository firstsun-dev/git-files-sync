import { describe, expect, it, vi } from 'vitest';
import { PushExecutor } from '../../../src/logic/sync/PushExecutor';
import type { GitServiceInterface } from '../../../src/services/git-service-interface';

describe('PushExecutor', () => {
    it('pushes mapped content and updates metadata with a provider sha', async () => {
        const pushFile = vi.fn().mockResolvedValue({ sha: 'remote-sha' });
        const updateMetadata = vi.fn().mockResolvedValue(undefined);
        const executor = new PushExecutor(
            () => ({ pushFile } as unknown as GitServiceInterface),
            () => 'main',
            path => path.replace('Vault/', ''),
            updateMetadata,
            () => 'GitHub',
        );

        const sha = await executor.push({ path: 'Vault/a.md', name: 'a.md' }, 'hello', 'old-sha', 'revision', true);

        expect(pushFile).toHaveBeenCalledWith('a.md', 'hello', 'main', 'Update a.md from Obsidian', 'old-sha', 'revision');
        expect(updateMetadata).toHaveBeenCalledWith('Vault/a.md', 'remote-sha');
        expect(sha).toBe('remote-sha');
    });

    it('does not update metadata when the provider fails', async () => {
        const updateMetadata = vi.fn();
        const executor = new PushExecutor(
            () => ({ pushFile: vi.fn().mockRejectedValue(new Error('provider failed')) } as unknown as GitServiceInterface),
            () => 'main',
            path => path,
            updateMetadata,
            () => 'GitHub',
        );

        await expect(executor.push({ path: 'a.md', name: 'a.md' }, 'hello')).rejects.toThrow('provider failed');
        expect(updateMetadata).not.toHaveBeenCalled();
    });

    it('still reports success and returns the sha when the remote push succeeds but local metadata persistence fails', async () => {
        const pushFile = vi.fn().mockResolvedValue({ sha: 'remote-sha' });
        const updateMetadata = vi.fn().mockRejectedValue(new Error('disk full'));
        const notify = vi.fn();
        const executor = new PushExecutor(
            () => ({ pushFile } as unknown as GitServiceInterface),
            () => 'main',
            path => path,
            updateMetadata,
            () => 'GitHub',
            notify,
        );

        const sha = await executor.push({ path: 'a.md', name: 'a.md' }, 'hello', undefined, undefined, true);

        expect(sha).toBe('remote-sha');
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('failed to save local sync state'));
    });

    it('reads the current provider lazily after a provider switch', async () => {
        const firstPush = vi.fn();
        const secondPush = vi.fn().mockResolvedValue({ sha: 'sha' });
        let current = { pushFile: firstPush } as unknown as GitServiceInterface;
        const executor = new PushExecutor(() => current, () => 'main', path => path, vi.fn(), () => 'GitHub');
        current = { pushFile: secondPush } as unknown as GitServiceInterface;

        await executor.push({ path: 'a.md', name: 'a.md' }, 'hello', undefined, undefined, true);

        expect(firstPush).not.toHaveBeenCalled();
        expect(secondPush).toHaveBeenCalledOnce();
    });
});
