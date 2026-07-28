import type { TFile } from 'obsidian';

/** A resolved status shown for a file after sync facts have been compared. */
export type SyncStatus = 'synced' | 'modified' | 'unsynced' | 'remote-only' | 'moved';

/** The complete status record presented by a sync-status view. */
export interface FileStatus {
    file?: TFile;
    path: string;
    status: SyncStatus | 'checking';
    localContent?: string | ArrayBuffer;
    remoteContent?: string | ArrayBuffer;
    remoteSha?: string;
    isSymlink?: boolean;
    movedFrom?: string;
}

/**
 * Facts needed to resolve a file's status. A tracked move is intentionally
 * independent of file-content facts: a rename plus an edit remains a move
 * until that move has been pushed or reverted.
 */
export type SyncStatusFacts =
    | { movedFrom: string }
    | { localExists: true; remoteExists: false }
    | { localExists: false; remoteExists: true }
    | { localExists: true; remoteExists: true; contentsEqual: boolean };

/** Resolves sync facts into the one status the UI may present for a file. */
export class SyncStatusService {
    private readonly statuses = new Map<string, FileStatus>();
    private readonly listeners = new Set<(statuses: ReadonlyMap<string, FileStatus>) => void>();

    classify(facts: SyncStatusFacts): SyncStatus {
        if ('movedFrom' in facts) return 'moved';
        if (facts.localExists && !facts.remoteExists) return 'unsynced';
        if (!facts.localExists && facts.remoteExists) return 'remote-only';
        return facts.contentsEqual ? 'synced' : 'modified';
    }

    get size(): number { return this.statuses.size; }

    get(path: string): FileStatus | undefined { return this.statuses.get(path); }

    has(path: string): boolean { return this.statuses.has(path); }

    values(): IterableIterator<FileStatus> { return this.statuses.values(); }

    [Symbol.iterator](): IterableIterator<[string, FileStatus]> { return this.statuses[Symbol.iterator](); }

    set(status: FileStatus): this;
    set(path: string, status: FileStatus): this;
    set(statusOrPath: FileStatus | string, explicitStatus?: FileStatus): this {
        const status = typeof statusOrPath === 'string' ? explicitStatus : statusOrPath;
        if (!status) throw new Error('A file status is required.');
        this.statuses.set(status.path, status);
        this.publish();
        return this;
    }

    delete(path: string): void {
        if (!this.statuses.delete(path)) return;
        this.publish();
    }

    clear(): void {
        if (this.statuses.size === 0) return;
        this.statuses.clear();
        this.publish();
    }

    subscribe(listener: (statuses: ReadonlyMap<string, FileStatus>) => void): () => void {
        this.listeners.add(listener);
        listener(new Map(this.statuses));
        return () => this.listeners.delete(listener);
    }

    markSynced(path: string, sha?: string): void {
        const existing = this.statuses.get(path);
        if (!existing) return;
        this.set({
            ...existing,
            status: this.classify({ localExists: true, remoteExists: true, contentsEqual: true }),
            remoteSha: sha ?? existing.remoteSha,
            movedFrom: undefined,
        });
    }

    private publish(): void {
        const snapshot = new Map(this.statuses);
        for (const listener of this.listeners) listener(snapshot);
    }
}
