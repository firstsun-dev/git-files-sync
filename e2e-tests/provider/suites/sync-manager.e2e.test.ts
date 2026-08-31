import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SyncManager, BatchPushConflict, ConflictResolution } from '../../../src/logic/sync-manager';
import { SyncPlanModal, SyncPlanDirection } from '../../../src/ui/SyncPlanModal';
import { BatchConflictResolutionModal } from '../../../src/ui/BatchConflictResolutionModal';
import { ObsidianSyncInteraction } from '../../../src/ui/ObsidianSyncInteraction';
import { describePushResult } from '../support/push-result-diagnostic';
// `import type` deliberately, not a value import: src/settings.ts also
// exports settings-tab UI (GitLabSyncSettingTab -> FolderSuggest ->
// AbstractInputSuggest etc.) which pulls in far more of `obsidian` than this
// suite's minimal runtime shim provides. A type-only import is erased
// entirely, so none of that module ever loads.
import type { GitLabFilesPushSettings } from '../../../src/settings';
import { TFile as ObsidianTFile } from 'obsidian';
import { GitVerifier } from '../support/git-verifier';
import { FakeVault, fakeApp, type TFileLike, type TFileCtor } from '../shim/fake-vault';
import { currentProvider, timeouts, contextFor } from '../config/env';

// Every push/pull SyncManager does shows a plan-review modal first, and any
// push-side content conflict now goes through BatchConflictResolutionModal
// (even a single-file batch) -- bare vi.mock (automock) + a per-suite
// implementation, same pattern tests/logic/sync-manager-batch.test.ts uses
// for unit tests. Pull-side conflicts still go through SyncConflictModal,
// left as the bare automock default (does nothing, matching production:
// pullFile returns before the conflict modal resolves).
vi.mock('../../../src/ui/SyncPlanModal');
vi.mock('../../../src/ui/SyncConflictModal');
vi.mock('../../../src/ui/BatchConflictResolutionModal');

function makeSettings(branch: string): GitLabFilesPushSettings {
    return {
        serviceType: 'gitea',
        gitlabToken: '', gitlabBaseUrl: '', projectId: '',
        githubToken: '', githubOwner: '', githubRepo: '',
        giteaToken: '', giteaBaseUrl: '', giteaOwner: '', giteaRepo: '',
        branch,
        syncMetadata: {},
        rootPath: '',
        vaultFolder: '',
        symlinkHandling: 'skip',
        ignorePatterns: '',
        lastSeenVersion: '',
        bannerDismissedVersion: '',
        language: 'system',
        autoRefreshOnStartup: true,
    };
}

/**
 * Real SyncManager + real production provider service (see
 * e2e-tests/provider/config/env.ts), driven against whichever provider `E2E_PROVIDER`
 * selects -- the same branch/verifier the contract suites use, so this suite
 * adds no provider-specific logic of its own. Only the Obsidian filesystem
 * boundary is faked (e2e-tests/provider/shim/fake-vault.ts); everything else is the real
 * code path.
 */
describe('SyncManager E2E', () => {
    const provider = currentProvider();
    let service: ReturnType<typeof contextFor>['service'];
    let branch: string;
    let verifier: GitVerifier;
    let TFile: TFileCtor;
    let conflictResolver: (conflict: BatchPushConflict) => ConflictResolution;
    const runId = Math.random().toString(36).slice(2, 10);
    const path = (name: string) => `e2e-sync-${runId}/${name}`;

    beforeAll(async () => {
        const ctx = contextFor(provider);
        service = ctx.service;
        branch = ctx.branch;
        verifier = new GitVerifier();
        TFile = ObsidianTFile;

        conflictResolver = () => 'skip';
        vi.mocked(SyncPlanModal).mockImplementation(function (
            this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, onConfirm: () => void
        ) {
            onConfirm();
            return this;
        });
        vi.mocked(BatchConflictResolutionModal).mockImplementation(function (
            this: BatchConflictResolutionModal,
            _app: unknown,
            conflicts: BatchPushConflict[],
            _safeCount: number,
            onResolve: () => void,
            _onCancel: () => void,
        ) {
            for (const conflict of conflicts) conflict.resolution = conflictResolver(conflict);
            onResolve();
            return this;
        });
    }, timeouts.containerReadyMs + 30_000);

    function newManager(vault: FakeVault, settings: GitLabFilesPushSettings): SyncManager {
        const app = fakeApp(vault);
        return new SyncManager(app, service, settings, undefined, () => false, undefined, new ObsidianSyncInteraction(app));
    }

    it('pushes a new local file, verified independently of the service', async () => {
        const filePath = path('new-file.md');
        const vault = new FakeVault(TFile);
        vault.writeLocal(filePath, '# local content');
        const settings = makeSettings(branch);
        const manager = newManager(vault, settings);

        const result = await manager.pushFiles([filePath]);

        expect(result.success, describePushResult(result)).toBe(1);
        expect(result.failed, describePushResult(result)).toBe(0);
        const pushedSha = result.syncedPaths.find(p => p.path === filePath)?.sha;
        expect(pushedSha).toBeTruthy();
        const remote = await verifier.getFile(filePath, branch);
        expect(remote?.content).toBe('# local content');
        expect(remote?.sha).toBe(pushedSha);
        expect(settings.syncMetadata[filePath]?.lastSyncedSha).toBe(remote?.sha);
    });

    it('does not create a remote mutation when pushing an unchanged file', async () => {
        const filePath = path('unchanged.md');
        const vault = new FakeVault(TFile);
        vault.writeLocal(filePath, 'steady state');
        const settings = makeSettings(branch);
        const manager = newManager(vault, settings);
        const initialPush = await manager.pushFiles([filePath]);
        expect(initialPush.success, describePushResult(initialPush)).toBe(1);
        expect(initialPush.failed, describePushResult(initialPush)).toBe(0);

        const shasBefore = await verifier.listCommitShas(branch);
        const result = await manager.pushFiles([filePath]);
        const shasAfter = await verifier.listCommitShas(branch);

        // The unified pipeline classifies a no-op push as neither a push nor
        // a failure (see buildBatchPushPlan's 'unchanged' outcome in
        // src/logic/sync-manager.ts) -- nothing to report as synced this
        // time, and critically, no new commit.
        expect(result.success).toBe(0);
        expect(result.failed).toBe(0);
        expect(shasAfter[0]).toBe(shasBefore[0]);
    });

    it('pulls a remote update into the local vault', async () => {
        const filePath = path('to-pull.md');
        // Seed the remote directly (not via SyncManager/pullFile), so this
        // vault's SyncManager has no syncMetadata baseline for the path yet.
        await service.pushFile(filePath, 'v1', branch, 'e2e: seed remote file');
        const vault = new FakeVault(TFile);
        vault.writeLocal(filePath, 'v1');
        const settings = makeSettings(branch);
        const manager = newManager(vault, settings);

        // Remote changes out from under the vault -- via the real production
        // service, same as another client pushing, not via SyncManager.
        const remoteBefore = await verifier.getFile(filePath, branch);
        await service.pushFile(filePath, 'v2 from another client', branch, 'e2e: simulate remote update', remoteBefore?.sha);

        await manager.pullFile(filePath);

        expect(await vault.adapter.read(filePath)).toBe('v2 from another client');
        const remoteAfter = await verifier.getFile(filePath, branch);
        expect(settings.syncMetadata[filePath]?.lastSyncedSha).toBe(remoteAfter?.sha);
    });

    it('does not overwrite the remote or falsely mark synced when both sides changed', async () => {
        const filePath = path('conflict.md');
        const vault = new FakeVault(TFile);
        vault.writeLocal(filePath, 'baseline');
        const settings = makeSettings(branch);
        const manager = newManager(vault, settings);
        const initialPush = await manager.pushFiles([filePath]);
        expect(initialPush.success, describePushResult(initialPush)).toBe(1);
        expect(initialPush.failed, describePushResult(initialPush)).toBe(0);
        const baselineMeta = settings.syncMetadata[filePath];

        // Diverge both sides from the synced baseline.
        vault.writeLocal(filePath, 'local edit');
        const remoteBaseline = await verifier.getFile(filePath, branch);
        await service.pushFile(filePath, 'remote edit', branch, 'e2e: diverge remote', remoteBaseline?.sha);

        conflictResolver = () => 'skip';
        const conflictCallsBefore = vi.mocked(BatchConflictResolutionModal).mock.calls.length;
        const result = await manager.pushFiles([filePath]);

        expect(vi.mocked(BatchConflictResolutionModal).mock.calls.length).toBe(conflictCallsBefore + 1);
        expect(result.skippedConflicts).toBeGreaterThanOrEqual(1);
        const remoteAfter = await verifier.getFile(filePath, branch);
        expect(remoteAfter?.content).toBe('remote edit');
        expect(settings.syncMetadata[filePath]).toEqual(baselineMeta);
    });

    it('renames/moves a file in exactly one commit, verified independently of the service', async () => {
        const oldPath = path('rename/old.md');
        const newPath = path('rename/new.md');
        const vault = new FakeVault(TFile);
        vault.writeLocal(oldPath, 'move me');
        const settings = makeSettings(branch);
        const manager = newManager(vault, settings);
        const initialPush = await manager.pushFiles([oldPath]);
        expect(initialPush.success, describePushResult(initialPush)).toBe(1);
        expect(initialPush.failed, describePushResult(initialPush)).toBe(0);

        vault.renameLocal(oldPath, newPath);
        await manager.trackRename(newPath, oldPath);
        // Just the current HEAD, not a full list: the sandbox repo's base
        // branch already carries pre-existing history, so comparing
        // HEAD-before against the two newest commits after stays exact
        // regardless of total history depth.
        const [headBefore] = await verifier.listCommitShas(branch, 1);

        // Rename detection only runs off a real TFile (sync-manager.ts checks
        // `!isString && fileOrPath instanceof TFile` before consulting
        // `renamedFrom`).
        const newFile: TFileLike = vault.fileAt(newPath);
        const moveResult = await manager.pushFiles([newFile as unknown as string]);
        expect(moveResult.success, describePushResult(moveResult)).toBe(1);
        expect(moveResult.failed, describePushResult(moveResult)).toBe(0);

        expect(await verifier.fileMissing(oldPath, branch)).toBe(true);
        const remote = await verifier.getFile(newPath, branch);
        expect(remote?.content).toBe('move me');
        const [headAfter, headAfterParent] = await verifier.listCommitShas(branch, 2);
        expect(headAfter).not.toBe(headBefore);
        expect(headAfterParent).toBe(headBefore);
    });

    it('deletes a file via the real service, verified independently', async () => {
        // Deletion isn't a SyncManager method -- src/ui/SyncStatusView.ts calls
        // gitService.deleteFile directly, so this reproduces that real path.
        const filePath = path('to-delete.md');
        const vault = new FakeVault(TFile);
        vault.writeLocal(filePath, 'delete me');
        const settings = makeSettings(branch);
        const manager = newManager(vault, settings);
        const initialPush = await manager.pushFiles([filePath]);
        expect(initialPush.success, describePushResult(initialPush)).toBe(1);
        expect(initialPush.failed, describePushResult(initialPush)).toBe(0);
        expect(await verifier.fileMissing(filePath, branch)).toBe(false);

        await service.deleteFile(filePath, branch, 'e2e: delete file');
        await manager.clearMetadata(filePath);

        expect(await verifier.fileMissing(filePath, branch)).toBe(true);
        expect(settings.syncMetadata[filePath]).toBeUndefined();
    });

    it('pushes a batch of local files in exactly one commit, verified independently', async () => {
        const paths = [path('batch/a.md'), path('batch/b.md'), path('batch/c.md')];
        const vault = new FakeVault(TFile);
        for (const p of paths) vault.writeLocal(p, `content for ${p}`);
        const settings = makeSettings(branch);
        const manager = newManager(vault, settings);
        const [headBefore] = await verifier.listCommitShas(branch, 1);

        const results = await manager.pushFiles(paths);

        expect(results.success, describePushResult(results)).toBe(paths.length);
        expect(results.failed, describePushResult(results)).toBe(0);
        for (const p of paths) {
            const remote = await verifier.getFile(p, branch);
            expect(remote?.content).toBe(`content for ${p}`);
        }
        const [headAfter, headAfterParent] = await verifier.listCommitShas(branch, 2);
        expect(headAfter).not.toBe(headBefore);
        expect(headAfterParent).toBe(headBefore);
    });
});
