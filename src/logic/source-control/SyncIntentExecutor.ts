import type { PlannedPushBatch } from '../sync/PushCoordinator';
import type { SyncWorkspace } from '../sync/SyncWorkspace';
import {
    isSyncPlanEmpty,
    type DeleteQueueEntry,
    type PushResults,
    type SyncPlan,
    type SyncPlanEntry,
} from '../sync/types';
import { resolveSyncAction, type SyncAction } from './ChangeActionPolicy';
import type { ChangeRepository } from './ChangeRepository';
import type { OperationState } from './OperationState';
import type { SyncExecutionResult, SyncResultNotificationPort } from './SyncResultNotifier';
import type { SyncIntentRequest } from './SyncIntent';
import { SyncExecutionGuard } from './SyncExecutionGuard';
import type { SyncChange } from './types';

interface ResolvedSyncIntent {
    change: SyncChange;
    action: SyncAction;
}

interface SyncIntentBuckets {
    push: SyncChange[];
    pull: SyncChange[];
    deleteRemote: SyncChange[];
}

interface ConfirmedSyncPlan {
    plannedPush: PlannedPushBatch;
    confirmed: boolean;
}

/**
 * Per-execution interaction policy for the shared Sync Queue path.
 *
 * - `interactive` (manual Sync): unchanged behavior -- one merged plan, one
 *   confirmation modal, batch conflict interaction, and a result notice.
 * - `background` (automatic sync): build/validate the same plan but
 *   auto-accept it, never open a conflict modal, skip conflicting paths
 *   instead of aborting, and stay silent on success. Errors are still logged
 *   by the caller.
 *
 * This is deliberately an explicit mode rather than a set of independent
 * booleans, so invalid combinations (e.g. confirm + showConflictModal) can't
 * be expressed.
 */
export type SyncExecutionMode = 'interactive' | 'background';

/**
 * Executes the Sync Queue use-case from explicit user intent.
 *
 * This class owns only the queued/batched workflow: resolve each ChangeId
 * against the current repository snapshot, re-validate the requested action,
 * build one merged review plan, confirm once, commit the remote mutation
 * bucket once, then apply the local-only pull bucket. Immediate row actions
 * remain on SourceControlActionService.
 *
 * Keeping this orchestration behind a dedicated boundary prevents
 * SourceControlActionService from becoming the place where every Source
 * Control concern accumulates, while preserving the existing SyncWorkspace
 * execution boundary and provider behavior.
 */
export class SyncIntentExecutor {
    constructor(
        private readonly changes: ChangeRepository,
        private readonly operations: OperationState,
        private readonly workspace: SyncWorkspace,
        private readonly notifier: SyncResultNotificationPort = { notify: () => {} },
        private readonly guard: SyncExecutionGuard = new SyncExecutionGuard(),
    ) {}

    async execute(intents: readonly SyncIntentRequest[], mode: SyncExecutionMode = 'interactive'): Promise<void> {
        // Serialize automatic mutations against user-triggered ones. Automatic
        // work skips its tick entirely when the path is busy; manual work waits
        // so a user action is never discarded.
        const release = mode === 'background' ? this.guard.tryAcquire() : await this.guard.acquire();
        if (!release) return;

        try {
            await this.executeLocked(intents, mode);
        } finally {
            release();
        }
    }

    private async executeLocked(intents: readonly SyncIntentRequest[], mode: SyncExecutionMode): Promise<void> {
        const resolved = this.resolveIntents(intents);
        if (resolved.length === 0) return;

        const targets = resolved.map(entry => entry.change);
        const buckets = this.bucket(resolved);

        let plan: ConfirmedSyncPlan | null;
        try {
            plan = await this.planAndConfirm(buckets, mode);
        } catch {
            this.failAll(targets);
            if (mode !== 'background') this.notifier.notify({ ...emptyExecutionResult(), failed: targets.length });
            return;
        }

        if (!plan || !plan.confirmed) return;

        // Paths the planner left out because they still need manual conflict
        // resolution. They must never be reported as successfully synced or
        // transitioned to operation success merely because they were in the
        // original target set -- after the final refresh they remain conflicts.
        const skippedPaths = new Set(plan.plannedPush.conflictedPaths);

        this.startAll(targets);
        const summary = emptyExecutionResult();

        if (hasRemoteMutations(plan.plannedPush, buckets.deleteRemote)) {
            await this.commitRemoteBucket(plan.plannedPush, buckets.push, buckets.deleteRemote, summary, skippedPaths);
        }
        if (buckets.pull.length > 0) {
            await this.applyPullBucket(buckets.pull, summary, skippedPaths);
        }

        // Any skipped/conflicted target that a commit or pull may have marked
        // (or left running) is reset to idle rather than success/failure.
        for (const target of targets) {
            if (skippedPaths.has(target.path)) this.operations.reset(target.id);
        }

        if (mode !== 'background') this.notifier.notify(summary);
    }

    private resolveIntents(intents: readonly SyncIntentRequest[]): ResolvedSyncIntent[] {
        const resolved: ResolvedSyncIntent[] = [];
        for (const intent of intents) {
            const change = this.changes.getById(intent.changeId);
            if (!change) continue;
            resolved.push({
                change,
                action: resolveSyncAction(change.kind, intent.action),
            });
        }
        return resolved;
    }

    private bucket(intents: readonly ResolvedSyncIntent[]): SyncIntentBuckets {
        const buckets: SyncIntentBuckets = { push: [], pull: [], deleteRemote: [] };
        for (const { change, action } of intents) {
            if (action === 'pull') buckets.pull.push(change);
            else if (action === 'delete-remote') buckets.deleteRemote.push(change);
            else buckets.push.push(change);
        }
        return buckets;
    }

    private async planAndConfirm(
        buckets: SyncIntentBuckets,
        mode: SyncExecutionMode,
    ): Promise<ConfirmedSyncPlan | null> {
        // The execution policy is per-run: interactive planning may prompt and
        // cancel the batch on conflict, background planning skips conflicts and
        // continues with the safe paths. Both validate the normal sync plan.
        const conflictBehavior = mode === 'background' ? 'skip' : 'prompt';
        const plannedPush = buckets.push.length > 0
            ? await this.workspace.planPush(buckets.push.map(change => change.path), conflictBehavior)
            : emptyPlannedBatch();

        // An interactive batch may be aborted by cancelling conflict
        // resolution; background planning never returns `cancelled`.
        if (plannedPush.cancelled) return null;

        const pullPlan = buckets.pull.length > 0
            ? await this.workspace.planPull(buckets.pull.map(change => change.path))
            : emptyPlan();

        const deletions: SyncPlanEntry[] = buckets.deleteRemote.map(change => ({
            path: change.path,
            name: basename(change.path),
        }));
        const mergedPlan: SyncPlan = {
            additions: plannedPush.reviewPlan.additions,
            modifications: plannedPush.reviewPlan.modifications,
            moves: plannedPush.reviewPlan.moves,
            deletions,
            downloads: [...pullPlan.additions, ...pullPlan.modifications],
            acceptedRemote: plannedPush.reviewPlan.acceptedRemote,
            skippedConflicts: plannedPush.reviewPlan.skippedConflicts,
        };

        if (isSyncPlanEmpty(mergedPlan)) return null;

        // Background mode auto-accepts the reviewed plan; it never opens the
        // final confirmation modal.
        return {
            plannedPush,
            confirmed: mode === 'background' ? true : await this.workspace.confirmPlan(mergedPlan, 'sync'),
        };
    }

    private async commitRemoteBucket(
        plannedPush: PlannedPushBatch,
        pushTargets: readonly SyncChange[],
        deleteTargets: readonly SyncChange[],
        summary: SyncExecutionResult,
        skippedPaths: ReadonlySet<string>,
    ): Promise<void> {
        const targets = [...pushTargets, ...deleteTargets].filter(target => !skippedPaths.has(target.path));
        try {
            const deleteEntries: DeleteQueueEntry[] = deleteTargets.map(change => ({
                path: change.path,
                name: basename(change.path),
                repoPath: this.workspace.toRepoPath(change.path),
            }));
            const results: PushResults = {
                success: plannedPush.immediate.success,
                added: 0,
                updated: plannedPush.immediate.updated,
                failed: plannedPush.immediate.failed,
                conflicts: 0,
                resolvedConflicts: 0,
                skippedConflicts: 0,
                errors: [...plannedPush.immediate.errors],
                syncedPaths: [...plannedPush.immediate.syncedPaths],
            };

            await this.workspace.commitResolvedBatch(
                plannedPush.pushes,
                plannedPush.moves,
                deleteEntries,
                plannedPush.keepRemote,
                plannedPush.keepLocal,
                results,
            );

            const failed = new Set(results.errors.map(error => error.file));
            this.finishAll(targets, path => failed.has(path) ? 'failed' : 'success');
            addRemoteResult(summary, plannedPush, deleteEntries, results);
        } catch {
            this.failAll(targets);
            summary.failed += targets.length;
        }
    }

    private async applyPullBucket(
        pullTargets: readonly SyncChange[],
        summary: SyncExecutionResult,
        skippedPaths: ReadonlySet<string>,
    ): Promise<void> {
        const targets = pullTargets.filter(target => !skippedPaths.has(target.path));
        try {
            if (targets.length === 0) return;
            const results = await this.workspace.applyPull(
                targets.map(change => change.path),
                { notify: false },
            );
            const failed = new Set(results.errors.map(error => error.file));
            this.finishAll(targets, path => failed.has(path) ? 'failed' : 'success');
            summary.downloaded += results.added + results.updated;
            summary.failed += results.failed;
            summary.conflicts += results.conflicts;
            summary.errors.push(...results.errors);
        } catch {
            this.failAll(targets);
            summary.failed += pullTargets.length;
        }
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

function hasRemoteMutations(planned: PlannedPushBatch, deletions: readonly SyncChange[]): boolean {
    return planned.pushes.length > 0
        || planned.moves.length > 0
        || planned.keepRemote.length > 0
        || planned.keepLocal.length > 0
        || deletions.length > 0;
}

function emptyPlannedBatch(): PlannedPushBatch {
    return {
        reviewPlan: { additions: [], modifications: [], deletions: [], moves: [] },
        pushes: [],
        moves: [],
        keepRemote: [],
        keepLocal: [],
        skippedConflicts: 0,
        conflictedPaths: [],
        cancelled: false,
        immediate: { success: 0, updated: 0, failed: 0, errors: [], syncedPaths: [] },
    };
}

function emptyPlan(): SyncPlan {
    return { additions: [], modifications: [], deletions: [], moves: [] };
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

function addRemoteResult(
    summary: SyncExecutionResult,
    planned: PlannedPushBatch,
    deletions: readonly DeleteQueueEntry[],
    results: PushResults,
): void {
    const failedPaths = new Set(results.errors.map(error => error.file));
    summary.added += planned.pushes.filter(entry => !entry.existingSha && !failedPaths.has(entry.path)).length;
    summary.updated += planned.pushes.filter(entry => entry.existingSha && !failedPaths.has(entry.path)).length
        + planned.immediate.updated;
    summary.moved += planned.moves.filter(entry => !failedPaths.has(entry.path)).length;
    summary.deleted += deletions.filter(entry => !failedPaths.has(entry.path)).length;
    summary.acceptedRemote += planned.keepRemote.filter(conflict => !failedPaths.has(conflict.path)).length;
    summary.failed += results.failed;
    summary.conflicts += results.conflicts;
    summary.skippedConflicts += results.skippedConflicts;
    summary.errors.push(...results.errors);
}

function basename(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? path : path.slice(slash + 1);
}
