/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { SyncManager } from '../../src/logic/sync-manager';
import { App, DataAdapter } from 'obsidian';
import { GitLabFilesPushSettings } from '../../src/settings';
import { GitServiceInterface } from '../../src/services/git-service-interface';

vi.mock('obsidian');

describe('SyncManager – binary file handling', () => {
    let manager: SyncManager;
    let mockApp: Mocked<App>;
    let mockGitService: Mocked<GitServiceInterface>;
    let mockAdapter: Mocked<DataAdapter>;
    let mockSettings: GitLabFilesPushSettings;

    const makeBuf = (bytes: number[]) => new Uint8Array(bytes).buffer;

    beforeEach(() => {
        vi.clearAllMocks();

        mockAdapter = {
            exists: vi.fn(),
            read: vi.fn(),
            write: vi.fn(),
            readBinary: vi.fn(),
            writeBinary: vi.fn(),
            mkdir: vi.fn().mockResolvedValue(undefined),
        } as unknown as Mocked<DataAdapter>;

        mockApp = {
            vault: {
                read: vi.fn(),
                readBinary: vi.fn(),
                modify: vi.fn(),
                modifyBinary: vi.fn(),
                getFileByPath: vi.fn().mockReturnValue(null),
                adapter: mockAdapter,
            },
        } as unknown as Mocked<App>;

        mockGitService = {
            pushFile: vi.fn(),
            getFile: vi.fn(),
            testConnection: vi.fn(),
            listFiles: vi.fn(),
            deleteFile: vi.fn(),
            getRepoGitignores: vi.fn(),
            updateConfig: vi.fn(),
        } as unknown as Mocked<GitServiceInterface>;

        mockSettings = {
            serviceType: 'github',
            githubToken: 'token',
            githubOwner: 'owner',
            githubRepo: 'repo',
            branch: 'main',
            syncMetadata: {},
            vaultFolder: '',
            rootPath: '',
        } as unknown as GitLabFilesPushSettings;

        manager = new SyncManager(mockApp, mockGitService, mockSettings);
        // @ts-ignore
        manager.saveSettings = vi.fn().mockResolvedValue(undefined);
    });

    describe('pushFile with binary path (string)', () => {
        it('reads via adapter.readBinary for binary extensions', async () => {
            const buf = makeBuf([137, 80, 78, 71]);
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.readBinary).mockResolvedValue(buf);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: '', content: '' });
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: 'photo.png', sha: 'new-sha' });

            await manager.pushFile('photo.png');

            expect(mockAdapter.readBinary).toHaveBeenCalledWith('photo.png');
            expect(mockAdapter.read).not.toHaveBeenCalled();
            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                'photo.png', buf, 'main', expect.any(String), ''
            );
        });

        it('skips push when binary content is already in sync', async () => {
            const buf = makeBuf([1, 2, 3, 4]);
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.readBinary).mockResolvedValue(buf);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'existing-sha', content: buf });

            await manager.pushFile('photo.png');

            expect(mockGitService.pushFile).not.toHaveBeenCalled();
        });

        it('updates metadata when binary is already in sync', async () => {
            const buf = makeBuf([1, 2, 3]);
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.readBinary).mockResolvedValue(buf);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'existing-sha', content: buf });

            await manager.pushFile('photo.png');

            expect(mockSettings.syncMetadata['photo.png']).toMatchObject({
                lastSyncedSha: 'existing-sha',
            });
        });
    });

    describe('pullFile with binary content', () => {
        it('writes via adapter.writeBinary when remote content is ArrayBuffer', async () => {
            const buf = makeBuf([137, 80, 78, 71]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'bin-sha', content: buf });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('photo.png');

            expect(mockAdapter.writeBinary).toHaveBeenCalledWith('photo.png', buf);
            expect(mockAdapter.write).not.toHaveBeenCalled();
        });

        it('creates parent directory before writing binary', async () => {
            const buf = makeBuf([255, 216, 255]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'bin-sha', content: buf });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('attachments/photo.jpg');

            expect(mockAdapter.mkdir).toHaveBeenCalledWith('attachments');
            expect(mockAdapter.writeBinary).toHaveBeenCalledWith('attachments/photo.jpg', buf);
        });

        it('skips pull when binary content is already in sync', async () => {
            const buf = makeBuf([1, 2, 3]);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'bin-sha', content: buf });
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.readBinary).mockResolvedValue(buf);
            mockSettings.syncMetadata['photo.png'] = { lastSyncedSha: 'bin-sha', lastSyncedAt: 0, lastKnownPath: 'photo.png' };

            await manager.pullFile('photo.png');

            expect(mockAdapter.writeBinary).not.toHaveBeenCalled();
        });

        it('updates metadata after pulling binary file', async () => {
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
