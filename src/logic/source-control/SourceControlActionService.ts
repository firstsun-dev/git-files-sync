import type { SyncWorkspace } from '../sync/SyncWorkspace';
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
     * copy (local wins) or pulling the remote copy (remote wins) — the same
     * two primitives every other action uses, so no separate conflict-apply
     * pathway is introduced.
     */
    async resolveConflict(changeId: ChangeId, resolution: ConflictResolution): Promise<void> {
        const change = this.changes.getById(changeId);
        if (!change) return;

        this.operations.start(changeId);
        try {
            if (resolution === 'local') {
                await this.workspace.push([change.path]);
            } else {
                await this.workspace.pullOne(change.path);
            }
            this.operations.succeed(changeId);
        } catch {
            this.operations.fail(changeId);
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
