import type { SyncWorkspace } from '../sync/SyncWorkspace';
import { defaultSyncAction } from './ChangeActionPolicy';
import type { ChangeRepository } from './ChangeRepository';
import type { BackgroundSyncSession, SourceControlActionService, SyncExecutionOutcome } from './SourceControlActionService';
import type { SyncIntentRequest } from './SyncIntent';
import type { SyncChange } from './types';

export interface AutomaticSyncDependencies {
    workspace: Pick<SyncWorkspace, 'refresh'>;
    changes: ChangeRepository;
    actions: Pick<SourceControlActionService, 'runBackground'>;
    /** Optional diagnostic sink; automatic runs stay silent on success. */
    onError?: (error: unknown) => void;
}

/**
 * Application-level use case for one automatic sync run.
 *
 * Reuses the existing Source Control application layer end to end: it does not
 * classify changes, detect renames, route actions, plan push/pull, or talk to a
 * provider itself. The whole transaction runs under one hold of the shared
 * execution guard (via `SourceControlActionService.runBackground`), so a busy
 * tick is skipped before any provider work:
 *
 *   try-acquire guard -> refresh -> read ChangeRepository -> exclude
 *   synced/conflict -> default intents via ChangeActionPolicy -> (nothing to
 *   do: stop) -> execute in background mode -> refresh once more.
 *
 * Background execution never shows a user notice, so failures reported by the
 * executor (rejections and per-file provider errors) are surfaced here
 * through `onError`. Skipped conflicts are expected and are not errors.
 *
 * Timer mechanics deliberately live outside this service (plugin runtime
 * scheduling); this class only knows how to run once.
 */
export class AutomaticSyncService {
    private running = false;

    constructor(private readonly dependencies: AutomaticSyncDependencies) {}

    /**
     * Runs at most one automatic sync at a time. A tick that fires while a run
     * is already active, or while manual work owns the execution guard, is
     * skipped rather than queued; an error never leaves the service locked.
     */
    async runOnce(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            await this.dependencies.actions.runBackground(session => this.runTransaction(session));
        } catch (error) {
            this.dependencies.onError?.(error);
        } finally {
            this.running = false;
        }
    }

    private async runTransaction(session: BackgroundSyncSession): Promise<void> {
        await this.dependencies.workspace.refresh();
        const intents = this.pendingIntents();
        // Idle vault (or only synced/conflict entries): the refresh above
        // already published current state, so a second refresh would only
        // double provider polling.
        if (intents.length === 0) return;

        const outcome = await session.sync(intents);
        this.reportFailures(outcome);
        // Re-read after execution so the refreshed status reflects the
        // changes that were just applied (and keeps conflicts visible).
        await this.dependencies.workspace.refresh();
    }

    private reportFailures(outcome: SyncExecutionOutcome): void {
        const { onError } = this.dependencies;
        if (!onError) return;
        for (const failure of outcome.failures) onError(failure);

        const result = outcome.result;
        if (!result) return;
        if (result.errors.length > 0) {
            const details = result.errors.map(error => `${error.file}: ${error.error}`).join('; ');
            onError(new Error(`Automatic sync failed for ${result.errors.length} file(s): ${details}`));
        } else if (result.failed > 0 && outcome.failures.length === 0) {
            onError(new Error(`Automatic sync failed for ${result.failed} file(s)`));
        }
    }

    /**
     * Every pending change except 'synced' (nothing to do) and 'conflict'
     * (must be resolved manually). Actions come from the same default routing
     * the manual Sync button uses, with no explicit override.
     */
    private pendingIntents(): SyncIntentRequest[] {
        return this.dependencies.changes
            .getAll()
            .filter(change => change.kind !== 'synced' && change.kind !== 'conflict')
            .map(change => toDefaultIntent(change));
    }
}

function toDefaultIntent(change: SyncChange): SyncIntentRequest {
    // Route through the action policy so the default action has one source of
    // truth; execution re-validates it against the live change kind anyway.
    return { changeId: change.id, action: defaultSyncAction(change.kind) };
}
