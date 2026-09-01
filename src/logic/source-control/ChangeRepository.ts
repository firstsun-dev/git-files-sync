import type { ChangeId, SyncChange } from './types';

type ChangeRepositoryListener = (changes: readonly SyncChange[]) => void;

/**
 * Read-side lookup for the current set of Source Control changes.
 *
 * The repository is populated wholesale from the sync.status pipeline and
 * exposes one snapshot-change notification so dependent state stores can
 * reconcile when that source of truth changes. It still owns no sync or
 * provider behavior.
 */
export class ChangeRepository {
    private changes: SyncChange[] = [];
    private readonly byId = new Map<ChangeId, SyncChange>();
    private readonly byPath = new Map<string, SyncChange>();
    private readonly listeners = new Set<ChangeRepositoryListener>();

    /** Replaces the full change set, e.g. after a status refresh. */
    replace(changes: readonly SyncChange[]): void {
        this.changes = [...changes];
        this.byId.clear();
        this.byPath.clear();
        for (const change of this.changes) {
            this.byId.set(change.id, change);
            this.byPath.set(change.path, change);
        }
        for (const listener of this.listeners) listener(this.changes);
    }

    /** Subscribes to authoritative snapshot replacements. */
    subscribe(listener: ChangeRepositoryListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
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
