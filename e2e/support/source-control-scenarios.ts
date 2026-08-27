import { expect } from 'vitest';
import type { TFile } from 'obsidian';
import type { GitServiceInterface } from '../../src/services/git-service-interface';
import type { SyncManager } from '../../src/logic/sync-manager';
import type { BatchPushConflict, ConflictResolution, PushResults } from '../../src/logic/sync/types';
import type { GitLabFilesPushSettings } from '../../src/settings';
import type { FakeVault, TFileLike } from '../shim/fake-vault';
import type { SyncManagerFixture } from './sync-manager-fixture';
import type { GitVerifier as GitVerifierType } from '../verifier-runtime-types';
import { ChangeRepository } from '../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../src/logic/source-control/OperationState';
import { SyncSelectionStore } from '../../src/logic/source-control/SyncSelectionStore';
import { SourceControlActionService } from '../../src/logic/source-control/SourceControlActionService';
import { BoundarySyncWorkspace } from '../../src/logic/sync/SyncWorkspace';
import { toChangeId, type SyncChange } from '../../src/logic/source-control/types';
import type { SyncStatusRefreshResult } from '../../src/logic/sync/SyncStatusRefreshService';
import type { RemoteDeleteResult } from '../../src/logic/sync/RemoteDeleteExecutor';
import type { FileDiff } from '../../src/logic/sync/types';
import type { GitTreeEntry } from '../../src/services/git-service-interface';

/**
 * High-level scenario wrapper around a {@link SyncManagerFixture}: owns one
 * FakeVault + settings + real SyncManager for a test, and exposes the
 * seed/modify/assert verbs the source-control-flow suites use, so a test reads
 * as `seed → modify local → modify remote → push → expect` instead of 50 lines
 * of setup. Remote assertions always go through the fixture's independent
 * git-CLI verifier, never the service under test.
 *
 * One scenario per test; paths are supplied by the caller (via
 * `fixture.path`) so two scenarios can share a remote path when a test needs a
 * fresh manager against pre-seeded remote state.
 */
export class SourceControlScenario {
    readonly vault: FakeVault;
    readonly settings: GitLabFilesPushSettings;
    readonly manager: SyncManager;
    private readonly service: GitServiceInterface;
    private readonly verifier: GitVerifierType;
    private readonly branch: string;
    /**
     * Memoizes remote reads (each of which is a real `git fetch` round trip)
     * between remote mutations. Invalidated by `invalidatingProxy` below
     * whenever `manager.pushFiles`/`pullFile`/`commitResolvedBatch` or
     * `service.pushFile`/`deleteFile` is called on the wrapped instances this
     * scenario hands out — including indirectly, e.g. via the selection
     * stack's `actionService.push`, which calls `manager.pushFiles` through
     * `BoundarySyncWorkspace` rather than through this class's own `push()`,
     * and `actionService.sync`, which commits pushes/moves/deletions through
     * `manager.commitResolvedBatch` instead of `pushFiles`. Wrapping the
     * instances themselves (instead of only this class's wrapper methods) is
     * what makes those indirect paths safe to cache too.
     */
    private readonly remoteCache = new Map<string, unknown>();

    constructor(fixture: SyncManagerFixture) {
        this.vault = fixture.createVault();
        this.settings = fixture.makeSettings();
        const invalidate = (): void => this.remoteCache.clear();
        this.manager = invalidatingProxy(fixture.newManager(this.vault, this.settings), ['pushFiles', 'pullFile', 'commitResolvedBatch'], invalidate);
        this.service = invalidatingProxy(fixture.service, ['pushFile', 'deleteFile'], invalidate);
        this.verifier = fixture.verifier;
        this.branch = fixture.branch;
    }

    /** Runs `fn` once and memoizes it under `key` until the next remote mutation. */
    private async cachedRemote<T>(key: string, fn: () => Promise<T>): Promise<T> {
        if (this.remoteCache.has(key)) return this.remoteCache.get(key) as T;
        const value = await fn();
        this.remoteCache.set(key, value);
        return value;
    }

    // --- local vault ops -------------------------------------------------

    writeLocal(path: string, content: string | ArrayBuffer): void {
        this.vault.writeLocal(path, content);
    }

    deleteLocal(path: string): void {
        this.vault.removeLocal(path);
    }

    renameLocal(oldPath: string, newPath: string): void {
        this.vault.renameLocal(oldPath, newPath);
    }

    /** Real TFile handle for a path in this vault (needed so push rename-detection runs). */
    tfile(path: string): TFileLike {
        return this.vault.fileAt(path);
    }

    localExists(path: string): boolean {
        return this.vault.has(path);
    }

    async readLocal(path: string): Promise<string> {
        return this.vault.adapter.read(path);
    }

    // --- remote ops (via the real production service) --------------------

    /** Seeds the remote directly, bypassing SyncManager — no local file, no metadata. */
    async seedRemote(path: string, content: string | ArrayBuffer): Promise<void> {
        await this.service.pushFile(path, content, this.branch, 'e2e: seed remote');
    }

    /** Overwrites the remote path with new content, reading the current sha first (like another client pushing). */
    async modifyRemote(path: string, content: string | ArrayBuffer): Promise<void> {
        const current = await this.verifier.getFile(path, this.branch);
        await this.service.pushFile(path, content, this.branch, 'e2e: modify remote', current?.sha);
    }

    async deleteRemoteFile(path: string): Promise<void> {
        await this.service.deleteFile(path, this.branch, 'e2e: delete remote');
    }

    // --- baseline (push through the manager to establish synced metadata) ---

    /** Writes locally and pushes via the manager, establishing a synced baseline (local == remote + metadata). */
    async baseline(path: string, content: string | ArrayBuffer): Promise<PushResults> {
        this.writeLocal(path, content);
        return this.manager.pushFiles([path]);
    }

    // --- sync actions ----------------------------------------------------

    /** Pushes via the real manager. Accepts TFile handles (for rename detection) or plain paths. */
    async push(files: (TFileLike | string)[]): Promise<PushResults> {
        return this.manager.pushFiles(files as unknown as (TFile | string)[]);
    }

    async pullFile(path: string): Promise<void> {
        await this.manager.pullFile(path);
    }

    // --- independent remote assertions (via the git-CLI verifier) --------

    async remoteContent(path: string): Promise<{ content: string; sha: string } | null> {
        return this.cachedRemote(`file:${path}`, () => this.verifier.getFile(path, this.branch));
    }

    async expectRemoteContent(path: string, expected: string): Promise<void> {
        const remote = await this.cachedRemote(`file:${path}`, () => this.verifier.getFile(path, this.branch));
        expect(remote?.content, `remote content for ${path}`).toBe(expected);
    }

    async expectRemoteMissing(path: string): Promise<void> {
        expect(await this.cachedRemote(`missing:${path}`, () => this.verifier.fileMissing(path, this.branch)), `expected ${path} missing on remote`).toBe(true);
    }

    async expectRemoteExists(path: string): Promise<void> {
        expect(await this.cachedRemote(`missing:${path}`, () => this.verifier.fileMissing(path, this.branch)), `expected ${path} present on remote`).toBe(false);
    }

    /** Current branch tip sha. */
    async head(): Promise<string> {
        const [tip] = await this.cachedRemote('shas:2', () => this.verifier.listCommitShas(this.branch, 2));
        return tip!;
    }

    /** Newest-first commit shas on the branch (independent of the service). */
    async listCommitShas(count: number): Promise<string[]> {
        if (count <= 2) {
            const shas = await this.cachedRemote('shas:2', () => this.verifier.listCommitShas(this.branch, 2));
            return shas.slice(0, count);
        }
        return this.verifier.listCommitShas(this.branch, count);
    }

    /** Asserts exactly one new commit landed since `headBefore` (the new commit's parent is `headBefore`). */
    async expectSingleCommitSince(headBefore: string): Promise<void> {
        const [headAfter, headAfterParent] = await this.cachedRemote('shas:2', () => this.verifier.listCommitShas(this.branch, 2));
        expect(headAfter, 'expected a new commit on the branch').not.toBe(headBefore);
        expect(headAfterParent, 'expected exactly one new commit since baseline').toBe(headBefore);
    }

    /** Asserts no new commit landed since `headBefore`. */
    async expectNoCommitSince(headBefore: string): Promise<void> {
        expect(await this.head(), 'expected no new commit').toBe(headBefore);
    }

    async commitMessage(sha: string): Promise<string> {
        return this.verifier.getCommitMessage(sha);
    }

    // --- metadata --------------------------------------------------------

    metadata(path: string) {
        return this.settings.syncMetadata[path];
    }

    metadataSha(path: string): string | undefined {
        return this.settings.syncMetadata[path]?.lastSyncedSha;
    }

    // --- Source Control selection stack (Phase 6) -----------------------

    /**
     * Wires the real Source Control selection layer (ChangeRepository +
     * SyncSelectionStore + OperationState + SourceControlActionService) on top
     * of this scenario's real SyncManager, via the thin BoundarySyncWorkspace.
     * `push`/`pull`/`deleteRemote` go through the real manager/provider; the
     * selection filter (ChangeId -> path -> workspace call) is the real
     * production code under test.
     */
    selectionStack(changes: SyncChange[]): SelectionStack {
        const repository = new ChangeRepository();
        repository.replace(changes);
        const selection = new SyncSelectionStore();
        const operations = new OperationState();
        const workspace = new BoundarySyncWorkspace(
            () => this.manager,
            {
                refresh: (): Promise<SyncStatusRefreshResult> => Promise.resolve({
                    localCount: 0, remoteCount: 0, remoteEntries: [] as GitTreeEntry[],
                }),
                deleteRemote: (): Promise<RemoteDeleteResult> => Promise.resolve({ deletedPaths: [], errors: [] }),
                getDiff: (): Promise<FileDiff> => Promise.resolve({ path: '', kind: 'text' } as FileDiff),
            },
        );
        const actionService = new SourceControlActionService(repository, operations, workspace);
        return { repository, selection, operations, actionService, workspace };
    }
}

export interface SelectionStack {
    readonly repository: ChangeRepository;
    readonly selection: SyncSelectionStore;
    readonly operations: OperationState;
    readonly actionService: SourceControlActionService;
    readonly workspace: BoundarySyncWorkspace;
}

/**
 * Wraps `target` so that calling any method named in `mutatingMethods` still
 * behaves exactly as before, but also invokes `onMutation` once the call
 * resolves. Every other property/method passes through untouched. Used to
 * invalidate SourceControlScenario's remote-read cache on every path that
 * can mutate the remote — including ones this file doesn't call directly
 * (e.g. BoundarySyncWorkspace invoking `manager.pushFiles`).
 */
function invalidatingProxy<T extends object>(target: T, mutatingMethods: (keyof T)[], onMutation: () => void): T {
    return new Proxy(target, {
        get(obj, prop, receiver): unknown {
            const value: unknown = Reflect.get(obj, prop, receiver);
            if (typeof value !== 'function') return value;
            if (!mutatingMethods.includes(prop as keyof T)) return value.bind(obj);
            return async (...args: unknown[]) => {
                const result: unknown = await (value as (...a: unknown[]) => unknown).apply(obj, args);
                onMutation();
                return result;
            };
        },
    });
}

/** Builds a SyncChange with a path-derived ChangeId (mirrors FileStatusAdapter). */
export function change(path: string, kind: SyncChange['kind'], previousPath?: string): SyncChange {
    return { id: toChangeId(path), path, kind, previousPath };
}

export type { ConflictResolution, BatchPushConflict };