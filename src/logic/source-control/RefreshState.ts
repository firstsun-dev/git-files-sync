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
 */
export type RefreshStatus = 'idle' | 'loading' | 'failed';

export class RefreshState {
    private status: RefreshStatus = 'idle';

    start(): void {
        this.status = 'loading';
    }

    fail(): void {
        this.status = 'failed';
    }

    succeed(): void {
        this.status = 'idle';
    }

    /** Resets back to idle, clearing a prior failure so the button no longer shows the error state. */
    clear(): void {
        this.status = 'idle';
    }

    get(): RefreshStatus {
        return this.status;
    }
}