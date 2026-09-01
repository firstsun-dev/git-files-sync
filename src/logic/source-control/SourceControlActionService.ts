import type { SyncWorkspace } from '../sync/SyncWorkspace';
import { type SyncExecutionResult, type SyncResultNotificationPort } from './SyncResultNotifier';
import type { ChangeRepository } from './ChangeRepository';
import type { OperationState } from './OperationState';
import type { SourceControlItem } from './SourceControlViewModel';
import { SyncIntentExecutor } from './SyncIntentExecutor';
import type { SyncIntentRequest } from './SyncIntent';
import type { ChangeId, SyncChange } from './types';

export type { SyncIntentRequest } from './SyncIntent';

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
 */
export class SourceControlActionService {
    private readonly syncIntentExecutor: SyncIntentExecutor;

    constructor(
        private readonly changes: ChangeRepository,
        private readonly operations: OperationState,
        private readonly workspace: SyncWorkspace,
        private readonly syncResultNotifier: SyncResultNotificationPort = { notify: () => {} },
    ) {
        this.syncIntentExecutor = new SyncIntentExecutor(
            changes,
            operations,
            workspace,
            syncResultNotifier,
        );
    }

    /** Pushes one or more changes (single push and batch push share this path). */
    async push(changeIds: readonly ChangeId[]): Promise<void> {
        const targets = this.resolve(changeIds);
        if (targets.length === 0) return;

        this.startAll(targets);
        try {
            const results = await this.workspace.push(targets.map(target => target.path));
            const failed = new Set(results.errors.map(error => error.file));
            this.finishAll(targets, path => failed.has(path) ? 'failed' : 'success');
        } catch {
            this.failAll(targets);
        }
    }

    /** Pulls one or more changes. */
    async pull(changeIds: readonly ChangeId[]): Promise<void> {
        const targets = this.resolve(changeIds);
        if (targets.length === 0) return;

        this.startAll(targets);
        try {
            const results = await this.workspace.pull(targets.map(target => target.path));
            const failed = new Set(results.errors.map(error => error.file));
            this.finishAll(targets, path => failed.has(path) ? 'failed' : 'success');
        } catch {
            this.failAll(targets);
        }
    }

    /** Deletes one or more changes from the remote only. */
    async deleteRemote(changeIds: readonly ChangeId[]): Promise<void> {
        const targets = this.resolve(changeIds);
        if (targets.length === 0) return;

        this.startAll(targets);
        try {
            const result = await this.workspace.deleteRemote(targets.map(target => target.path));
            const failed = new Set(result.errors.map(error => error.path));
            this.finishAll(targets, path => failed.has(path) ? 'failed' : 'success');
        } catch {
            this.failAll(targets);
        }
    }

    /**
     * Executes the whole Sync Queue as one explicit-intent workflow.
     * Kept as the stable UI-facing facade; orchestration lives in
     * SyncIntentExecutor.
     */
    async sync(intents: readonly SyncIntentRequest[]): Promise<void> {
        await this.syncIntentExecutor.execute(intents);
    }

    /** Deletes one or more changes from the local vault only. */
    async deleteLocal(changeIds: readonly ChangeId[]): Promise<void> {
        const targets = this.resolve(changeIds);
        for (const target of targets) {
            this.operations.start(target.id);
            try {
                await this.workspace.deleteLocal(target.path);
                this.operations.succeed(target.id);
            } catch {
                this.operations.fail(target.id);
            }
        }
    }

    /**
     * Resolves a single conflict by keeping the local or reviewed remote
     * version. Remote resolution uses the explicit acceptRemoteConflict
     * boundary so it does not re-enter planning and show a second modal.
     */
    async resolveConflict(changeId: ChangeId, resolution: ConflictResolution): Promise<void> {
        const change = this.changes.getById(changeId);
        if (!change) return;

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
