/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSyncManagerMocks, SyncManagerMocks } from './sync-manager-test-helpers';
import { SyncPlanModal, SyncPlanDirection } from '../../src/ui/SyncPlanModal';

vi.mock('obsidian');
// Every push/pull now shows a plan for review before applying; auto-confirm
// it here since these tests exercise hidden-path handling, not the modal.
vi.mock('../../src/ui/SyncPlanModal');

describe('SyncManager – hidden file support', () => {
    let mocks: SyncManagerMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(SyncPlanModal).mockImplementation(function (
            this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, onConfirm: () => void
        ) {
            onConfirm();
            return this;
        } as never);
        mocks = createSyncManagerMocks();
    });

    describe('pullFile with hidden paths', () => {
        it('creates single hidden parent directory on pull', async () => {
            const { manager, mockAdapter, mockGitService } = mocks;
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'abc123', content: '{"key":"value"}' });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('.claude/settings.json');

            expect(mockAdapter.mkdir).toHaveBeenCalledWith('.claude');
            expect(mockAdapter.write).toHaveBeenCalledWith('.claude/settings.json', '{"key":"value"}');
        });

        it('creates all nested hidden parent directories on pull', async () => {
            const { manager, mockAdapter, mockGitService } = mocks;
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'def456', content: 'nested content' });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('.claude/memory/user.md');

            expect(mockAdapter.mkdir).toHaveBeenCalledWith('.claude');
            expect(mockAdapter.mkdir).toHaveBeenCalledWith('.claude/memory');
            expect(mockAdapter.write).toHaveBeenCalledWith('.claude/memory/user.md', 'nested content');
        });

        it('does not fail if hidden directory already exists (mkdir throws)', async () => {
            const { manager, mockAdapter, mockGitService } = mocks;
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'abc123', content: 'content' });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);
            vi.mocked(mockAdapter.mkdir).mockRejectedValue(new Error('already exists'));

            await expect(manager.pullFile('.claude/settings.json')).resolves.not.toThrow();
            expect(mockAdapter.write).toHaveBeenCalledWith('.claude/settings.json', 'content');
        });

        it('updates metadata after pulling hidden file', async () => {
            const { manager, mockAdapter, mockGitService, mockSettings } = mocks;
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'sha-hidden', content: 'file content' });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('.claude/CLAUDE.md');

            expect(mockSettings.syncMetadata['.claude/CLAUDE.md']).toMatchObject({
                lastSyncedSha: 'sha-hidden',
            });
        });
    });

    describe('pushFile with hidden paths', () => {
        it('pushes hidden file content via string path', async () => {
            const { manager, mockAdapter, mockGitService } = mocks;
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.read).mockResolvedValue('# Memory\n\nsome content');
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: '', content: '' });
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: '.claude/CLAUDE.md', sha: 'new-sha' });

            await manager.pushFile('.claude/CLAUDE.md');

            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                '.claude/CLAUDE.md', '# Memory\n\nsome content', 'main', expect.any(String), '', undefined
            );
        });

        it('skips push when hidden file is already in sync', async () => {
            const { manager, mockAdapter, mockGitService } = mocks;
            const content = 'same content';
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.read).mockResolvedValue(content);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'existing-sha', content });

            await manager.pushFile('.claude/settings.json');

            expect(mockGitService.pushFile).not.toHaveBeenCalled();
        });

        it('does not push when hidden file is missing from vault', async () => {
            const { manager, mockAdapter, mockGitService } = mocks;
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pushFile('.claude/missing.json');

            expect(mockGitService.pushFile).not.toHaveBeenCalled();
        });
    });
});
