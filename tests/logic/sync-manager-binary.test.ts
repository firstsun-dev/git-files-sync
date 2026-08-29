/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() mocks intentionally reference methods unbound; safe under Vitest's mocking model */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSyncManagerMocks, makeBuf, SyncManagerMocks } from './sync-manager-test-helpers';
import { SyncPlanModal, SyncPlanDirection } from '../../src/ui/SyncPlanModal';
import { gitBlobSha } from '../../src/utils/git-blob-sha';

vi.mock('obsidian');
// Every push/pull now shows a plan for review before applying; auto-confirm
// it here since these tests exercise binary content handling, not the modal.
vi.mock('../../src/ui/SyncPlanModal');

describe('SyncManager – binary file handling', () => {
    let mocks: SyncManagerMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(SyncPlanModal).mockImplementation(function (
            this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, onConfirm: () => void
        ) {
            onConfirm();
            return this;
        });
        mocks = createSyncManagerMocks();
    });

    describe('pushFiles with binary path (string)', () => {
        it('reads via adapter.readBinary for binary extensions', async () => {
            const { manager, mockAdapter, mockGitService } = mocks;
            const buf = makeBuf([137, 80, 78, 71]);
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.readBinary).mockResolvedValue(buf);
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: 'photo.png', sha: 'new-sha' });

            await manager.pushFiles(['photo.png']);

            expect(mockAdapter.readBinary).toHaveBeenCalledWith('photo.png');
            expect(mockAdapter.read).not.toHaveBeenCalled();
            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                'photo.png', buf, 'main', expect.any(String), undefined, undefined
            );
        });

        it('skips push when binary content is already in sync', async () => {
            const { manager, mockAdapter, mockGitService } = mocks;
            const buf = makeBuf([1, 2, 3, 4]);
            const contentSha = await gitBlobSha(buf);
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.readBinary).mockResolvedValue(buf);
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([{ path: 'photo.png', sha: contentSha, symlink: false }]);

            await manager.pushFiles(['photo.png']);

            expect(mockGitService.pushFile).not.toHaveBeenCalled();
        });

        it('updates metadata when binary is already in sync', async () => {
            const { manager, mockAdapter, mockGitService, mockSettings } = mocks;
            const buf = makeBuf([1, 2, 3]);
            const contentSha = await gitBlobSha(buf);
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.readBinary).mockResolvedValue(buf);
            vi.mocked(mockGitService.listFilesDetailed).mockResolvedValue([{ path: 'photo.png', sha: contentSha, symlink: false }]);

            await manager.pushFiles(['photo.png']);

            expect(mockSettings.syncMetadata['photo.png']).toMatchObject({
                lastSyncedSha: contentSha,
            });
        });
    });

    describe('pullFile with binary content', () => {
        it('writes via adapter.writeBinary when remote content is ArrayBuffer', async () => {
            const { manager, mockAdapter, mockGitService } = mocks;
            const buf = makeBuf([137, 80, 78, 71]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'bin-sha', content: buf });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('photo.png');

            expect(mockAdapter.writeBinary).toHaveBeenCalledWith('photo.png', buf);
            expect(mockAdapter.write).not.toHaveBeenCalled();
        });

        it('creates parent directory before writing binary', async () => {
            const { manager, mockAdapter, mockGitService } = mocks;
            const buf = makeBuf([255, 216, 255]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'bin-sha', content: buf });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('attachments/photo.jpg');

            expect(mockAdapter.mkdir).toHaveBeenCalledWith('attachments');
            expect(mockAdapter.writeBinary).toHaveBeenCalledWith('attachments/photo.jpg', buf);
        });

        it('skips pull when binary content is already in sync', async () => {
            const { manager, mockAdapter, mockGitService, mockSettings } = mocks;
            const buf = makeBuf([1, 2, 3]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'bin-sha', content: buf });
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.readBinary).mockResolvedValue(buf);
            mockSettings.syncMetadata['photo.png'] = { lastSyncedSha: 'bin-sha', lastSyncedAt: 0, lastKnownPath: 'photo.png' };

            await manager.pullFile('photo.png');

            expect(mockAdapter.writeBinary).not.toHaveBeenCalled();
        });

        it('updates metadata after pulling binary file', async () => {
            const { manager, mockAdapter, mockGitService, mockSettings } = mocks;
            const buf = makeBuf([0, 1, 2]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'bin-sha', content: buf });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('photo.png');

            expect(mockSettings.syncMetadata['photo.png']).toMatchObject({
                lastSyncedSha: 'bin-sha',
            });
        });
    });
});

/* eslint-enable @typescript-eslint/unbound-method -- re-enable after the whole-file exemption above */
