/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() mocks intentionally reference methods unbound; safe under Vitest's mocking model */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoundarySyncWorkspace } from '../../../src/logic/sync/SyncWorkspace';
import { createSyncManagerMocks } from '../../logic/sync-manager-test-helpers';
import { SyncPlanModal } from '../../../src/ui/SyncPlanModal';

vi.mock('obsidian');
vi.mock('../../../src/ui/SyncPlanModal');

describe('SyncWorkspace push integration', () => {
    beforeEach(() => {
        vi.mocked(SyncPlanModal).mockImplementation(function (
            this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: unknown, onConfirm: () => void,
        ) {
            onConfirm();
            return this;
        } as never);
    });

    it('runs the real scanner/planner/push executor through the manager facade', async () => {
        const { manager, mockAdapter, mockGitService } = createSyncManagerMocks();
        mockAdapter.exists.mockResolvedValue(true);
        mockAdapter.read.mockResolvedValue('local');
        mockGitService.listFilesDetailed.mockResolvedValue([]);
        mockGitService.pushFile.mockResolvedValue({ path: 'a.md', sha: 'sha' });
        const workspace = new BoundarySyncWorkspace(() => manager, {
            refresh: vi.fn(), deleteRemote: vi.fn(), getDiff: vi.fn(),
        });

        const result = await workspace.push(['a.md']);

        expect(result.success).toBe(1);
        expect(mockGitService.pushFile).toHaveBeenCalledWith('a.md', 'local', 'main', expect.any(String), undefined, undefined);
        expect(manager.status.get('a.md')).toBeUndefined();
    });
});

/* eslint-enable @typescript-eslint/unbound-method -- re-enable after the whole-file exemption above */
