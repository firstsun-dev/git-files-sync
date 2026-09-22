import type { SyncWorkspace } from '../sync/SyncWorkspace';
import { type SyncExecutionResult, type SyncResultNotificationPort } from './SyncResultNotifier';
import type { ChangeRepository } from './ChangeRepository';
import type { OperationState } from './OperationState';
import type { SourceControlItem } from './SourceControlViewModel';
import type { SyncSelectionStore } from './SyncSelectionStore';
import { defaultSyncAction, type SyncAction } from './ChangeActionPolicy';
import { SyncIntentExecutor, type SyncExecutionMode, type SyncExecutionOutcome } from './SyncIntentExecutor';
import { SyncExecutionGuard } from './SyncExecutionGuard';
import type { SyncIntentRequest } from './SyncIntent';
import type { ChangeId, SyncChange } from './types';

export type { SyncIntentRequest } from './SyncIntent';
export type { SyncExecutionOutcome } from './SyncIntentExecutor';

/** Handle given to a background transaction that already owns the execution guard. */
export interface BackgroundSyncSession {
    /** Executes intents in background mode without re-acquiring the (non-reentrant) guard. */
    sync(intents: readonly SyncIntentRequest[]): Promise<SyncExecutionOutcome>;
}

export type BackgroundRunOutcome<T> =
    | { status: 'skipped-busy' }
    | { status: 'completed'; value: T };

/** Which side wins when resolving a change in the 'conflict' state. */
export type ConflictResolution = 'local' | 'remote';

/** Diff payload the Source Control diff pane can render directly (text-only; binary/symlink changes resolve to `null`). */
export interface SourceControlDiffContent {
    remote: string;
    local: string;
}

/**
 * Application facade for immediate Source Control actions.
 *
 * Immediate row actions (push / pull / delete / conflict / diff) stay here.
 * The Sync Queue's multi-step intent workflow is delegated to
 * {@link SyncIntentExecutor}, so this facade no longer owns plan merging,
 * confirmation, remote-bucket execution, pull-bucket execution, and result
 * aggregation at the same time.
 *
 * Neither layer talks to a Git provider directly; SyncWorkspace remains the
 * execution boundary.
 *
 * Also owns the Sync Queue selection/action-override mutation boundary
 * (select/deselect, set/clear a row's action override) on behalf of
 * SyncSelectionStore, so the UI never reaches past this facade into that
 * store directly.
 */
export class SourceControlActionService {
    private readonly syncIntentExecutor: SyncIntentExecutor;
    /**
     * Serializes every provider-mutating operation (the Sync Queue workflow and
     * the immediate row actions) against automatic sync. User-triggered work
     * waits for the lock; automatic work try-acquires and skips when busy.
     */
    private readonly guard = new SyncExecutionGuard();

    constructor(
        private readonly changes: ChangeRepository,
        private readonly selection: SyncSelectionStore,
        private readonly operations: OperationState,
        private readonly workspace: SyncWorkspace,
        private readonly syncResultNotifier: SyncResultNotificationPort = { notify: () => {} },
    ) {
        this.syncIntentExecutor = new SyncIntentExecutor(
            changes,
            operations,
            workspace,
            syncResultNotifier,
            this.guard,
        );
    }

    /** Runs `operation` while holding the shared execution guard (manual semantics: waits, never discards). */
    private async serialized<T>(operation: () => Promise<T>): Promise<T> {
        const release = await this.guard.acquire();
        try {
            return await operation();
        } finally {
            release();
        }
    }

    /**
     * Serialization boundary for legacy/manual entry points that still call
     * SyncManager directly (ribbon, commands, file context menu, Push/Pull All).
     * Uses the SAME guard as every other operation here (manual semantics:
     * waits, never discards).
     *
     * The guard is non-reentrant: never wrap sync()/push()/pull()/deleteRemote()/
     * deleteLocal()/resolveConflict()/runBackground() in this — they already
     * acquire it, so doing so would deadlock.
     */
    async runManual<T>(operation: () => Promise<T>): Promise<T> {
        return this.serialized(operation);
    }

    /** Adds one change to the Sync Queue. */
    selectForSync(changeId: ChangeId): void {
        this.selection.selectForSync(changeId);
    }

    /** Removes one change from the Sync Queue, clearing any action override with it. */
    deselectFromSync(changeId: ChangeId): void {
        this.selection.deselectFromSync(changeId);
    }

    /** Adds several changes to the Sync Queue in one batch (e.g. a folder checkbox). */
    selectMany(changeIds: readonly ChangeId[]): void {
        this.selection.selectMany(changeIds);
    }

    /** Removes several changes from the Sync Queue in one batch. */
    deselectMany(changeIds: readonly ChangeId[]): void {
        this.selection.deselectMany(changeIds);
    }

    /**
     * Sets a Sync Queue row's explicit action override. Picking the kind's
     * own default clears the override instead of storing a redundant one, so
     * `SourceControlItem.hasActionOverride` only means "the user chose
     * something other than the default".
     */
    setSyncAction(changeId: ChangeId, action: SyncAction): void {
        const change = this.changes.getById(changeId);
        if (!change) return;

        if (action === defaultSyncAction(change.kind)) {
            this.selection.clearActionOverride(changeId);
        } else {
            this.selection.setActionOverride(changeId, action);
        }
    }

    /** Clears a Sync Queue row's explicit action override, reverting it to the kind default. */
    clearSyncAction(changeId: ChangeId): void {
        this.selection.clearActionOverride(changeId);
    }

    /** Pushes one or more changes (single push and batch push share this path). */
    async push(changeIds: readonly ChangeId[]): Promise<void> {
        const targets = this.resolve(changeIds);
        if (targets.length === 0) return;

        this.startAll(targets);
        await this.serialized(async () => {
            try {
                const results = await this.workspace.push(targets.map(target => target.path));
                const failed = new Set(results.errors.map(error => error.file));
                this.finishAll(targets, path => failed.has(path) ? 'failed' : 'success');
            } catch {
                this.failAll(targets);
            }
        });
    }

    /** Pulls one or more changes. */
    async pull(changeIds: readonly ChangeId[]): Promise<void> {
        const targets = this.resolve(changeIds);
        if (targets.length === 0) return;

        this.startAll(targets);
        await this.serialized(async () => {
            try {
                const results = await this.workspace.pull(targets.map(target => target.path));
                const failed = new Set(results.errors.map(error => error.file));
                this.finishAll(targets, path => failed.has(path) ? 'failed' : 'success');
            } catch {
                this.failAll(targets);
            }
        });
    }

    /** Deletes one or more changes from the remote only. */
    async deleteRemote(changeIds: readonly ChangeId[]): Promise<void> {
        const targets = this.resolve(changeIds);
        if (targets.length === 0) return;

        this.startAll(targets);
        await this.serialized(async () => {
            try {
                const result = await this.workspace.deleteRemote(targets.map(target => target.path));
                const failed = new Set(result.errors.map(error => error.path));
                this.finishAll(targets, path => failed.has(path) ? 'failed' : 'success');
            } catch {
                this.failAll(targets);
            }
        });
    }

    /**
     * Executes the whole Sync Queue as one explicit-intent workflow.
     * Kept as the stable UI-facing facade; orchestration lives in
     * SyncIntentExecutor. `mode` is per-execution: manual Sync stays
     * interactive, Automatic Sync passes `background`.
     */
    async sync(
        intents: readonly SyncIntentRequest[],
        mode: SyncExecutionMode = 'interactive',
    ): Promise<SyncExecutionOutcome> {
        return this.syncIntentExecutor.execute(intents, mode);
    }

    /**
     * Runs a whole background transaction (refresh -> execute -> refresh)
     * under one hold of the shared guard. If the guard is busy the task is
     * never invoked and nothing is queued, so a busy tick costs zero provider
     * work. Because the guard hands its lock straight to the next waiter, a
     * waiting manual operation still wins over a later automatic tick.
     */
    async runBackground<T>(task: (session: BackgroundSyncSession) => Promise<T>): Promise<BackgroundRunOutcome<T>> {
        const release = this.guard.tryAcquire();
        if (!release) return { status: 'skipped-busy' };
        try {
            const value = await task({
                sync: intents => this.syncIntentExecutor.executeHeld(intents, 'background'),
            });
            return { status: 'completed', value };
        } finally {
            release();
        }
    }

    /** Deletes one or more changes from the local vault only. */
    async deleteLocal(changeIds: readonly ChangeId[]): Promise<void> {
        const targets = this.resolve(changeIds);
        await this.serialized(async () => {
            for (const target of targets) {
                this.operations.start(target.id);
                try {
                    await this.workspace.deleteLocal(target.path);
                    this.operations.succeed(target.id);
                } catch {
                    this.operations.fail(target.id);
                }
            }
        });
    }

    /**
     * Resolves a single conflict by keeping the local or reviewed remote
     * version. Remote resolution uses the explicit acceptRemoteConflict
     * boundary so it does not re-enter planning and show a second modal.
     */
    async resolveConflict(changeId: ChangeId, resolution: ConflictResolution): Promise<void> {
        const change = this.changes.getById(changeId);
        if (!change) return;

        await this.serialized(() => this.resolveConflictLocked(change, resolution));
    }

    private async resolveConflictLocked(change: SyncChange, resolution: ConflictResolution): Promise<void> {
        const changeId = change.id;
        this.operations.start(changeId);
        try {
            if (resolution === 'local') {
                const results = await this.workspace.push([change.path]);
                if (results.errors.length > 0) {
                    throw new Error(results.errors.map(error => error.error).join('; '));
                }
                this.operations.succeed(changeId);
                this.syncResultNotifier.notify({ ...emptyExecutionResult(), updated: 1 });
            } else {
                await this.workspace.acceptRemoteConflict(change.path);
                this.operations.succeed(changeId);
                this.syncResultNotifier.notify({ ...emptyExecutionResult(), acceptedRemote: 1 });
            }
        } catch {
            this.operations.fail(changeId);
            this.syncResultNotifier.notify({ ...emptyExecutionResult(), failed: 1 });
        }
    }

    /** Loads text diff content for the Source Control diff surface. */
    async loadDiffContent(item: SourceControlItem): Promise<SourceControlDiffContent | null> {
        const diff = await this.workspace.getDiff(item.path);
        if (typeof diff.remoteContent !== 'string' || typeof diff.localContent !== 'string') return null;
        return { remote: diff.remoteContent, local: diff.localContent };
    }

    /** Resolves ChangeIds against the repository's current snapshot, dropping stale ids. */
    private resolve(changeIds: readonly ChangeId[]): SyncChange[] {
        const targets: SyncChange[] = [];
        for (const id of changeIds) {
            const change = this.changes.getById(id);
            if (change) targets.push(change);
        }
        return targets;
    }

    private startAll(targets: readonly SyncChange[]): void {
        for (const target of targets) this.operations.start(target.id);
    }

    private finishAll(
        targets: readonly SyncChange[],
        statusFor: (path: string) => 'success' | 'failed',
    ): void {
        for (const target of targets) {
            if (statusFor(target.path) === 'success') this.operations.succeed(target.id);
            else this.operations.fail(target.id);
        }
    }

    private failAll(targets: readonly SyncChange[]): void {
        for (const target of targets) this.operations.fail(target.id);
    }
}

function emptyExecutionResult(): SyncExecutionResult {
    return {
        added: 0,
        updated: 0,
        moved: 0,
        deleted: 0,
        downloaded: 0,
        acceptedRemote: 0,
        failed: 0,
        conflicts: 0,
        skippedConflicts: 0,
        errors: [],
    };
}
