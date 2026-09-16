import type { SyncWorkspace } from '../sync/SyncWorkspace';
import { defaultSyncAction } from './ChangeActionPolicy';
import type { ChangeRepository } from './ChangeRepository';
import type { SourceControlActionService } from './SourceControlActionService';
import type { SyncIntentRequest } from './SyncIntent';
import type { SyncChange } from './types';

export interface AutomaticSyncDependencies {
    workspace: Pick<SyncWorkspace, 'refresh'>;
    changes: ChangeRepository;
    actions: Pick<SourceControlActionService, 'sync'>;
    /** Optional diagnostic sink; automatic runs stay silent on success. */
    onError?: (error: unknown) => void;
}

/**
 * Application-level use case for one automatic sync run.
 *
 * Reuses the existing Source Control application layer end to end: it does not
 * classify changes, detect renames, route actions, plan push/pull, or talk to a
 * provider itself. The sequence is refresh -> read ChangeRepository -> exclude
 * synced/conflict -> build default intents via ChangeActionPolicy -> execute
 * through the shared Sync Queue path in background mode -> refresh again.
 *
 * Timer mechanics deliberately live outside this service (plugin runtime
 * scheduling); this class only knows how to run once.
 */
export class AutomaticSyncService {
    private running = false;

    constructor(private readonly dependencies: AutomaticSyncDependencies) {}

    /**
     * Runs at most one automatic sync at a time. A tick that fires while a run
     * is already active is skipped rather than queued, and an execution error
     * never leaves the service permanently locked.
     */
    async runOnce(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            await this.dependencies.workspace.refresh();
            const intents = this.pendingIntents();
            if (intents.length > 0) {
                await this.dependencies.actions.sync(intents, 'background');
                // Re-read after execution so the refreshed status reflects the
                // changes that were just applied (and keeps conflicts visible).
            }
            await this.dependencies.workspace.refresh();
        } catch (error) {
            this.dependencies.onError?.(error);
        } finally {
            this.running = false;
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
