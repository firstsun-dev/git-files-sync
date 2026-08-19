import { describe, expect, it, vi } from 'vitest';
import { SyncPlanner } from '../../../src/logic/sync/SyncPlanner';
import { BoundarySyncWorkspace } from '../../../src/logic/sync/SyncWorkspace';
import { createSyncManagerMocks } from '../../logic/sync-manager-test-helpers';

vi.mock('obsidian');

describe('SyncWorkspace conflict integration', () => {
    it('keeps planner conflict output and diff DTO behind the workspace boundary', async () => {
        const { manager } = createSyncManagerMocks();
        const planner = new SyncPlanner();
        const classification = planner.classify({
            local: { path: 'a.md', exists: true, blobSha: 'local', kind: 'text' },
            remote: { path: 'a.md', repoPath: 'a.md', exists: true, blobSha: 'remote', kind: 'text' },
            base: { blobSha: 'base' },
        });
        const workspace = new BoundarySyncWorkspace(() => manager, {
            refresh: vi.fn(),
            deleteRemote: vi.fn(),
            getDiff: vi.fn().mockResolvedValue({ path: 'a.md', localContent: 'local', remoteContent: 'remote', kind: 'text' }),
        });

        expect(classification).toBe('conflict');
        await expect(workspace.getDiff('a.md')).resolves.toEqual({
            path: 'a.md', localContent: 'local', remoteContent: 'remote', kind: 'text',
        });
    });
});
