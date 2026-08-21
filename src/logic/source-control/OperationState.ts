export type OperationStatus = 'idle' | 'running' | 'success' | 'failed';

/**
 * Tracks in-flight per-change operation status, independent of both the
 * change model and push selection.
 */
export class OperationState {
    private readonly status = new Map<string, OperationStatus>();

    start(path: string): void {
        this.status.set(path, 'running');
    }

    succeed(path: string): void {
        this.status.set(path, 'success');
    }

    fail(path: string): void {
        this.status.set(path, 'failed');
    }

    reset(path: string): void {
        this.status.delete(path);
    }

    get(path: string): OperationStatus {
        return this.status.get(path) ?? 'idle';
    }

    clear(): void {
        this.status.clear();
    }
}
