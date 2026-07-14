/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../../src/logic/sync-manager';

// Mock dependencies
import { App, TFile } from 'obsidian';
import { SyncConflictModal } from '../../src/ui/SyncConflictModal';

vi.mock('../../src/ui/SyncConflictModal');
import { GitLabService } from '../../src/services/gitlab-service';
import { GitLabFilesPushSettings } from '../../src/settings';

vi.mock('obsidian', () => ({
    Notice: vi.fn(),
    TFile: class {
        path: string = '';
        name: string = '';
    },
    App: class {},
    Modal: class {
        open = vi.fn();
        close = vi.fn();
    }
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

const mockGitLab = {
    pushFile: vi.fn(),
    getFile: vi.fn(),
} as unknown as GitLabService;

const mockSettings: GitLabFilesPushSettings = {
    serviceType: 'gitlab',
    gitlabToken: 'token',
    gitlabBaseUrl: 'https://gitlab.com',
    projectId: '123',
    githubToken: '',
    githubOwner: '',
    githubRepo: '',
    giteaToken: '',
    giteaBaseUrl: '',
    giteaOwner: '',
    giteaRepo: '',
    branch: 'main',
    rootPath: '',
    syncMetadata: {},
    vaultFolder: '',
    symlinkHandling: 'real',
    ignorePatterns: '',
    lastSeenVersion: '',
    bannerDismissedVersion: '',
    language: 'system'
};

describe('SyncManager', () => {
    let manager: SyncManager;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings.syncMetadata = {};
        // Default: file exists in vault
        vi.spyOn(mockApp.vault, 'getFileByPath').mockReturnValue(new TFile());
        manager = new SyncManager(mockApp, mockGitLab, mockSettings);
    });

    it('should push file content correctly', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        const readSpy = vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        // Mock getFile to return different content to trigger a push
        const getSpy = vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'different content', sha: 'old-sha' });
        const pushSpy = vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'test.md', sha: 'new-sha' });

        await manager.pushFile(mockFile);

        expect(readSpy).toHaveBeenCalledWith(mockFile);
        expect(getSpy).toHaveBeenCalled();
        expect(pushSpy).toHaveBeenCalledWith(
            'test.md',
            'local content',
            'main',
            'Update test.md from Obsidian',
            'old-sha'
        );
    });

    it('falls back to the adapter when vault.read fails (e.g. symlinked file)', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'link.md', name: 'link.md' });
        const readSpy = vi.spyOn(mockApp.vault, 'read').mockRejectedValue(new Error('EINVAL: symlink'));
        const adapterReadSpy = vi.spyOn(mockApp.vault.adapter, 'read').mockResolvedValue('linked content');
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'different content', sha: 'old-sha' });
        const pushSpy = vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'link.md', sha: 'new-sha' });

        await manager.pushFile(mockFile);

        expect(readSpy).toHaveBeenCalledWith(mockFile);
        expect(adapterReadSpy).toHaveBeenCalledWith('link.md');
        expect(pushSpy).toHaveBeenCalledWith(
            'link.md',
            'linked content',
            'main',
            'Update link.md from Obsidian',
            'old-sha'
        );
    });

    it('does not overwrite a remote symlink on push (follow mode safety)', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'link.md', name: 'link.md' });
        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: '', sha: 'link-sha', isSymlink: true, symlinkTarget: '../x.md' });
        const pushSpy = vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'link.md', sha: 'new' });

        await manager.pushFile(mockFile);

        // The remote symlink must be left untouched.
        expect(pushSpy).not.toHaveBeenCalled();
    });

    it('should detect conflict when remote SHA differs from last synced SHA', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });

        // Setup metadata with an old SHA
        mockSettings.syncMetadata['test.md'] = {
            lastSyncedSha: 'old-sha',
            lastSyncedAt: Date.now()
        };

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        // Mock GitLab returning a different remote SHA and different content
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
        vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'test.md', sha: 'new-sha' });
        // No second getFile call needed if pushFile returns sha

        const modalMock = vi.mocked(SyncConflictModal);

        // Capture the callback passed to the modal
        let callback: (choice: 'local' | 'remote') => void = () => { };
        modalMock.mockImplementation(function (this: SyncConflictModal, app: App, fileName: string, local: string, remote: string, onChoose: (choice: 'local' | 'remote') => void) {
            callback = onChoose;
            (this as unknown as Record<string, unknown>).open = vi.fn();
            (this as unknown as Record<string, unknown>).close = vi.fn();
            (this as unknown as Record<string, unknown>).app = app;
            (this as unknown as Record<string, unknown>).setTitle = vi.fn().mockReturnThis();
        });

        await manager.pushFile(mockFile);

        // Simulate user choosing 'local'
        callback('local');

        // Wait for async operations in callback
        await new Promise(resolve => setTimeout(resolve, 50));

        const pushSpy = vi.spyOn(mockGitLab, 'pushFile');
        expect(pushSpy).toHaveBeenCalledWith('test.md', 'local content', 'main', 'Update test.md from Obsidian', 'remote-sha');
        expect(mockSettings.syncMetadata['test.md']?.lastSyncedSha).toBe('new-sha');
    });

    it('should handle conflict by choosing remote', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata['test.md'] = { lastSyncedSha: 'old', lastSyncedAt: 0 };

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'remote content', sha: 'remote-sha' });
        const modifySpy = vi.spyOn(mockApp.vault, 'modify').mockResolvedValue();

        const modalMock = vi.mocked(SyncConflictModal);

        let callback: (choice: 'local' | 'remote') => void = () => { };
        modalMock.mockImplementation(function (this: SyncConflictModal, app: App, fileName: string, local: string, remote: string, onChoose: (choice: 'local' | 'remote') => void) {
            callback = onChoose;
            (this as unknown as Record<string, unknown>).open = vi.fn();
            (this as unknown as Record<string, unknown>).close = vi.fn();
            (this as unknown as Record<string, unknown>).app = app;
            (this as unknown as Record<string, unknown>).setTitle = vi.fn().mockReturnThis();
        });

        await manager.pushFile(mockFile);

        // Simulate user choosing 'remote'
        callback('remote');

        // Wait for async operations in callback
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(modifySpy).toHaveBeenCalledWith(mockFile, 'remote content');
        expect(mockSettings.syncMetadata['test.md']?.lastSyncedSha).toBe('remote-sha');
    });

    it('should update metadata even when file is already in sync (contentsEqual)', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata = {};

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('same content');
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValueOnce({ content: 'same content', sha: 'remote-sha' });

        await manager.pushFile(mockFile);

        expect(mockGitLab.pushFile).not.toHaveBeenCalled();
        expect(mockSettings.syncMetadata['test.md']?.lastSyncedSha).toBe('remote-sha');
    });

    it('should update metadata after successful push', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata = {};

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        // Mock getFile to return different content to trigger push
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValueOnce({ content: 'diff', sha: 'old' });
        vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'test.md', sha: 'new-sha' });

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

        const getFileSpy = vi.spyOn(mockGitLab, 'getFile');
        const pushFileSpy = vi.spyOn(mockGitLab, 'pushFile');
        expect(getFileSpy).not.toHaveBeenCalled();
        expect(pushFileSpy).not.toHaveBeenCalled();
    });

    it('should add new file to repo when it exists locally but not on remote', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'new.md', name: 'new.md' });
        mockSettings.syncMetadata = {};

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('new local content');
        // Remote returns 404/empty
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValueOnce({ content: '', sha: '' });
        vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'new.md', sha: 'new-sha' });

        await manager.pushFile(mockFile);

        const pushFileSpy = vi.spyOn(mockGitLab, 'pushFile');
        expect(pushFileSpy).toHaveBeenCalledWith(
            'new.md',
            'new local content',
            'main',
            'Update new.md from Obsidian',
            ''
        );
        expect(mockSettings.syncMetadata['new.md']?.lastSyncedSha).toBe('new-sha');
    });

    describe('Renames and Moves', () => {
        it('should detect and handle file rename', async () => {
            const oldPath = 'old.md';
            const newPath = 'new.md';
            const mockFile = Object.assign(new TFile(), { path: newPath, name: 'new.md' });
            
            // Setup metadata for the old path
            mockSettings.syncMetadata[oldPath] = {
                lastSyncedSha: 'old-sha',
                lastSyncedAt: Date.now(),
                lastKnownPath: oldPath
            };

            // Mock: old file no longer exists in vault
            vi.spyOn(mockApp.vault, 'getFileByPath').mockImplementation((path) => {
                if (path === oldPath) return null;
                if (path === newPath) return mockFile;
                return null;
            });

            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('content');
            vi.spyOn(mockGitLab, 'getFile').mockImplementation(async (path) => {
                // Remote still has the old path with the same content: confirms a real rename.
                if (path === oldPath) return { content: 'content', sha: 'old-sha' };
                // New path does not exist on the remote yet.
                return { content: '', sha: '' };
            });
            vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: newPath, sha: 'new-sha' });

            await manager.pushFile(mockFile);

            expect(mockGitLab.pushFile).toHaveBeenCalledWith(
                newPath,
                'content',
                'main',
                `Rename ${oldPath} to ${newPath}`,
                ''
            );
            expect(mockSettings.syncMetadata[oldPath]).toBeUndefined();
            expect(mockSettings.syncMetadata[newPath]?.lastSyncedSha).toBe('new-sha');
        });

        it('should send the existing sha when the renamed-to path already exists remotely (avoids 422 "file already exists")', async () => {
            const oldPath = 'old.md';
            const newPath = 'new.md';
            const mockFile = Object.assign(new TFile(), { path: newPath, name: 'new.md' });

            mockSettings.syncMetadata[oldPath] = {
                lastSyncedSha: 'old-sha',
                lastSyncedAt: Date.now(),
                lastKnownPath: oldPath
            };

            vi.spyOn(mockApp.vault, 'getFileByPath').mockImplementation((path) => {
                if (path === oldPath) return null;
                if (path === newPath) return mockFile;
                return null;
            });

            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('content');
            vi.spyOn(mockGitLab, 'getFile').mockImplementation(async (path) => {
                // Remote still has the old path with matching content: confirms a real rename.
                if (path === oldPath) return { content: 'content', sha: 'old-sha' };
                // A file already exists on the remote at the new path (e.g. from a prior push).
                return { content: 'old remote content', sha: 'remote-existing-sha' };
            });
            vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: newPath, sha: 'new-sha' });

            await manager.pushFile(mockFile);

            expect(mockGitLab.pushFile).toHaveBeenCalledWith(
                newPath,
                'content',
                'main',
                `Rename ${oldPath} to ${newPath}`,
                'remote-existing-sha'
            );
            expect(mockSettings.syncMetadata[oldPath]).toBeUndefined();
            expect(mockSettings.syncMetadata[newPath]?.lastSyncedSha).toBe('new-sha');
        });

        it('does not misclassify an unrelated push as a rename just because an orphaned metadata entry exists', async () => {
            // Regression test: a local delete that never cleared its syncMetadata entry
            // used to make detectRename treat ANY later, unrelated push as "renamed from"
            // that orphaned path -- because it only checked "does the old path's file no
            // longer exist in the vault", without verifying the content actually matches.
            const orphanedPath = 'deleted-unrelated-note.md';
            const pushedPath = 'shinyi-muyu-tutorial.md';
            const mockFile = Object.assign(new TFile(), { path: pushedPath, name: 'shinyi-muyu-tutorial.md' });

            mockSettings.syncMetadata[orphanedPath] = {
                lastSyncedSha: 'orphaned-sha',
                lastSyncedAt: Date.now(),
                lastKnownPath: orphanedPath
            };

            // The orphaned file is gone from the vault (it was deleted, not renamed).
            vi.spyOn(mockApp.vault, 'getFileByPath').mockImplementation((path) => {
                if (path === orphanedPath) return null;
                if (path === pushedPath) return mockFile;
                return null;
            });

            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('unrelated content');
            vi.spyOn(mockGitLab, 'getFile').mockImplementation(async (path) => {
                // The orphaned path's remote content is unrelated to what's being pushed now.
                if (path === orphanedPath) return { content: 'totally different content', sha: 'orphaned-sha' };
                // Normal push target: already exists remotely with older content.
                return { content: 'old content', sha: 'remote-sha' };
            });
            vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: pushedPath, sha: 'new-sha' });

            await manager.pushFile(mockFile);

            // Must be treated as a normal update, not a rename from the orphaned path.
            expect(mockGitLab.pushFile).toHaveBeenCalledWith(
                pushedPath,
                'unrelated content',
                'main',
                `Update ${mockFile.name} from Obsidian`,
                'remote-sha'
            );
            // The orphaned entry must be left alone -- it wasn't the source of this push.
            expect(mockSettings.syncMetadata[orphanedPath]).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        it('should handle push errors gracefully', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'fail.md', name: 'fail.md' });
            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('content');
            vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: '', sha: '' });
            vi.spyOn(mockGitLab, 'pushFile').mockRejectedValue(new Error('Network error'));

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            
            await manager.pushFile(mockFile);

            expect(consoleSpy).toHaveBeenCalled();
        });

        it('should handle rename errors gracefully', async () => {
            const oldPath = 'old.md';
            const newPath = 'new.md';
            const mockFile = Object.assign(new TFile(), { path: newPath, name: 'new.md' });
            mockSettings.syncMetadata[oldPath] = { lastSyncedSha: 's', lastSyncedAt: 0, lastKnownPath: oldPath };
            
            vi.spyOn(mockApp.vault, 'getFileByPath').mockImplementation(p => p === oldPath ? null : mockFile);
            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('c');
            vi.spyOn(mockGitLab, 'getFile').mockImplementation(async (path) => {
                // Remote still has the old path with matching content: confirms a real rename.
                if (path === oldPath) return { content: 'c', sha: 's' };
                return { content: '', sha: '' };
            });
            vi.spyOn(mockGitLab, 'pushFile').mockRejectedValue(new Error('Rename failed'));

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            await manager.pushFile(mockFile);
            expect(consoleSpy).toHaveBeenCalled();
            // Verify metadata wasn't updated
            expect(mockSettings.syncMetadata[oldPath]).toBeDefined();
            expect(mockSettings.syncMetadata[newPath]).toBeUndefined();
        });
    });

    describe('pullFile', () => {
        it('should handle file not existing in remote', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'remote-missing.md', name: 'remote-missing.md' });
            vi.mocked(mockGitLab.getFile).mockResolvedValue({ content: '', sha: '' });
            
            await manager.pullFile(mockFile);
            expect(mockApp.vault.modify).not.toHaveBeenCalled();
        });

        it('should pull a new file that does not exist locally', async () => {
            const path = 'new-remote-file.md';
            vi.mocked(mockGitLab.getFile).mockResolvedValue({ content: 'remote content', sha: 'new-sha' });
            vi.spyOn(mockApp.vault, 'getFileByPath').mockReturnValue(null);
            
            const writeSpy = vi.spyOn(mockApp.vault.adapter, 'write').mockResolvedValue(undefined);
            vi.spyOn(mockApp.vault.adapter, 'exists').mockResolvedValue(false);

            // Mock ensureParentDirs by mocking getAbstractFileByPath to return folder for parent
            vi.spyOn(mockApp.vault, 'getAbstractFileByPath').mockReturnValue(new TFile());

            await manager.pullFile(path);

            expect(writeSpy).toHaveBeenCalledWith(path, 'remote content');
            expect(mockSettings.syncMetadata[path]?.lastSyncedSha).toBe('new-sha');
        });

        it('should handle pull errors gracefully', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'fail.md', name: 'fail.md' });
            vi.mocked(mockGitLab.getFile).mockRejectedValue(new Error('Network error'));
            
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            await manager.pullFile(mockFile);
            expect(consoleSpy).toHaveBeenCalled();
        });
    });
});
