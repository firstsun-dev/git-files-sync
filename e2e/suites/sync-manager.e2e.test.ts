import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SyncManager } from '../../src/logic/sync-manager';
import { SyncPlanModal, SyncPlanDirection } from '../../src/ui/SyncPlanModal';
import { SyncConflictModal } from '../../src/ui/SyncConflictModal';
// `import type` deliberately, not a value import: src/settings.ts also
// exports settings-tab UI (GitLabSyncSettingTab -> FolderSuggest ->
// AbstractInputSuggest etc.) which pulls in far more of `obsidian` than this
// suite's minimal shim provides. A type-only import is erased entirely, so
// none of that module ever loads.
import type { GitLabFilesPushSettings } from '../../src/settings';
import type { TFile as ObsidianTFile } from 'obsidian';
import { FakeVault, fakeApp } from '../shim/fake-vault';
import { TFile } from '../shim/obsidian-request-url';
import { currentProvider, timeouts } from '../config/env';
import { GiteaE2EAdapter } from '../providers/gitea-adapter';
import { GitHubE2EAdapter } from '../providers/github-adapter';
import { GitLabE2EAdapter } from '../providers/gitlab-adapter';
import type { ProviderE2EAdapter, ProvisionedProvider } from '../providers/provider-adapter';
import type { RemoteVerifier } from '../verifier/verifier-contract';

// Every push/pull SyncManager does shows a plan-review modal first; bare
// vi.mock (automock) + a per-suite auto-confirm implementation is the same
// pattern tests/logic/sync-manager.test.ts uses for unit tests. Conflict
// modal is left as the bare automock default (does nothing, never invokes
// onChoose) -- that's the real production behavior too: pushFile/pullFile
// return before the conflict modal resolves, so a bare mock is already
// correct, not a simplification of what's being tested.
vi.mock('../../src/ui/SyncPlanModal');
vi.mock('../../src/ui/SyncConflictModal');

interface AdapterWithVerifier extends ProvisionedProvider {
    verifier: RemoteVerifier;
}

function adapterFor(provider: string): ProviderE2EAdapter {
    if (provider === 'github') return new GitHubE2EAdapter();
    if (provider === 'gitlab') return new GitLabE2EAdapter();
    return new GiteaE2EAdapter();
}

/**
 * The E2E `obsidian` shim's `TFile` (e2e/shim/obsidian-request-url.ts) is a
 * separate, minimal class from the real `obsidian` package's `TFile` type
 * that `SyncManager`'s public methods are typed against -- vitest's runtime
 * module alias makes them the same *value* when this suite actually runs,
 * but `tsc` type-checks against the real `obsidian` .d.ts regardless of that
 * runtime alias, so passing the shim class straight into e.g. `pushFile`
 * needs this cast to satisfy the type checker.
 */
function asTFile(path: string): ObsidianTFile {
    return new TFile(path) as unknown as ObsidianTFile;
}

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
 * Real SyncManager + real production provider service (see e2e/providers/),
 * driven against whichever provider `E2E_PROVIDER` selects -- the same
 * adapter/verifier/provisioner the contract suites use, so this suite adds
 * no provider-specific logic of its own (see e2e/verifier/verifier-contract.ts
 * for what "independent verification" means here). Only the Obsidian
 * filesystem boundary is faked (e2e/shim/fake-vault.ts); everything else is
 * the real code path.
 */
describe('SyncManager E2E', () => {
    const provider = currentProvider();
    const adapter = adapterFor(provider);
    let ctx: AdapterWithVerifier;
    const runId = randomBytes(4).toString('hex');
    const path = (name: string) => `e2e-sync-${runId}/${name}`;

    beforeAll(async () => {
        ctx = (await adapter.provision()) as AdapterWithVerifier;
    }, timeouts.containerReadyMs + 30_000);

    afterAll(async () => {
        await adapter.teardown(ctx);
    });

    function newManager(vault: FakeVault, settings: GitLabFilesPushSettings): SyncManager {
        vi.mocked(SyncPlanModal).mockImplementation(function (
            this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, onConfirm: () => void
        ) {
            onConfirm();
            return this;
        } as never);
        return new SyncManager(fakeApp(vault), ctx.service, settings, undefined, () => false);
    }

    it('pushes a new local file, verified independently of the service', async () => {
        const filePath = path('new-file.md');
        const vault = new FakeVault();
        vault.writeLocal(filePath, '# local content');
        const settings = makeSettings(ctx.branch);
        const manager = newManager(vault, settings);

        const result = await manager.pushFile(filePath);

        expect(result?.sha).toBeTruthy();
        const remote = await ctx.verifier.getFile(filePath, ctx.branch);
        expect(remote?.content).toBe('# local content');
        expect(remote?.sha).toBe(result?.sha);
        expect(settings.syncMetadata[filePath]?.lastSyncedSha).toBe(remote?.sha);
    });

    it('does not create a remote mutation when pushing an unchanged file', async () => {
        const filePath = path('unchanged.md');
        const vault = new FakeVault();
        vault.writeLocal(filePath, 'steady state');
        const settings = makeSettings(ctx.branch);
        const manager = newManager(vault, settings);
        await manager.pushFile(filePath);

        const shasBefore = await ctx.verifier.listCommitShas(ctx.branch);
        const result = await manager.pushFile(filePath);
        const shasAfter = await ctx.verifier.listCommitShas(ctx.branch);

        expect(result?.sha).toBeTruthy();
        expect(shasAfter[0]).toBe(shasBefore[0]);
    });

    it('pulls a remote update into the local vault', async () => {
        const filePath = path('to-pull.md');
        // Seed the remote directly (not via SyncManager/pullFile), so this
        // vault's SyncManager has no syncMetadata baseline for the path yet --
        // e.g. the file was already in the vault before sync was ever run for
        // it. That's what makes this a plain pull rather than a conflict: see
        // sync-manager.ts's pull conflict check, which only fires when a prior
        // lastSyncedSha exists and no longer matches the remote (exercised by
        // the "conflict protection" test below, which does establish a
        // baseline first).
        await ctx.service.pushFile(filePath, 'v1', ctx.branch, 'e2e: seed remote file');
        const vault = new FakeVault();
        vault.writeLocal(filePath, 'v1');
        const settings = makeSettings(ctx.branch);
        const manager = newManager(vault, settings);

        // Remote changes out from under the vault -- via the real production
        // service, same as another client pushing, not via SyncManager.
        const remoteBefore = await ctx.verifier.getFile(filePath, ctx.branch);
        await ctx.service.pushFile(filePath, 'v2 from another client', ctx.branch, 'e2e: simulate remote update', remoteBefore?.sha);

        await manager.pullFile(filePath);

        expect(await vault.adapter.read(filePath)).toBe('v2 from another client');
        const remoteAfter = await ctx.verifier.getFile(filePath, ctx.branch);
        expect(settings.syncMetadata[filePath]?.lastSyncedSha).toBe(remoteAfter?.sha);
    });

    it('does not overwrite the remote or falsely mark synced when both sides changed', async () => {
        const filePath = path('conflict.md');
        const vault = new FakeVault();
        vault.writeLocal(filePath, 'baseline');
        const settings = makeSettings(ctx.branch);
        const manager = newManager(vault, settings);
        await manager.pushFile(filePath);
        const baselineMeta = settings.syncMetadata[filePath];

        // Diverge both sides from the synced baseline.
        vault.writeLocal(filePath, 'local edit');
        const remoteBaseline = await ctx.verifier.getFile(filePath, ctx.branch);
        await ctx.service.pushFile(filePath, 'remote edit', ctx.branch, 'e2e: diverge remote', remoteBaseline?.sha);

        const conflictCallsBefore = vi.mocked(SyncConflictModal).mock.calls.length;
        const result = await manager.pushFile(filePath);

        expect(result).toBeUndefined();
        expect(vi.mocked(SyncConflictModal).mock.calls.length).toBe(conflictCallsBefore + 1);
        const remoteAfter = await ctx.verifier.getFile(filePath, ctx.branch);
        expect(remoteAfter?.content).toBe('remote edit');
        expect(settings.syncMetadata[filePath]).toEqual(baselineMeta);
    });

    it('renames/moves a file in exactly one commit, verified independently of the service', async () => {
        const oldPath = path('rename/old.md');
        const newPath = path('rename/new.md');
        const vault = new FakeVault();
        vault.writeLocal(oldPath, 'move me');
        const settings = makeSettings(ctx.branch);
        const manager = newManager(vault, settings);
        await manager.pushFile(oldPath);

        vault.renameLocal(oldPath, newPath);
        await manager.trackRename(newPath, oldPath);
        const shasBefore = await ctx.verifier.listCommitShas(ctx.branch);

        // Rename detection only runs off a real TFile (sync-manager.ts checks
        // `!isString && fileOrPath instanceof TFile` before consulting
        // `renamedFrom`) -- a plain path string, as every other scenario in
        // this suite uses, always takes the plain-push branch instead, same
        // as it does in production when the caller doesn't have a TFile handy.
        await manager.pushFile(asTFile(newPath));

        expect(await ctx.verifier.fileMissing(oldPath, ctx.branch)).toBe(true);
        const remote = await ctx.verifier.getFile(newPath, ctx.branch);
        expect(remote?.content).toBe('move me');
        const shasAfter = await ctx.verifier.listCommitShas(ctx.branch);
        expect(shasAfter.length).toBe(shasBefore.length + 1);
    });

    it('deletes a file via the real service, verified independently', async () => {
        // Deletion isn't a SyncManager method -- src/ui/SyncStatusView.ts calls
        // gitService.deleteFile directly, so this reproduces that real path.
        const filePath = path('to-delete.md');
        const vault = new FakeVault();
        vault.writeLocal(filePath, 'delete me');
        const settings = makeSettings(ctx.branch);
        const manager = newManager(vault, settings);
        await manager.pushFile(filePath);
        expect(await ctx.verifier.fileMissing(filePath, ctx.branch)).toBe(false);

        await ctx.service.deleteFile(filePath, ctx.branch, 'e2e: delete file');
        await manager.clearMetadata(filePath);

        expect(await ctx.verifier.fileMissing(filePath, ctx.branch)).toBe(true);
        expect(settings.syncMetadata[filePath]).toBeUndefined();
    });

    it('pushes a batch of local files in exactly one commit, verified independently', async () => {
        const paths = [path('batch/a.md'), path('batch/b.md'), path('batch/c.md')];
        const vault = new FakeVault();
        for (const p of paths) vault.writeLocal(p, `content for ${p}`);
        const settings = makeSettings(ctx.branch);
        const manager = newManager(vault, settings);
        const shasBefore = await ctx.verifier.listCommitShas(ctx.branch);

        const results = await manager.pushAllFiles(paths);

        expect(results.success).toBe(paths.length);
        expect(results.failed).toBe(0);
        for (const p of paths) {
            const remote = await ctx.verifier.getFile(p, ctx.branch);
            expect(remote?.content).toBe(`content for ${p}`);
        }
        const shasAfter = await ctx.verifier.listCommitShas(ctx.branch);
        expect(shasAfter.length).toBe(shasBefore.length + 1);
    });
});
