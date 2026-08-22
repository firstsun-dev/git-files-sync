import type { ChangeRepository } from './ChangeRepository';
import type { ChangeId, SourceControlActionKind, SyncChange, SyncPlan } from './types';

/** Thrown when a `ChangeId` passed to the action service has no matching `SyncChange`. */
export class InvalidChangeIdError extends Error {
    constructor(readonly changeIds: ChangeId[]) {
        super(`Unknown ChangeId(s): ${changeIds.join(', ')}`);
        this.name = 'InvalidChangeIdError';
    }
}

/**
 * Executes a `SyncPlan` produced by `SourceControlActionService`. Kept as an
 * injected interface so the service itself never touches the Git provider or
 * the filesystem directly — implementations delegate to `SyncExecutor`/
 * `SyncWorkspace`.
 */
export interface SyncPlanExecutor {
    execute(plan: SyncPlan): Promise<void>;
}

/**
 * Single entry point converting user intent (a `SourceControlActionKind` plus
 * `ChangeId`s) into a `SyncPlan`, then delegating execution. This is the one
 * pipeline every trigger — Source Control buttons, context menu, single-file
 * commands, batch operations — should route through, so none of them
 * re-implement plan-building or dispatch on their own.
 *
 * Deliberately does not classify changes (that's `SyncPlanner`'s job) or run
 * any git/filesystem operation itself (that's the injected `SyncPlanExecutor`'s
 * job) — it only resolves `ChangeId`s to `SyncChange`s and builds the plan.
 */
export class SourceControlActionService {
    constructor(
        private readonly changes: ChangeRepository,
        private readonly executor: SyncPlanExecutor,
    ) {}

    push(changeIds: ChangeId[]): Promise<void> {
        return this.dispatch('push', changeIds);
    }

    pull(changeIds: ChangeId[]): Promise<void> {
        return this.dispatch('pull', changeIds);
    }

    deleteRemote(changeIds: ChangeId[]): Promise<void> {
        return this.dispatch('delete-remote', changeIds);
    }

    deleteLocal(changeIds: ChangeId[]): Promise<void> {
        return this.dispatch('delete-local', changeIds);
    }

    resolveConflict(changeIds: ChangeId[]): Promise<void> {
        return this.dispatch('resolve-conflict', changeIds);
    }

    private async dispatch(action: SourceControlActionKind, changeIds: ChangeId[]): Promise<void> {
        const plan = this.buildPlan(action, changeIds);
        return this.executor.execute(plan);
    }

    private buildPlan(action: SourceControlActionKind, changeIds: ChangeId[]): SyncPlan {
        return { action, changes: changeIds.map(id => this.resolve(id)) };
    }

    private resolve(id: ChangeId): SyncChange {
        const change = this.changes.getById(id);
        if (!change) throw new InvalidChangeIdError([id]);
        return change;
    }
}
