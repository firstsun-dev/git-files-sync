import { expect } from 'vitest';
import type { TFile } from 'obsidian';
import type { GitServiceInterface } from '../../src/services/git-service-interface';
import type { GitLabFilesPushSettings } from '../../src/settings';
import type { BatchPushConflict, ConflictResolution, PushResults } from '../../src/logic/sync/types';
import type { SyncManager } from '../../src/logic/sync-manager';
import type { FileStatus } from '../../src/logic/sync-status-service';
import type { GitVerifier as GitVerifierType } from '../verifier-runtime-types';
import type { FakeVault, TFileLike, TFileCtor } from '../shim/fake-vault';
import { fakeApp } from '../shim/fake-vault';
import { SyncStatusRefreshService } from '../../src/logic/sync/SyncStatusRefreshService';
import { SyncStatusService } from '../../src/logic/sync-status-service';
import { GitignoreManager } from '../../src/logic/gitignore-manager';
import { ensureSyncWorkspaceRuntime } from '../../src/logic/sync/SyncWorkspace';
import { ChangeRepository } from '../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../src/logic/source-control/OperationState';
import { SourceControlActionService } from '../../src/logic/source-control/SourceControlActionService';
import { toSyncChanges } from '../../src/logic/source-control/FileStatusAdapter';

/**
 * The provider-level fixtures the two-client scenario shares across clients.
 * `newVault`/`newSettings`/`newManager` return FRESH instances per call — two
 * clients must never share a vault, a settings object, or a SyncManager.
 */
export interface TwoClientFixture {
    readonly service: GitServiceInterface;
    readonly branch: string;
    readonly verifier: GitVerifierType;
    readonly TFile: TFileCtor;
    /** Namespaced run id, so each test's remote paths stay apart. */
    readonly runId: string;
    newVault(): FakeVault;
    newSettings(): GitLabFilesPushSettings;
    newManager(vault: FakeVault, settings: GitLabFilesPushSettings): SyncManager;
    /** Currently installed conflict-modal resolver (steered per test via setConflictResolver). */
    conflictResolver(): (conflict: BatchPushConflict) => ConflictResolution;
}

/**
 * One client's full stack: its own FakeVault + its own settings (and therefore
 * its own `syncMetadata` baseline store) + its own real SyncManager + the real
 * Source Control refresh/status/action layer. `sync()` reproduces the
 * production Sync Queue path end to end: refresh (status projection from live
 * local + remote state) -> toSyncChanges -> SourceControlActionService.sync
 * (one merged Sync Plan: pushes/moves/deletions committed together as one
 * remote mutation set, remote-only changes pulled locally with zero commits).
 * The multi-client loop therefore exercises the same planner + coordinators
 * desktop/mobile actually run.
 */
export class TwoClient {
    readonly vault: FakeVault;
    readonly settings: GitLabFilesPushSettings;
    readonly manager: SyncManager;
    private readonly statuses = new SyncStatusService();
    private readonly repository = new ChangeRepository();
    private readonly operations = new OperationState();
    private readonly refreshService: SyncStatusRefreshService;
    private readonly actionService: SourceControlActionService;

    constructor(
        readonly name: 'A' | 'B',
        private readonly fixture: TwoClientFixture,
    ) {
        this.vault = fixture.newVault();
        this.settings = fixture.newSettings();
        const app = fakeApp(this.vault);
        this.manager = fixture.newManager(this.vault, this.settings);
        const gitignoreManager = new GitignoreManager(
            app, fixture.service, this.settings.branch, this.settings.rootPath, this.settings.vaultFolder, this.settings.ignorePatterns,
        );
        const refreshService = new SyncStatusRefreshService(
            {
                app,
                settings: () => this.settings,
                gitService: () => fixture.service,
                gitignoreManager: () => gitignoreManager,
                syncManager: () => this.manager,
                filterFilesByVaultFolder: files => files,
                filterPathByVaultFolder: () => true,
                // vaultFolder/rootPath are empty in e2e settings; vault-relative
                // path === repo-relative path.
                getNormalizedPath: path => path,
                getVaultPath: path => path,
            },
            this.statuses,
        );
        this.refreshService = refreshService;
        const { workspace } = ensureSyncWorkspaceRuntime(app, {
            settings: this.settings,
            gitService: fixture.service,
            sync: this.manager,
            getNormalizedPath: path => path,
        }, this.statuses);
        this.actionService = new SourceControlActionService(this.repository, this.operations, workspace);
    }

    // --- local vault ops --------------------------------------------------

    write(path: string, content: string): void {
        this.vault.writeLocal(path, content);
    }

    delete(path: string): void {
        this.vault.removeLocal(path);
    }

    rename(oldPath: string, newPath: string): void {
        this.vault.renameLocal(oldPath, newPath);
    }

    async read(path: string): Promise<string> {
        return this.vault.adapter.read(path);
    }

    exists(path: string): boolean {
        return this.vault.has(path);
    }

    metadata(path: string): GitLabFilesPushSettings['syncMetadata'][string] | undefined {
        return this.settings.syncMetadata[path];
    }

    metadataSha(path: string): string | undefined {
        return this.settings.syncMetadata[path]?.lastSyncedSha;
    }

    /** A real TFile handle, needed for rename detection on push. */
    tfile(path: string): TFileLike {
        return this.vault.fileAt(path);
    }

    // --- status projection ------------------------------------------------

    /** Runs the real Source Control refresh: live local scan + remote tree + per-file classification. */
    async refresh(): Promise<void> {
        await this.refreshService.refresh();
        this.repository.replace(toSyncChanges([...this.statuses.values()]));
    }

    /** Status rows from the last refresh — the "Repository Changes" view model. */
    statusesNow(): FileStatus[] {
        return [...this.statuses.values()];
    }

    // --- sync actions ------------------------------------------------------

    /**
     * The production Sync Queue path on every non-`checking` change, exactly
     * what the Sync button does after a refresh: one merged Sync Plan per
     * direction split, one confirm, one commit for the remote mutation set,
     * pulls applied locally. Conflict modals resolve via the fixture's
     * resolver (auto-confirmed like the other e2e suites).
     */
    async sync(): Promise<void> {
        await this.refresh();
        const changeIds = this.repository.getAll().map(change => change.id);
        await this.actionService.sync(changeIds);
    }

    /** Push-only path (the per-row Sync/Push on one or more changes). */
    async push(paths: string[]): Promise<void> {
        await this.refresh();
        await this.actionService.push(this.changesFor(paths));
    }

    /** Pull-only path. */
    async pull(paths: string[]): Promise<void> {
        await this.refresh();
        await this.actionService.pull(this.changesFor(paths));
    }

    private changesFor(paths: string[]) {
        const ids = [];
        for (const path of paths) {
            const change = this.repository.getByPath(path);
            if (change) ids.push(change.id);
        }
        return ids;
    }

    /** Direct pushFiles passthrough for tests that need the raw PushResults (most sync tests use sync()). */
    pushFiles(files: (TFileLike | string)[]): Promise<PushResults> {
        return this.manager.pushFiles(files as unknown as (TFile | string)[]);
    }

    /** Sets a pending rename (production rename-event path; a no-op when the old path was never synced). */
    async trackRename(newPath: string, oldPath: string): Promise<void> {
        await this.manager.trackRename(newPath, oldPath);
    }
}

/**
 * The two-client scenario: one shared real provider service + isolated branch
 * + independent git-CLI verifier, and exactly two fully independent clients
 * (A and B) wired on top of it. The only faked boundary remains the Obsidian
 * vault; SyncManager, planners, coordinators, refresh, the Source Control
 * action layer, and the provider service are all real production code against
 * a real Git server. Remote assertions always go through the verifier, never
 * the service under test.
 */
export class TwoClientSyncScenario {
    readonly a: TwoClient;
    readonly b: TwoClient;
    /** The isolated branch both clients sync against. */
    readonly branch: string;

    private constructor(private readonly fixture: TwoClientFixture) {
        this.branch = fixture.branch;
        this.a = new TwoClient('A', fixture);
        this.b = new TwoClient('B', fixture);
    }

    /** Assembles the scenario from the suites' `beforeAll` SyncManagerFixture. */
    static from(fixture: TwoClientFixture): TwoClientSyncScenario {
        return new TwoClientSyncScenario(fixture);
    }

    /** Remote path namespaced to this run (same shape the single-client suites use). */
    path(name: string): string {
        return `e2e-tc-${this.fixture.runId}/${name}`;
    }

    /**
     * Establishes a common synced baseline both clients agree on: write + push
     * through client A's real manager (A's metadata baseline is set by real
     * code), then mirror the identical content into B's vault and seed the
     * metadata baseline B would have recorded had it pushed the identical blob
     * (deterministic: same content => same blob sha). Models "phone and
     * desktop already have this file in sync" without two round trips of
     * identical pushes.
     */
    async baseline(path: string, content: string): Promise<void> {
        this.a.write(path, content);
        const result = await this.a.manager.pushFiles([path]);
        expect(result.success, `baseline push of ${path} failed: ${JSON.stringify(result.errors)}`).toBe(1);
        const pushedSha = result.syncedPaths.find(entry => entry.path === path)?.sha;
        if (!pushedSha) throw new Error(`baseline push of ${path} did not report a sha`);
        const remote = await this.verifier.getFile(path, this.branch);
        expect(remote?.sha, 'verifier blob sha must match the pushed blob sha for baseline mirroring').toBe(pushedSha);
        this.b.vault.writeLocal(path, content);
        this.b.settings.syncMetadata[path] = {
            lastSyncedSha: pushedSha,
            lastSyncedAt: Date.now(),
            lastKnownPath: path,
        };
    }

    // --- independent remote assertions (via the git-CLI verifier) ----------

    async remoteContent(path: string): Promise<{ content: string; sha: string } | null> {
        return this.verifier.getFile(path, this.branch);
    }

    async remoteExists(path: string): Promise<boolean> {
        return !(await this.verifier.fileMissing(path, this.branch));
    }

    async expectRemoteContent(path: string, expected: string): Promise<void> {
        const remote = await this.verifier.getFile(path, this.branch);
        expect(remote?.content, `remote content for ${path}`).toBe(expected);
    }

    async expectRemoteMissing(path: string): Promise<void> {
        expect(await this.verifier.fileMissing(path, this.branch), `expected ${path} missing on remote`).toBe(true);
    }

    /** Newest-first commit shas on the isolated branch (independent of the service). */
    listCommitShas(count: number): Promise<string[]> {
        return this.verifier.listCommitShas(this.branch, count);
    }

    async head(): Promise<string> {
        const [tip] = await this.verifier.listCommitShas(this.branch, 1);
        return tip!;
    }

    private get verifier(): GitVerifierType {
        return this.fixture.verifier;
    }
}