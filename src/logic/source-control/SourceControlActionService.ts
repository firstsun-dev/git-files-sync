import type { PlannedPushBatch } from '../sync/PushCoordinator';
import type { SyncWorkspace } from '../sync/SyncWorkspace';
import { isSyncPlanEmpty, type DeleteQueueEntry, type PushResults, type SyncPlan, type SyncPlanEntry } from '../sync/types';
import { type SyncExecutionResult, type SyncResultNotificationPort } from './SyncResultNotifier';
import { defaultSyncAction } from './ChangeActionPolicy';
import type { ChangeRepository } from './ChangeRepository';
import type { OperationState } from './OperationState';
import type { SourceControlItem } from './SourceControlViewModel';
import type { ChangeId, SyncChange } from './types';

/** Which side wins when resolving a change in the 'conflict' state. */
export type ConflictResolution = 'local' | 'remote';

/** Diff payload the Source Control diff pane can render directly (text-only; binary/symlink changes resolve to `null`). */
export interface SourceControlDiffContent {
    remote: string;
    local: string;
}

/**
 * Converts Source Control user intent (push / pull / delete-remote /
 * delete-local / resolve-conflict on one or more `ChangeId`s) into calls
 * against `SyncWorkspace` — the existing `SyncManager`-backed execution
 * boundary already used by the sync-status UI — per
 * docs/source-control-refactor/phase-2-action-unification.md.
 *
 * Per that doc's rules, this service DOES convert user intent into the call
 * `SyncWorkspace`/`SyncManager` need (effectively "build the SyncPlan"), but
 * it never talks to a Git provider directly and never (re-)classifies
 * changes — it only resolves `ChangeId` -> `SyncChange` via the Phase 1
 * `ChangeRepository` and reports per-change outcome through the Phase 1
 * `OperationState`. Unknown/stale `ChangeId`s (e.g. a change that dropped out
 * between the UI snapshot and the click) are silently skipped rather than
 * throwing, since the repository is the single source of truth for what's
 * still actionable.
 */
export class SourceControlActionService {
    constructor(
        private readonly changes: ChangeRepository,
        private readonly operations: OperationState,
        private readonly workspace: SyncWorkspace,
        private readonly syncResultNotifier: SyncResultNotificationPort = { notify: () => {} },
    ) {}

    /** Pushes one or more changes (single push and batch push share this path). */
    async push(changeIds: readonly ChangeId[]): Promise<void> {
        const targets = this.resolve(changeIds);
        if (targets.length === 0) return;

        this.startAll(targets);
        try {
            const results = await this.workspace.push(targets.map(target => target.path));
            const failed = new Set(results.errors.map(error => error.file));
            this.finishAll(targets, path => (failed.has(path) ? 'failed' : 'success'));
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
            this.finishAll(targets, path => (failed.has(path) ? 'failed' : 'success'));
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
            this.finishAll(targets, path => (failed.has(path) ? 'failed' : 'success'));
        } catch {
            this.failAll(targets);
        }
    }

    /**
     * Syncs one or more changes as a single Sync Plan — the Sync Queue
     * button's only entry point. Splits `changeIds` by
     * {@link defaultSyncAction} into push/delete-remote/pull buckets, plans
     * each without mutating anything, merges the result into one `SyncPlan`,
     * shows exactly one confirm, and — if confirmed — commits the whole
     * remote mutation set (pushes + moves + deletions) through
     * `SyncWorkspace.commitResolvedBatch` as one provider call, then applies
     * the pull bucket (zero-commit, local-only) separately. This is the fix
     * for the "one Sync produces two remote commits" bug: previously the
     * Sync Queue routed push/pull/delete-remote through three independent
     * `SyncWorkspace` calls, each committing on its own.
     */
    async sync(changeIds: readonly ChangeId[]): Promise<void> {
        const targets = this.resolve(changeIds);
        if (targets.length === 0) return;

        const pushTargets: SyncChange[] = [];
        const deleteTargets: SyncChange[] = [];
        const pullTargets: SyncChange[] = [];
        for (const target of targets) {
            const action = defaultSyncAction(target.kind);
            if (action === 'pull') pullTargets.push(target);
            else if (action === 'delete-remote') deleteTargets.push(target);
            else pushTargets.push(target);
        }

        let plan: { planned: PlannedPushBatch; confirmed: boolean } | null;
        try {
            plan = await this.planSync(pushTargets, pullTargets, deleteTargets);
        } catch {
            this.failAll(targets);
            this.syncResultNotifier.notify({ ...SourceControlActionService.emptyExecutionResult(), failed: targets.length });
            return;
        }
        if (!plan || !plan.confirmed) return;
        const { planned } = plan;

        this.startAll(targets);
        const summary = SourceControlActionService.emptyExecutionResult();
        if (planned.pushes.length > 0 || planned.moves.length > 0 || planned.keepRemote.length > 0 || planned.keepLocal.length > 0 || deleteTargets.length > 0) {
            await this.commitRemoteBucket(planned, pushTargets, deleteTargets, summary);
        }
        if (pullTargets.length > 0) {
            await this.applyPullBucket(pullTargets, summary);
        }
        this.syncResultNotifier.notify(summary);
    }

    /** Builds and confirms the merged Sync Plan; returns null if there's nothing to do or the user cancelled. */
    private async planSync(
        pushTargets: readonly SyncChange[],
        pullTargets: readonly SyncChange[],
        deleteTargets: readonly SyncChange[],
    ): Promise<{ planned: PlannedPushBatch; confirmed: boolean } | null> {
        const planned = pushTargets.length > 0
            ? await this.workspace.planPush(pushTargets.map(target => target.path))
            : SourceControlActionService.emptyPlannedBatch();
        // A cancelled batch-conflict resolution is a separate interactive
        // step that happens before the merged plan is even shown; honor it
        // the same way pushFiles() does, without touching anything.
        if (planned.cancelled) return null;

        const pullPlan = pullTargets.length > 0
            ? await this.workspace.planPull(pullTargets.map(target => target.path))
            : SourceControlActionService.emptyPlan();

        const deletions: SyncPlanEntry[] = deleteTargets.map(target => ({ path: target.path, name: basename(target.path) }));
        const mergedPlan: SyncPlan = {
            additions: planned.reviewPlan.additions,
            modifications: planned.reviewPlan.modifications,
            moves: planned.reviewPlan.moves,
            deletions,
            downloads: [...pullPlan.additions, ...pullPlan.modifications],
            acceptedRemote: planned.reviewPlan.acceptedRemote,
            skippedConflicts: planned.reviewPlan.skippedConflicts,
        };
        if (isSyncPlanEmpty(mergedPlan)) return null;

        const confirmed = await this.workspace.confirmPlan(mergedPlan, 'sync');
        return { planned, confirmed };
    }

    /** Commits the merged push/move/delete-remote bucket; a failure here only fails that bucket, not any already-applied pull. */
    private async commitRemoteBucket(
        planned: PlannedPushBatch,
        pushTargets: readonly SyncChange[],
        deleteTargets: readonly SyncChange[],
        summary: SyncExecutionResult,
    ): Promise<void> {
        try {
            const deleteEntries: DeleteQueueEntry[] = deleteTargets.map(target => ({
                path: target.path,
                name: basename(target.path),
                repoPath: this.workspace.toRepoPath(target.path),
            }));
            const results: PushResults = {
                success: planned.immediate.success,
                added: 0,
                updated: planned.immediate.updated,
                failed: planned.immediate.failed,
                conflicts: 0,
                resolvedConflicts: 0,
                skippedConflicts: 0,
                errors: [...planned.immediate.errors],
                syncedPaths: [...planned.immediate.syncedPaths],
            };
            await this.workspace.commitResolvedBatch(planned.pushes, planned.moves, deleteEntries, planned.keepRemote, planned.keepLocal, results);
            const failed = new Set(results.errors.map(error => error.file));
            this.finishAll([...pushTargets, ...deleteTargets], path => (failed.has(path) ? 'failed' : 'success'));
            this.addRemoteResult(summary, planned, deleteEntries, results);
        } catch {
            this.failAll([...pushTargets, ...deleteTargets]);
            summary.failed += pushTargets.length + deleteTargets.length;
        }
    }

    /** Applies the zero-commit pull bucket; a failure here only fails the pull targets, not any already-committed remote bucket. */
    private async applyPullBucket(pullTargets: readonly SyncChange[], summary: SyncExecutionResult): Promise<void> {
        try {
            const pullResults = await this.workspace.applyPull(pullTargets.map(target => target.path), { notify: false });
            const failed = new Set(pullResults.errors.map(error => error.file));
            this.finishAll(pullTargets, path => (failed.has(path) ? 'failed' : 'success'));
            summary.downloaded += pullResults.added + pullResults.updated;
            summary.failed += pullResults.failed;
            summary.conflicts += pullResults.conflicts;
            summary.errors.push(...pullResults.errors);
        } catch {
            this.failAll(pullTargets);
            summary.failed += pullTargets.length;
        }
    }

    private static emptyPlannedBatch(): PlannedPushBatch {
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

    private static emptyPlan(): SyncPlan {
        return { additions: [], modifications: [], deletions: [], moves: [] };
    }

    private static emptyExecutionResult(): SyncExecutionResult {
        return { added: 0, updated: 0, moved: 0, deleted: 0, downloaded: 0, acceptedRemote: 0, failed: 0, conflicts: 0, skippedConflicts: 0, errors: [] };
    }

    private addRemoteResult(
        summary: SyncExecutionResult,
        planned: PlannedPushBatch,
        deletions: readonly DeleteQueueEntry[],
        results: PushResults,
    ): void {
        const failedPaths = new Set(results.errors.map(error => error.file));
        summary.added += planned.pushes.filter(entry => !entry.existingSha && !failedPaths.has(entry.path)).length;
        summary.updated += planned.pushes.filter(entry => entry.existingSha && !failedPaths.has(entry.path)).length + planned.immediate.updated;
        summary.moved += planned.moves.filter(entry => !failedPaths.has(entry.path)).length;
        summary.deleted += deletions.filter(entry => !failedPaths.has(entry.path)).length;
        summary.acceptedRemote += planned.keepRemote
            .filter(conflict => !failedPaths.has(conflict.path))
            .length;
        summary.failed += results.failed;
        summary.conflicts += results.conflicts;
        summary.skippedConflicts += results.skippedConflicts;
        summary.errors.push(...results.errors);
    }

    /** Deletes one or more changes from the local vault only. No batch primitive exists on `SyncWorkspace`, so each runs independently and one failure doesn't block the rest. */
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
     * Resolves a single change in the 'conflict' state by pushing the local
     * copy (local wins) or pulling the reviewed remote copy (remote wins).
     * Remote resolution goes through the explicit acceptRemoteConflict
     * boundary, which applies the reviewed remote blob without re-running the
     * planner — so no second conflict modal can appear.
     */
    async resolveConflict(changeId: ChangeId, resolution: ConflictResolution): Promise<void> {
        const change = this.changes.getById(changeId);
        if (!change) return;

        this.operations.start(changeId);
        try {
            if (resolution === 'local') {
                const results = await this.workspace.push([change.path]);
                if (results.errors.length > 0) throw new Error(results.errors.map(error => error.error).join('; '));
                this.operations.succeed(changeId);
                this.syncResultNotifier.notify({ ...SourceControlActionService.emptyExecutionResult(), updated: 1 });
            } else {
                await this.workspace.acceptRemoteConflict(change.path);
                this.operations.succeed(changeId);
                this.syncResultNotifier.notify({ ...SourceControlActionService.emptyExecutionResult(), acceptedRemote: 1 });
            }
        } catch {
            this.operations.fail(changeId);
            this.syncResultNotifier.notify({ ...SourceControlActionService.emptyExecutionResult(), failed: 1 });
        }
    }

    /**
     * Supplies `SourceControlView`'s `loadDiffContent` callback: delegates to
     * the existing `SyncWorkspace.getDiff`/`SyncDiffService` (no new diff
     * logic) and resolves to `null` for binary/symlink changes, which the
     * text-only diff pane can't render.
     */
    async loadDiffContent(item: SourceControlItem): Promise<SourceControlDiffContent | null> {
        const diff = await this.workspace.getDiff(item.path);
        if (typeof diff.remoteContent !== 'string' || typeof diff.localContent !== 'string') return null;
        return { remote: diff.remoteContent, local: diff.localContent };
    }

    /** Resolves ChangeIds to their current SyncChange, dropping any that are no longer known to the repository. */
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

    private finishAll(targets: readonly SyncChange[], statusFor: (path: string) => 'success' | 'failed'): void {
        for (const target of targets) {
            if (statusFor(target.path) === 'success') this.operations.succeed(target.id);
            else this.operations.fail(target.id);
        }
    }

    private failAll(targets: readonly SyncChange[]): void {
        for (const target of targets) this.operations.fail(target.id);
    }
}

/** Last path segment of a change path, for the Sync Plan's deletions section. */
function basename(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? path : path.slice(slash + 1);
}
