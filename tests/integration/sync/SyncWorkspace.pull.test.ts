/* eslint-disable @typescript-eslint/unbound-method */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoundarySyncWorkspace } from '../../../src/logic/sync/SyncWorkspace';
import { createSyncManagerMocks } from '../../logic/sync-manager-test-helpers';
import { SyncPlanModal } from '../../../src/ui/SyncPlanModal';

vi.mock('obsidian');
vi.mock('../../../src/ui/SyncPlanModal');

describe('SyncWorkspace pull integration', () => {
    beforeEach(() => {
        vi.mocked(SyncPlanModal).mockImplementation(function (
            this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: unknown, onConfirm: () => void,
        ) {
            onConfirm();
            return this;
        } as never);
    });

    it('creates a remote-only file through the real pull executor', async () => {
        const { manager, mockAdapter, mockGitService } = createSyncManagerMocks();
        mockAdapter.exists.mockResolvedValue(false);
        mockGitService.listFilesDetailed.mockResolvedValue([{ path: 'remote.md', sha: 'sha', symlink: false }]);
        mockGitService.getFile.mockResolvedValue({ sha: 'sha', content: 'remote' });
        const workspace = new BoundarySyncWorkspace(() => manager, {
            refresh: vi.fn(), deleteRemote: vi.fn(), getDiff: vi.fn(),
        });

        const result = await workspace.pull(['remote.md']);

        expect(result.success).toBe(1);
        expect(mockAdapter.write).toHaveBeenCalledWith('remote.md', 'remote');
    });
});
