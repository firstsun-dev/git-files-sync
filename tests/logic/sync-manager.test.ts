/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../../src/logic/sync-manager';

// Mock dependencies
import { App, TFile } from 'obsidian';
import { SyncConflictModal } from '../../src/ui/SyncConflictModal';

vi.mock('../../src/ui/SyncConflictModal');
import { GitLabService } from '../../src/services/gitlab-service';
import { GitLabFilesPushSettings } from '../../src/settings';

const mockApp = {
    vault: {
        read: vi.fn(),
        modify: vi.fn(),
        getFileByPath: vi.fn(),
    }
} as unknown as App;

const mockGitLab = {
    pushFile: vi.fn(),
    getFile: vi.fn(),
} as unknown as GitLabService;

const mockSettings: GitLabFilesPushSettings = {
    gitlabToken: 'token',
    gitlabBaseUrl: 'https://gitlab.com',
    projectId: '123',
    branch: 'main',
    rootPath: '',
    syncMetadata: {}
};

describe('SyncManager', () => {
    let manager: SyncManager;

    beforeEach(() => {
        vi.clearAllMocks();
        // Default: file exists in vault
        vi.spyOn(mockApp.vault, 'getFileByPath').mockReturnValue(new TFile());
        manager = new SyncManager(mockApp, mockGitLab, mockSettings);
    });

    it('should push file content correctly', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        const readSpy = vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        const getSpy = vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: '', sha: '' });
        const pushSpy = vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue('test.md');

        await manager.pushFile(mockFile);

        expect(readSpy).toHaveBeenCalledWith(mockFile);
        expect(getSpy).toHaveBeenCalled();
        expect(pushSpy).toHaveBeenCalledWith(
            'test.md',
            'local content',
            'main',
            expect.stringContaining('Update test.md')
        );
    });

    it('should detect conflict when remote SHA differs from last synced SHA', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });

        // Setup metadata with an old SHA
        mockSettings.syncMetadata['test.md'] = {
            lastSyncedSha: 'old-sha',
            lastSyncedAt: Date.now()
        };

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        // Mock GitLab returning a different remote SHA
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'remote content', sha: 'new-remote-sha' });

        const modalMock = vi.mocked(SyncConflictModal);

        await manager.pushFile(mockFile);

        expect(modalMock).toHaveBeenCalled();
    });

    it('should handle conflict by choosing local', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata['test.md'] = { lastSyncedSha: 'old', lastSyncedAt: 0 };

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValueOnce({ content: 'remote content', sha: 'remote-sha' });
        vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue('test.md');
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'local content', sha: 'new-sha' });

        const modalMock = vi.mocked(SyncConflictModal);

        // Capture the callback passed to the modal
        let callback: (choice: 'local' | 'remote') => void = () => {};
        modalMock.mockImplementation(function(app, file, local, remote, onChoose) {
            callback = onChoose;
            return {
                open: vi.fn(),
                close: vi.fn(),
                app,
                scope: {} as unknown,
                containerEl: {} as HTMLElement,
                contentEl: {} as HTMLElement,
                titleEl: {} as HTMLElement,
                onOpen: vi.fn(),
                onClose: vi.fn(),
                setTitle: vi.fn().mockReturnThis(),
            } as any;
        });

        await manager.pushFile(mockFile);

        // Simulate user choosing 'local'
        callback('local');

        // Wait for async operations in callback
        await new Promise(resolve => setTimeout(resolve, 0));

        const pushSpy = mockGitLab.pushFile as any;
        expect(pushSpy).toHaveBeenCalledWith('test.md', 'local content', 'main', expect.any(String));
        expect(mockSettings.syncMetadata['test.md']?.lastSyncedSha).toBe('new-sha');
    });

    it('should handle conflict by choosing remote', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata['test.md'] = { lastSyncedSha: 'old', lastSyncedAt: 0 };

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'remote content', sha: 'remote-sha' });
        const modifySpy = vi.spyOn(mockApp.vault, 'modify').mockResolvedValue();

        const modalMock = vi.mocked(SyncConflictModal);

        let callback: (choice: 'local' | 'remote') => void = () => {};
        modalMock.mockImplementation(function(app, file, local, remote, onChoose) {
            callback = onChoose;
            return {
                open: vi.fn(),
                close: vi.fn(),
                app,
                scope: {} as unknown,
                containerEl: {} as HTMLElement,
                contentEl: {} as HTMLElement,
                titleEl: {} as HTMLElement,
                onOpen: vi.fn(),
                onClose: vi.fn(),
                setTitle: vi.fn().mockReturnThis(),
            } as any;
        });

        await manager.pushFile(mockFile);

        // Simulate user choosing 'remote'
        callback('remote');

        // Wait for async operations in callback
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(modifySpy).toHaveBeenCalledWith(mockFile, 'remote content');
        expect(mockSettings.syncMetadata['test.md']?.lastSyncedSha).toBe('remote-sha');
    });

    it('should update metadata after successful push', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata = {};

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        // First call for conflict detection
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValueOnce({ content: '', sha: '' });
        vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue('test.md');

        // Second call for metadata update
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'local content', sha: 'new-sha' });

        await manager.pushFile(mockFile);

        expect(mockSettings.syncMetadata['test.md']).toBeDefined();
        expect(mockSettings.syncMetadata['test.md']?.lastSyncedSha).toBe('new-sha');
    });

    it('should pull and modify file content correctly and update metadata', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata = {};

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('old content');
        const modifySpy = vi.spyOn(mockApp.vault, 'modify').mockResolvedValue();
        const getSpy = vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'new content', sha: 'sha' });

        await manager.pullFile(mockFile);

        expect(modifySpy).toHaveBeenCalledWith(mockFile, 'new content');
        expect(getSpy).toHaveBeenCalled();
        expect(mockSettings.syncMetadata['test.md']?.lastSyncedSha).toBe('sha');
    });

    it('should handle file not existing in vault', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'non-existent.md', name: 'non-existent.md' });
        vi.spyOn(mockApp.vault, 'getFileByPath').mockReturnValue(null);

        await manager.pushFile(mockFile);

        expect(mockGitLab.getFile).not.toHaveBeenCalled();
        expect(mockGitLab.pushFile).not.toHaveBeenCalled();
    });

    it('should add new file to repo when it exists locally but not on remote', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'new.md', name: 'new.md' });
        mockSettings.syncMetadata = {};

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('new local content');
        // Remote returns 404/empty
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValueOnce({ content: '', sha: '' });
        vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue('new.md');
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'new local content', sha: 'new-sha' });

        await manager.pushFile(mockFile);

        expect(mockGitLab.pushFile).toHaveBeenCalledWith(
            'new.md',
            'new local content',
            'main',
            expect.stringContaining('Update new.md')
        );
        expect(mockSettings.syncMetadata['new.md']?.lastSyncedSha).toBe('new-sha');
    });
});
