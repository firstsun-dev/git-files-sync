import { expect } from 'vitest';
import type { TFile } from 'obsidian';
import type { GitServiceInterface } from '../../../src/services/git-service-interface';
import type { GitLabFilesPushSettings } from '../../../src/settings';
import type { BatchPushConflict, ConflictResolution, PushResults } from '../../../src/logic/sync/types';
import type { SyncManager } from '../../../src/logic/sync-manager';
import type { FileStatus } from '../../../src/logic/sync-status-service';
import type { GitVerifier } from './git-verifier';
import type { FakeVault, TFileLike, TFileCtor } from '../shim/fake-vault';
import { fakeApp } from '../shim/fake-vault';
import { SyncStatusRefreshService } from '../../../src/logic/sync/SyncStatusRefreshService';
import { SyncStatusService } from '../../../src/logic/sync-status-service';
import { GitignoreManager } from '../../../src/logic/gitignore-manager';
import { ensureSyncWorkspaceRuntime } from '../../../src/logic/sync/SyncWorkspace';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { SyncSelectionStore } from '../../../src/logic/source-control/SyncSelectionStore';
import { SourceControlActionService } from '../../../src/logic/source-control/SourceControlActionService';
import { toSyncChanges } from '../../../src/logic/source-control/FileStatusAdapter';
import {
    filterFilesByVaultFolder,
    filterPathByVaultFolder,
    getNormalizedVaultPath,
    getVaultPathFromNormalized,
} from '../../../src/logic/sync/vault-folder-scope';
import { timed } from './timing-diagnostics';

/**
 * The provider-level fixtures the two-client scenario shares across clients.
 * `newVault`/`newSettings`/`newManager` return FRESH instances per call — two
 * clients must never share a vault, a settings object, or a SyncManager.
 */
export interface TwoClientFixture {
    readonly service: GitServiceInterface;
    readonly branch: string;
    readonly verifier: GitVerifier;
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
    /**
     * The SAME `SyncStatusService` instance `manager` pushes/pulls through
     * (mirroring `main.ts`'s `this.sync.status` wiring), not a separate one —
     * a push's `SyncMetadataStore.update` calls `status.markSynced(path, sha)`
     * on the manager's own instance, so a status map built from a different
     * instance would never see a row flip to `synced` after its own push.
     */
    private readonly statuses: SyncStatusService;
    private readonly repository = new ChangeRepository();
    private readonly selection = new SyncSelectionStore();
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
        this.statuses = this.manager.status;
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
                // Real production vaultFolder scoping (shared with src/main.ts
                // and SyncScanner via src/logic/sync/vault-folder-scope) —
                // this fixture's settings set vaultFolder to this run's own
                // `e2e-tc-<runId>` namespace, so this scopes local discovery
                // to this client's own files exactly like a real vault
                // subfolder mount would.
                filterFilesByVaultFolder: files => filterFilesByVaultFolder(files, this.settings.vaultFolder),
                filterPathByVaultFolder: path => filterPathByVaultFolder(path, this.settings.vaultFolder),
                getNormalizedPath: path => getNormalizedVaultPath(path, this.settings.vaultFolder),
                getVaultPath: normalizedPath => getVaultPathFromNormalized(normalizedPath, this.settings.vaultFolder),
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
        this.actionService = new SourceControlActionService(this.repository, this.selection, this.operations, workspace);
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
        await timed(`refresh ${this.name}`, () => this.refreshService.refresh());
        this.repository.replace(toSyncChanges([...this.statuses.values()]));
        this.assertScopeIsolation();
    }

    /**
     * Fail-fast guard: every change refresh() surfaces must belong to this
     * run's own `e2e-tc-<runId>` namespace. If fixture/rootPath scoping ever
     * regresses, this throws immediately instead of the suite timing out
     * (or, worse, silently asserting on another suite's leaked remote files).
     */
    private assertScopeIsolation(): void {
        const prefix = `e2e-tc-${this.fixture.runId}/`;
        for (const change of this.repository.getAll()) {
            expect(
                change.path.startsWith(prefix),
                `client ${this.name} refresh() surfaced an out-of-scope change: ${change.path} (expected prefix ${prefix})`,
            ).toBe(true);
        }
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
        const intents = this.repository.getAll().map(change => ({ changeId: change.id }));
        await timed(`sync ${this.name}`, () => this.actionService.sync(intents));
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
        await this.baselineBatch([{ path, content }]);
    }

    /** Establishes a common multi-file baseline with one remote commit. */
    async baselineBatch(entries: Array<{ path: string; content: string }>): Promise<void> {
        for (const entry of entries) this.a.write(entry.path, entry.content);
        const result = await timed('baseline batch', () => this.a.manager.pushFiles(entries.map(entry => entry.path)));
        expect(result.success, `batch baseline failed: ${JSON.stringify(result.errors)}`).toBe(entries.length);
        expect(result.failed, 'batch baseline must not fail').toBe(0);

        const snapshot = await this.verifier.snapshot(this.branch);
        for (const entry of entries) {
            const pushedSha = result.syncedPaths.find(resultEntry => resultEntry.path === entry.path)?.sha;
            if (!pushedSha) throw new Error(`batch baseline did not report a sha for ${entry.path}`);
            const remote = snapshot.getFile(entry.path);
            expect(remote?.sha, `verifier blob sha for ${entry.path} must match the pushed blob sha`).toBe(pushedSha);
            this.b.vault.writeLocal(entry.path, entry.content);
            this.b.settings.syncMetadata[entry.path] = {
                lastSyncedSha: pushedSha,
                lastSyncedAt: Date.now(),
                lastKnownPath: entry.path,
            };
        }
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

    private get verifier(): GitVerifier {
        return this.fixture.verifier;
    }
}
