/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { SyncManager } from '../../src/logic/sync-manager';
import { App, DataAdapter } from 'obsidian';
import { GitLabFilesPushSettings } from '../../src/settings';
import { GitServiceInterface } from '../../src/services/git-service-interface';

vi.mock('obsidian');

describe('SyncManager – hidden file support', () => {
    let manager: SyncManager;
    let mockApp: Mocked<App>;
    let mockGitService: Mocked<GitServiceInterface>;
    let mockAdapter: Mocked<DataAdapter>;
    let mockSettings: GitLabFilesPushSettings;

    beforeEach(() => {
        vi.clearAllMocks();

        mockAdapter = {
            exists: vi.fn(),
            read: vi.fn(),
            write: vi.fn(),
            writeBinary: vi.fn(),
            mkdir: vi.fn().mockResolvedValue(undefined),
        } as unknown as Mocked<DataAdapter>;

        mockApp = {
            vault: {
                read: vi.fn(),
                modify: vi.fn(),
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
        // @ts-ignore - accessing private for test
        manager.saveSettings = vi.fn().mockResolvedValue(undefined);
    });

    describe('pullFile with hidden paths', () => {
        it('creates single hidden parent directory on pull', async () => {
            vi.mocked(mockGitService.getFile).mockResolvedValue({
                sha: 'abc123',
                content: '{"key":"value"}',
            });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('.claude/settings.json');

            expect(mockAdapter.mkdir).toHaveBeenCalledWith('.claude');
            expect(mockAdapter.write).toHaveBeenCalledWith('.claude/settings.json', '{"key":"value"}');
        });

        it('creates all nested hidden parent directories on pull', async () => {
            vi.mocked(mockGitService.getFile).mockResolvedValue({
                sha: 'def456',
                content: 'nested content',
            });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('.claude/memory/user.md');

            expect(mockAdapter.mkdir).toHaveBeenCalledWith('.claude');
            expect(mockAdapter.mkdir).toHaveBeenCalledWith('.claude/memory');
            expect(mockAdapter.write).toHaveBeenCalledWith('.claude/memory/user.md', 'nested content');
        });

        it('does not fail if hidden directory already exists (mkdir throws)', async () => {
            vi.mocked(mockGitService.getFile).mockResolvedValue({
                sha: 'abc123',
                content: 'content',
            });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);
            vi.mocked(mockAdapter.mkdir).mockRejectedValue(new Error('already exists'));

            await expect(manager.pullFile('.claude/settings.json')).resolves.not.toThrow();
            expect(mockAdapter.write).toHaveBeenCalledWith('.claude/settings.json', 'content');
        });

        it('updates metadata after pulling hidden file', async () => {
            vi.mocked(mockGitService.getFile).mockResolvedValue({
                sha: 'sha-hidden',
                content: 'file content',
            });
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pullFile('.claude/CLAUDE.md');

            expect(mockSettings.syncMetadata['.claude/CLAUDE.md']).toMatchObject({
                lastSyncedSha: 'sha-hidden',
            });
        });
    });

    describe('pushFile with hidden paths', () => {
        it('pushes hidden file content via string path', async () => {
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.read).mockResolvedValue('# Memory\n\nsome content');
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: '', content: '' });
            vi.mocked(mockGitService.pushFile).mockResolvedValue({ path: '.claude/CLAUDE.md', sha: 'new-sha' });

            await manager.pushFile('.claude/CLAUDE.md');

            expect(mockGitService.pushFile).toHaveBeenCalledWith(
                '.claude/CLAUDE.md',
                '# Memory\n\nsome content',
                'main',
                expect.any(String),
                ''
            );
        });

        it('skips push when hidden file is already in sync', async () => {
            const content = 'same content';
            vi.mocked(mockAdapter.exists).mockResolvedValue(true);
            vi.mocked(mockAdapter.read).mockResolvedValue(content);
            vi.mocked(mockGitService.getFile).mockResolvedValue({ sha: 'existing-sha', content });

            await manager.pushFile('.claude/settings.json');

            expect(mockGitService.pushFile).not.toHaveBeenCalled();
        });

        it('does not exist notice when hidden file is missing', async () => {
            vi.mocked(mockAdapter.exists).mockResolvedValue(false);

            await manager.pushFile('.claude/missing.json');

            expect(mockGitService.pushFile).not.toHaveBeenCalled();
        });
    });
});
