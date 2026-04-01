/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../../src/logic/sync-manager';

// Mock dependencies
import { App, TFile, Notice } from 'obsidian';
import { GitLabService } from '../../src/services/gitlab-service';
import { GitLabFilesPushSettings } from '../../src/settings';

const mockApp = {
    vault: {
        read: vi.fn(),
        modify: vi.fn(),
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
    syncMetadata: {}
};

describe('SyncManager', () => {
    let manager: SyncManager;

    beforeEach(() => {
        vi.clearAllMocks();
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

        const noticeSpy = vi.mocked(Notice);

        await manager.pushFile(mockFile);

        expect(noticeSpy).toHaveBeenCalledWith(expect.stringContaining('Conflict detected'));
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
        expect(mockSettings.syncMetadata['test.md'].lastSyncedSha).toBe('new-sha');
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
        expect(mockSettings.syncMetadata['test.md'].lastSyncedSha).toBe('sha');
    });
});
