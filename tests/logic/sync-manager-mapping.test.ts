import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../../src/logic/sync-manager';

import { App, TFile } from 'obsidian';
import type { GitServiceInterface } from '../../src/services/git-service-interface';
import type { GitLabFilesPushSettings } from '../../src/settings';

vi.mock('obsidian', () => ({
    Notice: vi.fn(),
    TFile: class {
        path: string = '';
        name: string = '';
    },
    App: class {},
}));

const mockApp = {
    vault: {
        read: vi.fn(),
        modify: vi.fn(),
        getFileByPath: vi.fn(),
        getAbstractFileByPath: vi.fn(),
        createFolder: vi.fn(),
        adapter: {
            exists: vi.fn(),
            read: vi.fn(),
            write: vi.fn(),
        }
    }
} as unknown as App;

const mockGetFile = vi.fn();
const mockPushFile = vi.fn();
const mockGitService = {
    getFile: mockGetFile,
    pushFile: mockPushFile,
} as unknown as GitServiceInterface;

const mockSettings: GitLabFilesPushSettings = {
    serviceType: 'gitlab',
    gitlabToken: '',
    gitlabBaseUrl: 'https://gitlab.com',
    projectId: '',
    githubToken: '',
    githubOwner: '',
    githubRepo: '',
    branch: 'main',
    rootPath: 'notes',
    vaultFolder: 'Work',
    syncMetadata: {},
};

describe('SyncManager Mapping', () => {
    let manager: SyncManager;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings.syncMetadata = {};
        manager = new SyncManager(mockApp, mockGitService, mockSettings);
    });

    it('should strip vaultFolder when pushing', async () => {
        const vaultPath = 'Work/test.md';
        const mockFile = Object.assign(new TFile(), { path: vaultPath, name: 'test.md' });

        const getFileByPathSpy = vi.spyOn(mockApp.vault, 'getFileByPath');
        const readSpy = vi.spyOn(mockApp.vault, 'read');
        getFileByPathSpy.mockReturnValue(mockFile);
        readSpy.mockResolvedValue('content');

        vi.mocked(mockGetFile).mockResolvedValue({ content: '', sha: '' });
        vi.mocked(mockPushFile).mockResolvedValue({ path: 'notes/test.md' });

        await manager.pushFile(mockFile);

        expect(mockGetFile).toHaveBeenCalledWith('test.md', 'main');
        expect(mockPushFile).toHaveBeenCalledWith(
            'test.md',
            'content',
            'main',
            'Update test.md from Obsidian',
            ''
        );
    });

    it('should map back to vaultFolder when pulling', async () => {
        const vaultPath = 'Work/remote.md';
        vi.mocked(mockGetFile).mockResolvedValue({ content: 'remote content', sha: 'sha' });
        const existsSpy = vi.spyOn(mockApp.vault.adapter, 'exists');
        const writeSpy = vi.spyOn(mockApp.vault.adapter, 'write');
        existsSpy.mockResolvedValue(false);
        writeSpy.mockResolvedValue(undefined);

        await manager.pullFile(vaultPath);

        expect(mockGetFile).toHaveBeenCalledWith('remote.md', 'main');
        expect(writeSpy).toHaveBeenCalledWith(vaultPath, 'remote content');
    });

    it('should handle root-level files correctly when no vaultFolder', async () => {
        mockSettings.vaultFolder = '';
        manager = new SyncManager(mockApp, mockGitService, mockSettings);

        const path = 'root.md';
        const mockFile = Object.assign(new TFile(), { path, name: 'root.md' });

        const getFileByPathSpy = vi.spyOn(mockApp.vault, 'getFileByPath');
        const readSpy = vi.spyOn(mockApp.vault, 'read');
        getFileByPathSpy.mockReturnValue(mockFile);
        readSpy.mockResolvedValue('content');

        vi.mocked(mockGetFile).mockResolvedValue({ content: '', sha: '' });

        await manager.pushFile(mockFile);

        expect(mockGetFile).toHaveBeenCalledWith('root.md', 'main');
    });
});
