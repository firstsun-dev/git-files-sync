import { vi } from 'vitest';
import { SyncManager } from '../../../src/logic/sync-manager';
import type { BatchPushConflict, ConflictResolution, PushResults } from '../../../src/logic/sync/types';
import { SyncPlanModal, type SyncPlanDirection } from '../../../src/ui/SyncPlanModal';
import { BatchConflictResolutionModal } from '../../../src/ui/BatchConflictResolutionModal';
import { ObsidianSyncInteraction } from '../../../src/ui/ObsidianSyncInteraction';
// `import type` deliberately: settings.ts re-exports the settings-tab UI
// (GitLabSyncSettingTab -> FolderSuggest -> AbstractInputSuggest) which pulls
// in far more of `obsidian` than this suite's runtime shim provides. A
// type-only import is erased entirely, so none of that module ever loads.
import type { GitLabFilesPushSettings } from '../../../src/settings';
import { TFile as ObsidianTFile } from 'obsidian';
import { GitVerifier } from './git-verifier';
import { FakeVault, fakeApp, type TFileCtor } from '../shim/fake-vault';
import { currentProvider, contextFor } from '../config/env';
import type { GitServiceInterface } from '../../../src/services/git-service-interface';

const TFile: TFileCtor = ObsidianTFile;

/**
 * Reusable real-provider E2E fixture for SyncManager workflows. Owns the
 * once-per-suite wiring the old `e2e/suites/sync-manager.e2e.test.ts` kept in
 * its `beforeAll`: resolving the real production provider service + isolated
 * branch, loading the git-CLI verifier + TFile shim, and installing
 * plan-review/conflict modals that auto-confirm (so a push can proceed without
 * a human clicking through). Per-test conflict outcomes are steered through
 * {@link setConflictResolver}.
 *
 * Only the Obsidian filesystem boundary is faked
 * (e2e-tests/provider/shim/fake-vault.ts);
 * everything else — SyncManager, PushCoordinator, the provider service — is
 * the real production code path against a real Git server.
 */
export interface SyncManagerFixture {
    /** Real production provider service for the selected `E2E_PROVIDER`. */
    readonly service: GitServiceInterface;
    /** Isolated branch `scripts/e2e-harness.sh provision` created for this run. */
    readonly branch: string;
    /** Independent git-CLI verifier (e2e-tests/provider/support/git-verifier.ts). */
    readonly verifier: GitVerifier;
    /** The exact TFile class the vitest-runtime `obsidian` alias resolves to. */
    readonly TFile: TFileCtor;
    /** Per-suite run id, so every test's remote paths are namespaced apart. */
    readonly runId: string;
    /** Namespaced remote path: `path('note.md') -> e2e-sc-<runId>/note.md`. */
    path(name: string): string;
    /** Fresh settings object pointing at the isolated branch, empty metadata. */
    makeSettings(branch?: string): GitLabFilesPushSettings;
    /** A fresh in-memory vault (the only faked boundary). */
    createVault(): FakeVault;
    /** A real SyncManager wired to `vault` + `settings` + the real service. */
    newManager(vault: FakeVault, settings: GitLabFilesPushSettings): SyncManager;
    /** Steers how the auto-confirming conflict modal resolves each conflict. */
    setConflictResolver(resolver: (conflict: BatchPushConflict) => ConflictResolution): void;
    /** Reads the currently installed conflict resolver (for multi-client scenario wiring). */
    conflictResolver(): (conflict: BatchPushConflict) => ConflictResolution;
}

export async function createSyncManagerFixture(): Promise<SyncManagerFixture> {
    const provider = currentProvider();
    const ctx = contextFor(provider);
    const service = ctx.service;
    const branch = ctx.branch;

    const verifier: GitVerifier = new GitVerifier();

    let conflictResolver: (conflict: BatchPushConflict) => ConflictResolution = () => 'skip';

    // Auto-confirm the plan-review modal (production shows it before every
    // push/pull). Same pattern as tests/logic/sync-manager-batch.test.ts.
    vi.mocked(SyncPlanModal).mockImplementation(function (
        this: SyncPlanModal, _app: unknown, _plan: unknown, _direction: SyncPlanDirection, onConfirm: () => void
    ) {
        onConfirm();
        return this;
    });

    // Every push-side content conflict goes through BatchConflictResolutionModal
    // (even a single-file batch). Auto-resolve using the current resolver.
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

    // Test-only namespace disambiguator (avoids path collisions between
    // concurrent e2e runs against the same shared remote) — no security
    // context, so a non-cryptographic PRNG is intentional here.
    const runId = Math.random().toString(36).slice(2, 10); // NOSONAR typescript:S2245

    function path(name: string): string {
        return `e2e-sc-${runId}/${name}`;
    }

    function makeSettings(branchOverride?: string): GitLabFilesPushSettings {
        return {
            serviceType: 'gitea',
            gitlabToken: '', gitlabBaseUrl: '', projectId: '',
            githubToken: '', githubOwner: '', githubRepo: '',
            giteaToken: '', giteaBaseUrl: '', giteaOwner: '', giteaRepo: '',
            branch: branchOverride ?? branch,
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

    function createVault(): FakeVault {
        return new FakeVault(TFile);
    }

    function newManager(vault: FakeVault, settings: GitLabFilesPushSettings): SyncManager {
        const app = fakeApp(vault);
        return new SyncManager(app, service, settings, undefined, () => false, undefined, new ObsidianSyncInteraction(app));
    }

    return {
        service,
        branch,
        verifier,
        TFile,
        runId,
        path,
        makeSettings,
        createVault,
        newManager,
        setConflictResolver: (resolver) => { conflictResolver = resolver; },
        conflictResolver: () => conflictResolver,
    };
}

export { describePushResult } from './push-result-diagnostic';
export type { PushResults };
