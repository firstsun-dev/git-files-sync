import { describe, expect, it, vi } from 'vitest';
import { SyncManagerWorkspace } from '../../../src/logic/sync/SyncWorkspace';
import type { SyncManager } from '../../../src/logic/sync/SyncManager';
import type { SyncStatusRefreshService } from '../../../src/logic/sync/SyncStatusRefreshService';
import type { SyncDiffService } from '../../../src/logic/sync/SyncDiffService';
import type { GitServiceInterface, GitTreeEntry } from '../../../src/services/git-service-interface';
import type { GitLabFilesPushSettings } from '../../../src/settings';
import type { App } from 'obsidian';

function createWorkspace(head: string) {
    const tree: GitTreeEntry[] = [{ path: 'a.md', symlink: false, sha: 'sha-a' }];
    const pushFiles = vi.fn().mockResolvedValue({ success: 0, failed: 0, conflicts: 0, errors: [], syncedPaths: [] });
    const getBranchHead = vi.fn().mockResolvedValue(head);
    const manager = {
        status: { values: () => [] },
        pushFiles,
    } as unknown as SyncManager;
    const settings = { branch: 'main', rootPath: '' } as GitLabFilesPushSettings;
    const refreshService = {
        refresh: vi.fn().mockResolvedValue({ localCount: 1, remoteCount: 1, remoteHead: 'commit-1', remoteEntries: tree }),
    } as unknown as SyncStatusRefreshService;
    const workspace = new SyncManagerWorkspace({
        manager: () => manager,
        gitService: () => ({ getBranchHead } as unknown as GitServiceInterface),
        settings: () => settings,
        refreshService,
        diffService: {} as SyncDiffService,
        normalizePath: path => path,
        app: {} as App,
    });
    return { workspace, tree, pushFiles };
}

describe('SyncManagerWorkspace deleteRemote', () => {
    function createDeleteWorkspace() {
        const deleteFile = vi.fn(async (repoPath: string) => {
            if (repoPath === 'fails.md') throw new Error('boom');
        });
        const clearMetadata = vi.fn().mockResolvedValue(undefined);
        const statusDelete = vi.fn();
        const manager = {
            status: { values: () => [], delete: statusDelete },
            clearMetadata,
        } as unknown as SyncManager;
        const workspace = new SyncManagerWorkspace({
            manager: () => manager,
            gitService: () => ({ deleteFile } as unknown as GitServiceInterface),
            settings: () => ({ branch: 'main', rootPath: '' } as GitLabFilesPushSettings),
            refreshService: {} as SyncStatusRefreshService,
            diffService: {} as SyncDiffService,
            normalizePath: path => path,
            app: {} as App,
        });
        return { workspace, deleteFile, clearMetadata, statusDelete };
    }

    it('clears tracked metadata and the live status row for each path actually deleted on the remote', async () => {
        const { workspace, clearMetadata, statusDelete } = createDeleteWorkspace();

        const result = await workspace.deleteRemote(['a.md']);

        expect(result.deletedPaths).toEqual(['a.md']);
        expect(clearMetadata).toHaveBeenCalledWith('a.md');
        expect(statusDelete).toHaveBeenCalledWith('a.md');
    });

    it('does not clear metadata or status for a path that failed to delete on the remote', async () => {
        const { workspace, clearMetadata, statusDelete } = createDeleteWorkspace();

        const result = await workspace.deleteRemote(['fails.md']);

        expect(result.errors).toEqual([{ path: 'fails.md', message: 'boom' }]);
        expect(clearMetadata).not.toHaveBeenCalled();
        expect(statusDelete).not.toHaveBeenCalled();
    });

    it('only clears metadata/status for the paths that succeeded in a mixed batch', async () => {
        const { workspace, clearMetadata, statusDelete } = createDeleteWorkspace();

        await workspace.deleteRemote(['a.md', 'fails.md']);

        expect(clearMetadata).toHaveBeenCalledTimes(1);
        expect(clearMetadata).toHaveBeenCalledWith('a.md');
        expect(statusDelete).toHaveBeenCalledTimes(1);
        expect(statusDelete).toHaveBeenCalledWith('a.md');
    });
});

describe('SyncManagerWorkspace remote snapshot', () => {
    it('reuses a refreshed tree while the branch head is unchanged', async () => {
        const { workspace, tree, pushFiles } = createWorkspace('commit-1');
        await workspace.refresh();

        await workspace.push(['a.md'], vi.fn());

        expect(pushFiles).toHaveBeenCalledWith(['a.md'], expect.any(Function), tree);
    });

    it('drops a refreshed tree after the branch head changes', async () => {
        const { workspace, pushFiles } = createWorkspace('commit-2');
        await workspace.refresh();

        await workspace.push(['a.md'], vi.fn());

        expect(pushFiles).toHaveBeenCalledWith(['a.md'], expect.any(Function), undefined);
    });
});
