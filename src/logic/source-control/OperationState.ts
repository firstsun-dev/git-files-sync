import type { ChangeId } from './types';

export type OperationStatus = 'idle' | 'running' | 'success' | 'failed';

/**
 * Tracks in-flight per-change operation status, independent of both the
 * change model and push selection.
 *
 * Keyed by ChangeId rather than path so a rename/move doesn't lose in-flight
 * status, and so two different changes that happen to share a path (e.g. a
 * delete followed by a re-add) don't cross-contaminate each other's state.
 */
export class OperationState {
    private readonly status = new Map<ChangeId, OperationStatus>();

    start(changeId: ChangeId): void {
        this.status.set(changeId, 'running');
    }

    succeed(changeId: ChangeId): void {
        this.status.set(changeId, 'success');
    }

    fail(changeId: ChangeId): void {
        this.status.set(changeId, 'failed');
    }

    reset(changeId: ChangeId): void {
        this.status.delete(changeId);
    }

    get(changeId: ChangeId): OperationStatus {
        return this.status.get(changeId) ?? 'idle';
    }

    clear(): void {
        this.status.clear();
    }
}
