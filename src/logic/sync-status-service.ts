/** A resolved status shown for a file after sync facts have been compared. */
export type SyncStatus = 'synced' | 'modified' | 'unsynced' | 'remote-only' | 'moved';

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
    classify(facts: SyncStatusFacts): SyncStatus {
        if ('movedFrom' in facts) return 'moved';
        if (facts.localExists && !facts.remoteExists) return 'unsynced';
        if (!facts.localExists && facts.remoteExists) return 'remote-only';
        return facts.contentsEqual ? 'synced' : 'modified';
    }
}
