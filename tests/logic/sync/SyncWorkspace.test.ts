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
