import type { ChangeId, SyncChange } from './types';

/**
 * Read-side lookup for the current set of pending `SyncChange`s. Holds no
 * sync/business logic of its own — it's populated wholesale (`replace`) by
 * whatever assembles `SyncChange[]` from the sync domain, and exists purely
 * to give the ViewModel and UI O(1) lookup by id or path instead of scanning
 * an array.
 */
export class ChangeRepository {
    private changes: SyncChange[] = [];
    private readonly byId = new Map<ChangeId, SyncChange>();
    private readonly byPath = new Map<string, SyncChange>();

    /** Replaces the full change set, e.g. after a status refresh. */
    replace(changes: readonly SyncChange[]): void {
        this.changes = [...changes];
        this.byId.clear();
        this.byPath.clear();
        for (const change of this.changes) {
            this.byId.set(change.id, change);
            this.byPath.set(change.path, change);
        }
    }

    getAll(): SyncChange[] {
        return [...this.changes];
    }

    getById(id: ChangeId): SyncChange | undefined {
        return this.byId.get(id);
    }

    getByPath(path: string): SyncChange | undefined {
        return this.byPath.get(path);
    }
}
