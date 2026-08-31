import type { RefreshReason } from './RefreshReason';

/**
 * Single-value refresh status for the whole Source Control view, mirroring
 * {@link OperationState}'s API shape (start/fail/succeed/get/clear) but for
 * one global refresh rather than per-{@link ChangeId} operations.
 *
 * Holds no refresh logic of its own: {@link SourceControlViewModel.refresh}
 * delegates to the injected `syncWorkspace.refresh()` and only drives this
 * holder so the UI can show "Refreshing…" / a failed state. Keeping it a
 * separate holder (rather than reusing `OperationState`) avoids conflating a
 * view-wide background refresh with per-change push/pull operations.
 *
 * Also records the {@link RefreshReason} of the most recent refresh and the
 * epoch-ms it completed, so the header can surface a "Last checked: …" line
 * and the trigger is observable for debugging.
 */
export type RefreshStatus = 'idle' | 'loading' | 'failed';

export class RefreshState {
    private status: RefreshStatus = 'idle';
    private reason: RefreshReason | undefined;
    private lastCheckedAt = 0;

    start(reason: RefreshReason = 'manual'): void {
        this.status = 'loading';
        this.reason = reason;
    }

    fail(): void {
        this.status = 'failed';
    }

    succeed(): void {
        this.status = 'idle';
        this.lastCheckedAt = Date.now();
    }

    /** Resets back to idle, clearing a prior failure so the button no longer shows the error state. */
    clear(): void {
        this.status = 'idle';
    }

    get(): RefreshStatus {
        return this.status;
    }

    /** Why the most recent refresh was triggered, or `undefined` before the first one. */
    getReason(): RefreshReason | undefined {
        return this.reason;
    }

    /** Epoch-ms the most recent refresh completed (succeeded), or `0` if none yet. */
    getLastCheckedAt(): number {
        return this.lastCheckedAt;
    }
}