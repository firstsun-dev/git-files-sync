/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() mocks intentionally reference methods unbound; safe under Vitest's mocking model */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager, BatchPushConflict, ConflictResolution } from '../../src/logic/sync-manager';

// Mock dependencies
import { App, TFile } from 'obsidian';
import { SyncPlanModal, SyncPlanDirection } from '../../src/ui/SyncPlanModal';
import { BatchConflictResolutionModal } from '../../src/ui/BatchConflictResolutionModal';
import { SyncConflictModal } from '../../src/ui/SyncConflictModal';
import { gitBlobSha } from '../../src/utils/git-blob-sha';
import { ObsidianSyncInteraction } from '../../src/ui/ObsidianSyncInteraction';

vi.mock('../../src/ui/SyncConflictModal');
// Every push/pull now shows a plan for review before applying. These tests
// exercise push/pull mechanics assuming the user confirms, so the plan modal
// is auto-confirmed by default; conflict-specific tests never reach it.
vi.mock('../../src/ui/SyncPlanModal');
vi.mock('../../src/ui/BatchConflictResolutionModal');
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
    getBlob: vi.fn(),
    listFilesDetailed: vi.fn().mockResolvedValue([]),
    deleteFile: vi.fn(),
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
    language: 'system',
    autoRefreshOnStartup: true
};

describe('SyncManager', () => {
    let manager: SyncManager;
    /** How the mocked BatchConflictResolutionModal resolves each conflict by default; override per-test. */
    let conflictResolver: (conflict: BatchPushConflict) => ConflictResolution;

    beforeEach(() => {
        vi.clearAllMocks();
        conflictResolver = () => 'skip';
        vi.mocked(SyncPlanModal).mockImplementation(function (
            this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, onConfirm: () => void
        ) {
            onConfirm();
            return this;
        } as never);
        vi.mocked(BatchConflictResolutionModal).mockImplementation(function (
            this: BatchConflictResolutionModal,
            _app: unknown,
            _gitService: unknown,
            conflicts: BatchPushConflict[],
            _totalFiles: number,
            _safeCount: number,
            onResolve: () => void,
            _onCancel: () => void,
        ) {
            for (const conflict of conflicts) conflict.resolution = conflictResolver(conflict);
            onResolve();
            return this;
        } as never);
        mockSettings.syncMetadata = {};
        // Default: file exists in vault
        vi.spyOn(mockApp.vault, 'getFileByPath').mockReturnValue(new TFile());
        manager = new SyncManager(mockApp, mockGitLab, mockSettings, undefined, undefined, undefined, new ObsidianSyncInteraction(mockApp));
    });

    it('publishes a confirmed synced status whenever it records sync metadata', async () => {
        manager.status.set({ path: 'note.md', status: 'modified', remoteSha: 'old-sha' });

        await manager.updateMetadata('note.md', 'new-sha');

        expect(manager.status.get('note.md')).toMatchObject({ status: 'synced', remoteSha: 'new-sha' });
    });

    it('does not read or push a file excluded by the configured ignore predicate', async () => {
        const ignoredManager = new SyncManager(
            mockApp,
            mockGitLab,
            mockSettings,
            undefined,
            (path) => path === 'private.md',
            undefined,
            new ObsidianSyncInteraction(mockApp),
        );
        const file = Object.assign(new TFile(), { path: 'private.md', name: 'private.md' });
        const readSpy = vi.spyOn(mockApp.vault, 'read').mockResolvedValue('secret');
        const remoteSpy = vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: '', sha: '' });

        await ignoredManager.pushFiles([file]);

        expect(readSpy).not.toHaveBeenCalled();
        expect(remoteSpy).not.toHaveBeenCalled();
        expect(mockGitLab.pushFile).not.toHaveBeenCalled();
    });

    it('should push file content correctly', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        const readSpy = vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: 'test.md', sha: 'old-sha', symlink: false }]);
        // GitLab-only: classification re-reads the tree entry's revision via getFile.
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'different content', sha: 'old-sha' });
        const pushSpy = vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'test.md', sha: 'new-sha' });

        await manager.pushFiles([mockFile]);

        expect(readSpy).toHaveBeenCalledWith(mockFile);
        expect(pushSpy).toHaveBeenCalledWith(
            'test.md',
            'local content',
            'main',
            'Update test.md from Obsidian',
            'old-sha',
            undefined
        );
    });

    it('falls back to the adapter when vault.read fails (e.g. symlinked file)', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'link.md', name: 'link.md' });
        const readSpy = vi.spyOn(mockApp.vault, 'read').mockRejectedValue(new Error('EINVAL: symlink'));
        const adapterReadSpy = vi.spyOn(mockApp.vault.adapter, 'read').mockResolvedValue('linked content');
        vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: 'link.md', sha: 'old-sha', symlink: false }]);
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'different content', sha: 'old-sha' });
        const pushSpy = vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'link.md', sha: 'new-sha' });

        await manager.pushFiles([mockFile]);

        expect(readSpy).toHaveBeenCalledWith(mockFile);
        expect(adapterReadSpy).toHaveBeenCalledWith('link.md');
        expect(pushSpy).toHaveBeenCalledWith(
            'link.md',
            'linked content',
            'main',
            'Update link.md from Obsidian',
            'old-sha',
            undefined
        );
    });

    it('does not overwrite a remote symlink on push (follow mode safety)', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'link.md', name: 'link.md' });
        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: 'link.md', sha: 'link-sha', symlink: true }]);
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: '', sha: 'link-sha', isSymlink: true, symlinkTarget: '../x.md' });
        const pushSpy = vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'link.md', sha: 'new' });

        await manager.pushFiles([mockFile]);

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
        vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: 'test.md', sha: 'new-remote-sha', symlink: false }]);

        const modalMock = vi.mocked(BatchConflictResolutionModal);

        await manager.pushFiles([mockFile]);

        expect(modalMock).toHaveBeenCalled();
    });

    it('should handle conflict by choosing local', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata['test.md'] = { lastSyncedSha: 'old', lastSyncedAt: 0 };

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'remote content', sha: 'remote-sha' });
        vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: 'test.md', sha: 'remote-sha', symlink: false }]);
        vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'test.md', sha: 'new-sha' });
        conflictResolver = () => 'keep-local';

        await manager.pushFiles([mockFile]);

        const pushSpy = vi.spyOn(mockGitLab, 'pushFile');
        expect(pushSpy).toHaveBeenCalledWith('test.md', 'local content', 'main', 'Update test.md from Obsidian', 'remote-sha', undefined);
        expect(mockSettings.syncMetadata['test.md']?.lastSyncedSha).toBe('new-sha');
    });

    it('should handle conflict by choosing remote', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata['test.md'] = { lastSyncedSha: 'old', lastSyncedAt: 0 };

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'remote content', sha: 'remote-sha' });
        vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: 'test.md', sha: 'remote-sha', symlink: false }]);
        vi.spyOn(mockGitLab, 'getBlob').mockResolvedValue({ content: 'remote content', sha: 'remote-sha' });
        // The batch conflict pipeline applies "keep remote" by path (via the
        // adapter), not through the original TFile reference.
        const writeSpy = vi.spyOn(mockApp.vault.adapter, 'write').mockResolvedValue(undefined);
        conflictResolver = () => 'keep-remote';

        await manager.pushFiles([mockFile]);

        expect(writeSpy).toHaveBeenCalledWith('test.md', 'remote content');
        expect(mockSettings.syncMetadata['test.md']?.lastSyncedSha).toBe('remote-sha');
    });

    it('should update metadata even when file is already in sync (contentsEqual)', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata = {};

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('same content');
        const contentSha = await gitBlobSha('same content');
        vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: 'test.md', sha: contentSha, symlink: false }]);
        // GitLab-only: classification re-reads the tree entry's revision via getFile.
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'same content', sha: contentSha });

        await manager.pushFiles([mockFile]);

        expect(mockGitLab.pushFile).not.toHaveBeenCalled();
        expect(mockSettings.syncMetadata['test.md']?.lastSyncedSha).toBe(contentSha);
    });

    it('should update metadata after successful push', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
        mockSettings.syncMetadata = {};

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
        // Mock getFile to return different content to trigger push
        vi.spyOn(mockGitLab, 'getFile').mockResolvedValueOnce({ content: 'diff', sha: 'old' });
        vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'test.md', sha: 'new-sha' });

        await manager.pushFiles([mockFile]);

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

        await manager.pushFiles([mockFile]);

        const getFileSpy = vi.spyOn(mockGitLab, 'getFile');
        const pushFileSpy = vi.spyOn(mockGitLab, 'pushFile');
        expect(getFileSpy).not.toHaveBeenCalled();
        expect(pushFileSpy).not.toHaveBeenCalled();
    });

    it('should add new file to repo when it exists locally but not on remote', async () => {
        const mockFile = Object.assign(new TFile(), { path: 'new.md', name: 'new.md' });
        mockSettings.syncMetadata = {};

        vi.spyOn(mockApp.vault, 'read').mockResolvedValue('new local content');
        // Remote tree has no entry for this path: it's new.
        vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([]);
        vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'new.md', sha: 'new-sha' });

        await manager.pushFiles([mockFile]);

        const pushFileSpy = vi.spyOn(mockGitLab, 'pushFile');
        expect(pushFileSpy).toHaveBeenCalledWith(
            'new.md',
            'new local content',
            'main',
            'Update new.md from Obsidian',
            undefined,
            undefined
        );
        expect(mockSettings.syncMetadata['new.md']?.lastSyncedSha).toBe('new-sha');
    });

    describe('Renames and Moves', () => {
        it('detects and handles a file rename from legacy metadata without lastKnownPath', async () => {
            const oldPath = 'old.md';
            const newPath = 'new.md';
            const mockFile = Object.assign(new TFile(), { path: newPath, name: 'new.md' });
            
            // Setup metadata for the old path
            mockSettings.syncMetadata[oldPath] = {
                lastSyncedSha: 'old-sha',
                lastSyncedAt: Date.now(),
            };

            // Mock: old file no longer exists in vault
            vi.spyOn(mockApp.vault, 'getFileByPath').mockImplementation((path) => {
                if (path === oldPath) return null;
                if (path === newPath) return mockFile;
                return null;
            });

            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('content');
            const contentSha = await gitBlobSha('content');
            vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: oldPath, sha: contentSha, symlink: false }]);
            vi.spyOn(mockGitLab, 'getFile').mockImplementation(async (path) => {
                // Remote still has the old path with the same content: confirms a real rename.
                if (path === oldPath) return { content: 'content', sha: 'old-sha' };
                // New path does not exist on the remote yet.
                return { content: '', sha: '' };
            });
            vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: newPath, sha: 'new-sha' });

            await manager.pushFiles([mockFile]);

            // A real move: the new path is added and the old path is removed
            // (mockGitLab has no commitBatch, so this is the sequential
            // push-then-delete fallback).
            expect(mockGitLab.pushFile).toHaveBeenCalledWith(
                newPath,
                'content',
                'main',
                `Move ${oldPath} to ${newPath}`
            );
            expect(mockGitLab.deleteFile).toHaveBeenCalledWith(
                oldPath, 'main', `Remove ${oldPath} (moved to ${newPath})`
            );
            expect(mockSettings.syncMetadata[oldPath]).toBeUndefined();
            expect(mockSettings.syncMetadata[newPath]?.lastSyncedSha).toBe('new-sha');
        });

        it('never silently overwrites when the renamed-to path already exists remotely — leaves the pending move for manual resolution', async () => {
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
            const contentSha = await gitBlobSha('content');
            // A different file already exists on the remote at the new path.
            vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([
                { path: oldPath, sha: contentSha, symlink: false },
                { path: newPath, sha: 'remote-existing-sha', symlink: false },
            ]);
            vi.spyOn(mockGitLab, 'getFile').mockImplementation(async (path) => {
                // Remote still has the old path with matching content: confirms a real rename.
                if (path === oldPath) return { content: 'content', sha: 'old-sha' };
                // A different file already exists on the remote at the new path.
                return { content: 'old remote content', sha: 'remote-existing-sha' };
            });

            await manager.pushFiles([mockFile]);

            // Never a silent overwrite: nothing is pushed or deleted, and the
            // pending move is left in place so the user can resolve it.
            expect(mockGitLab.pushFile).not.toHaveBeenCalled();
            expect(mockGitLab.deleteFile).not.toHaveBeenCalled();
            expect(mockSettings.syncMetadata[oldPath]?.lastSyncedSha).toBe('old-sha');
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
            // Normal push target: already exists remotely with older content. The
            // orphaned path is deliberately absent from the tree -- it's not the
            // source of this push.
            vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: pushedPath, sha: 'remote-sha', symlink: false }]);
            vi.spyOn(mockGitLab, 'getFile').mockImplementation(async (path) => {
                // The orphaned path's remote content is unrelated to what's being pushed now.
                if (path === orphanedPath) return { content: 'totally different content', sha: 'orphaned-sha' };
                // Normal push target: already exists remotely with older content.
                return { content: 'old content', sha: 'remote-sha' };
            });
            vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: pushedPath, sha: 'new-sha' });

            await manager.pushFiles([mockFile]);

            // Must be treated as a normal update, not a rename from the orphaned path.
            expect(mockGitLab.pushFile).toHaveBeenCalledWith(
                pushedPath,
                'unrelated content',
                'main',
                `Update ${mockFile.name} from Obsidian`,
                'remote-sha',
                undefined
            );
            // The orphaned entry must be left alone -- it wasn't the source of this push.
            expect(mockSettings.syncMetadata[orphanedPath]).toBeDefined();
        });

        it('does not fire one remote getFile request per orphaned metadata entry on a single-file push', async () => {
            // Regression test: an interactive single-file push (ribbon/command/context-menu/
            // sync-view row) calls detectRename without a prefetched tree, so it used to check
            // every orphaned syncMetadata entry with its own live getFile() call in a sequential
            // loop -- each one a network round trip -- before the actual push even started.
            // With several stale entries (e.g. files deleted outside Obsidian's vault events)
            // this adds up to a long, silent delay with no "in progress" feedback.
            const pushedPath = 'note.md';
            const mockFile = Object.assign(new TFile(), { path: pushedPath, name: 'note.md' });

            for (let i = 0; i < 5; i++) {
                const orphanedPath = `orphan-${i}.md`;
                mockSettings.syncMetadata[orphanedPath] = {
                    lastSyncedSha: `orphan-sha-${i}`,
                    lastSyncedAt: Date.now(),
                    lastKnownPath: orphanedPath
                };
            }

            vi.spyOn(mockApp.vault, 'getFileByPath').mockImplementation((path) => {
                if (path === pushedPath) return mockFile;
                return null; // every orphaned path is gone from the vault
            });
            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('new content');
            vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: pushedPath, sha: 'remote-sha', symlink: false }]);
            vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'old content', sha: 'remote-sha' });
            vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: pushedPath, sha: 'new-sha' });

            await manager.pushFiles([mockFile]);

            // Exactly one getFile call: GitLab's revision refresh for the file actually
            // being pushed. The 5 orphaned candidates must be resolved via a single
            // prefetched tree (listFilesDetailed), not 5 separate live getFile lookups.
            expect(mockGitLab.getFile).toHaveBeenCalledTimes(1);
        });

        it('regression: an Individual Push resolved as a path string (no live TFile) must still classify a tracked rename as a move, not an addition', async () => {
            // Regression test for the reported bug: SyncStatusView's per-row push
            // button calls `pushFiles([fileStatus.file || fileStatus.path])` -- a raw
            // path string whenever no live TFile is attached to that row's status
            // entry yet (e.g. right after a rename, before the panel's next refresh
            // re-resolves it). "Selected x1 Push" resolves the exact same `pushFiles`
            // pipeline, normally with a live TFile -- there is now only one function,
            // so "Individual Push" and "Selected x1 Push" can no longer structurally
            // diverge. A string input must still classify a tracked rename as a move.
            const oldPath = 'old.md';
            const newPath = 'new.md';

            mockSettings.syncMetadata[oldPath] = {
                lastSyncedSha: 'old-sha',
                lastSyncedAt: Date.now(),
                lastKnownPath: oldPath,
            };
            await manager.trackRename(newPath, oldPath);

            vi.spyOn(mockApp.vault.adapter, 'exists').mockResolvedValue(true);
            vi.spyOn(mockApp.vault.adapter, 'read').mockResolvedValue('content');
            vi.spyOn(mockGitLab, 'getFile').mockImplementation(async (path) => {
                if (path === oldPath) return { content: 'content', sha: 'old-sha' };
                return { content: '', sha: '' };
            });
            vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: newPath, sha: 'new-sha' });
            vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([]);

            await manager.pushFiles([newPath]);

            // Must be a move, never an addition.
            expect(mockGitLab.pushFile).toHaveBeenCalledWith(
                newPath, 'content', 'main', `Move ${oldPath} to ${newPath}`
            );
            expect(mockGitLab.deleteFile).toHaveBeenCalledWith(
                oldPath, 'main', `Remove ${oldPath} (moved to ${newPath})`
            );
        });

        it('classifies the same tracked rename as a move identically whether pushFiles is called with one file or as part of a larger batch (Individual Push === Selected x1 Push)', async () => {
            const oldPath = 'old.md';
            const newPath = 'new.md';
            const otherPath = 'unrelated.md';
            const mockFile = Object.assign(new TFile(), { path: newPath, name: 'new.md' });

            mockSettings.syncMetadata[oldPath] = { lastSyncedSha: 'old-sha', lastSyncedAt: Date.now(), lastKnownPath: oldPath };
            await manager.trackRename(newPath, oldPath);

            vi.spyOn(mockApp.vault, 'getFileByPath').mockImplementation((path) => (path === newPath ? mockFile : null));
            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('content');
            vi.spyOn(mockApp.vault.adapter, 'exists').mockResolvedValue(true);
            vi.spyOn(mockApp.vault.adapter, 'read').mockResolvedValue('other content');
            vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: '', sha: '' });
            vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: newPath, sha: 'new-sha' });
            vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([]);

            // "Selected x1": one file, as a TFile, in an array of one.
            await manager.pushFiles([mockFile]);
            expect(mockGitLab.pushFile).toHaveBeenCalledWith(newPath, 'content', 'main', `Move ${oldPath} to ${newPath}`);
            expect(mockGitLab.deleteFile).toHaveBeenCalledWith(oldPath, 'main', `Remove ${oldPath} (moved to ${newPath})`);

            vi.clearAllMocks();
            mockSettings.syncMetadata[oldPath] = { lastSyncedSha: 'old-sha', lastSyncedAt: Date.now(), lastKnownPath: oldPath };
            await manager.trackRename(newPath, oldPath);
            vi.spyOn(mockApp.vault, 'getFileByPath').mockImplementation((path) => (path === newPath ? mockFile : null));
            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('content');
            vi.spyOn(mockApp.vault.adapter, 'exists').mockResolvedValue(true);
            vi.spyOn(mockApp.vault.adapter, 'read').mockResolvedValue('other content');
            vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: '', sha: '' });
            vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: newPath, sha: 'new-sha' });
            vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([]);

            // Same file, same expectation, but as one of several files in the batch.
            await manager.pushFiles([mockFile, otherPath]);
            expect(mockGitLab.pushFile).toHaveBeenCalledWith(newPath, 'content', 'main', `Move ${oldPath} to ${newPath}`);
            expect(mockGitLab.deleteFile).toHaveBeenCalledWith(oldPath, 'main', `Remove ${oldPath} (moved to ${newPath})`);
        });
    });

    describe('trackRename', () => {
        it('does nothing for a file with no sync history — just a new file at a new name', async () => {
            await manager.trackRename('new.md', 'old.md');
            expect(mockSettings.syncMetadata['new.md']).toBeUndefined();
            expect(mockSettings.syncMetadata['old.md']).toBeUndefined();
        });

        it('moves the metadata entry and records renamedFrom', async () => {
            mockSettings.syncMetadata['old.md'] = { lastSyncedSha: 'sha1', lastSyncedAt: 111, lastKnownPath: 'old.md' };

            await manager.trackRename('new.md', 'old.md');

            expect(mockSettings.syncMetadata['old.md']).toBeUndefined();
            expect(mockSettings.syncMetadata['new.md']).toEqual({
                lastSyncedSha: 'sha1', lastSyncedAt: 111, lastKnownPath: 'new.md', renamedFrom: 'old.md',
            });
        });

        it('collapses a chained rename A→B→C to a single pending move A→C', async () => {
            mockSettings.syncMetadata['a.md'] = { lastSyncedSha: 'sha1', lastSyncedAt: 111, lastKnownPath: 'a.md' };

            await manager.trackRename('b.md', 'a.md');
            await manager.trackRename('c.md', 'b.md');

            expect(mockSettings.syncMetadata['a.md']).toBeUndefined();
            expect(mockSettings.syncMetadata['b.md']).toBeUndefined();
            expect(mockSettings.syncMetadata['c.md']).toEqual({
                lastSyncedSha: 'sha1', lastSyncedAt: 111, lastKnownPath: 'c.md', renamedFrom: 'a.md',
            });
        });

        it('cancels the pending move when renamed back to the still-synced path', async () => {
            mockSettings.syncMetadata['a.md'] = { lastSyncedSha: 'sha1', lastSyncedAt: 111, lastKnownPath: 'a.md' };

            await manager.trackRename('b.md', 'a.md');
            await manager.trackRename('a.md', 'b.md');

            expect(mockSettings.syncMetadata['b.md']).toBeUndefined();
            expect(mockSettings.syncMetadata['a.md']).toEqual({
                lastSyncedSha: 'sha1', lastSyncedAt: 111, lastKnownPath: 'a.md',
            });
            expect(mockSettings.syncMetadata['a.md']?.renamedFrom).toBeUndefined();
        });
    });

    describe('Error Handling', () => {
        it('should handle push errors gracefully', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'fail.md', name: 'fail.md' });
            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('content');
            vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: '', sha: '' });
            vi.spyOn(mockGitLab, 'pushFile').mockRejectedValue(new Error('Network error'));
            vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([]);

            const results = await manager.pushFiles([mockFile]);

            expect(results.failed).toBe(1);
            expect(results.errors).toEqual([{ file: 'fail.md', error: 'Network error' }]);
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
            vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([]);

            const results = await manager.pushFiles([mockFile]);
            expect(results.failed).toBe(1);
            expect(results.errors).toEqual([{ file: newPath, error: 'Rename failed' }]);
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

        it('pulls a remote-only change without opening conflict resolution', async () => {
            const path = 'remote-edited.md';
            const file = Object.assign(new TFile(), { path, name: path });
            const baseSha = await gitBlobSha('base content');
            mockSettings.syncMetadata[path] = {
                lastSyncedSha: baseSha,
                lastSyncedAt: 0,
                lastKnownPath: path,
            };
            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('base content');
            vi.mocked(mockGitLab.getFile).mockResolvedValue({ content: 'remote edit', sha: 'remote-edit-sha' });

            await manager.pullFile(file);

            expect(mockApp.vault.modify).toHaveBeenCalledWith(file, 'remote edit');
            expect(SyncConflictModal).not.toHaveBeenCalled();
        });
    });

    describe('Plan preview (issue #63)', () => {
        it('shows a plan before a single-file push and applies it when confirmed', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
            vi.spyOn(mockGitLab, 'listFilesDetailed').mockResolvedValue([{ path: 'test.md', sha: 'old-sha', symlink: false }]);
            vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'different content', sha: 'old-sha' });
            const pushSpy = vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'test.md', sha: 'new-sha' });

            await manager.pushFiles([mockFile]);

            expect(SyncPlanModal).toHaveBeenCalledWith(
                mockApp,
                { additions: [], modifications: [{ path: 'test.md', name: 'test.md' }], deletions: [], moves: [], acceptedRemote: [], skippedConflicts: [] },
                'push',
                expect.any(Function),
                expect.any(Function)
            );
            expect(pushSpy).toHaveBeenCalled();
        });

        it('does not push when the plan is cancelled', async () => {
            vi.mocked(SyncPlanModal).mockImplementation(function (
                this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, _onConfirm: () => void, onCancel?: () => void
            ) {
                onCancel?.();
                return this;
            } as never);

            const mockFile = Object.assign(new TFile(), { path: 'test.md', name: 'test.md' });
            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('local content');
            vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: 'different content', sha: 'old-sha' });
            const pushSpy = vi.spyOn(mockGitLab, 'pushFile');

            const results = await manager.pushFiles([mockFile]);

            expect(results.cancelled).toBe(true);
            expect(pushSpy).not.toHaveBeenCalled();
        });

        it('does not pull when the plan is cancelled', async () => {
            vi.mocked(SyncPlanModal).mockImplementation(function (
                this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, _onConfirm: () => void, onCancel?: () => void
            ) {
                onCancel?.();
                return this;
            } as never);

            const path = 'new-remote-file.md';
            vi.mocked(mockGitLab.getFile).mockResolvedValue({ content: 'remote content', sha: 'new-sha' });
            vi.spyOn(mockApp.vault, 'getFileByPath').mockReturnValue(null);
            const writeSpy = vi.spyOn(mockApp.vault.adapter, 'write').mockResolvedValue(undefined);
            vi.spyOn(mockApp.vault.adapter, 'exists').mockResolvedValue(false);

            await manager.pullFile(path);

            expect(writeSpy).not.toHaveBeenCalled();
            expect(mockSettings.syncMetadata[path]).toBeUndefined();
        });

        it('marks a file with no remote sha as an addition in the plan', async () => {
            const mockFile = Object.assign(new TFile(), { path: 'new.md', name: 'new.md' });
            vi.spyOn(mockApp.vault, 'read').mockResolvedValue('new content');
            vi.spyOn(mockGitLab, 'getFile').mockResolvedValue({ content: '', sha: '' });
            vi.spyOn(mockGitLab, 'pushFile').mockResolvedValue({ path: 'new.md', sha: 'sha' });

            await manager.pushFiles([mockFile]);

            expect(SyncPlanModal).toHaveBeenCalledWith(
                mockApp,
                { additions: [{ path: 'new.md', name: 'new.md' }], modifications: [], deletions: [], moves: [], acceptedRemote: [], skippedConflicts: [] },
                'push',
                expect.any(Function),
                expect.any(Function)
            );
        });
    });
});

/* eslint-enable @typescript-eslint/unbound-method -- re-enable after the whole-file exemption above */
