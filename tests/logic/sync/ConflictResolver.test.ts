/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import { ConflictResolver } from '../../../src/logic/sync/ConflictResolver';
import type { PullExecutor } from '../../../src/logic/sync/PullExecutor';
import type { GitServiceInterface } from '../../../src/services/git-service-interface';
import type { BatchPushConflict, PushResults } from '../../../src/logic/sync/types';

const conflict = (path: string, sha = 'reviewed'): BatchPushConflict => ({
    path,
    name: path,
    repoPath: path,
    localContent: 'local',
    remoteSha: sha,
});

function results(): PushResults {
    return { success: 0, failed: 0, conflicts: 0, resolvedConflicts: 0, skippedConflicts: 0, errors: [], syncedPaths: [] };
}

describe('ConflictResolver', () => {
    it('detects a remote that changed after review', async () => {
        const service = { getFile: vi.fn().mockResolvedValue({ sha: 'new' }) } as unknown as GitServiceInterface;
        const resolver = new ConflictResolver(() => service, () => 'main', {} as PullExecutor);

        await expect(resolver.findStale([conflict('a.md')])).resolves.toEqual([conflict('a.md')]);
    });

    it('applies the exact reviewed blob and records success', async () => {
        const service = { getBlob: vi.fn().mockResolvedValue({ sha: 'reviewed', content: 'remote' }) } as unknown as GitServiceInterface;
        const pull = { pull: vi.fn().mockResolvedValue(undefined) } as unknown as PullExecutor;
        const resolver = new ConflictResolver(() => service, () => 'main', pull);
        const output = results();

        await resolver.applyRemote([conflict('a.md')], output);

        expect(service.getBlob).toHaveBeenCalledWith('reviewed', 'a.md');
        expect(pull.pull).toHaveBeenCalledWith({ path: 'a.md', name: 'a.md' }, 'remote', 'reviewed', true, undefined);
        expect(output.resolvedConflicts).toBe(1);
        expect(output.syncedPaths).toEqual([{ path: 'a.md', sha: 'reviewed' }]);
    });

    it('reports a per-file failure without applying metadata', async () => {
        const service = { getBlob: vi.fn().mockRejectedValue(new Error('provider failed')) } as unknown as GitServiceInterface;
        const pull = { pull: vi.fn() } as unknown as PullExecutor;
        const output = results();

        await new ConflictResolver(() => service, () => 'main', pull).applyRemote([conflict('a.md')], output);

        expect(output.failed).toBe(1);
        expect(output.errors).toEqual([{ file: 'a.md', error: 'provider failed' }]);
        expect(pull.pull).not.toHaveBeenCalled();
    });
});
