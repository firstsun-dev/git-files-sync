export type ContentKind = 'text' | 'binary' | 'symlink';

export interface LocalSnapshot {
    path: string;
    exists: boolean;
    blobSha?: string;
    kind: ContentKind;
}

export interface RemoteSnapshot {
    /** Vault-relative path exposed to the UI. */
    path: string;
    /** Provider repository-relative path used for mutations. */
    repoPath: string;
    exists: boolean;
    blobSha?: string;
    revision?: string;
    kind: ContentKind;
}

export interface BaseSnapshot {
    blobSha?: string;
    renamedFrom?: string;
}

export interface SyncFacts {
    local: LocalSnapshot;
    remote: RemoteSnapshot;
    base: BaseSnapshot;
}

export interface MoveFacts {
    local: LocalSnapshot;
    source: RemoteSnapshot;
    destination: RemoteSnapshot;
}

export type SyncClassification =
    | 'synced'
    | 'local-modified'
    | 'remote-modified'
    | 'local-only'
    | 'remote-only'
    | 'conflict';

export type SyncAction =
    | 'none'
    | 'move'
    | 'push-create'
    | 'push-update'
    | 'pull-create'
    | 'pull-overwrite'
    | 'resolve-conflict';

export type SyncOperation = 'push' | 'pull';

export interface PlannedFileAction {
    path: string;
    repoPath: string;
    kind: ContentKind;
    classification: SyncClassification;
    action: SyncAction;
}

/** One file that a reviewed sync operation would touch. */
export interface SyncPlanEntry {
    path: string;
    name: string;
    movedFrom?: string;
}

export interface SyncPlan {
    additions: SyncPlanEntry[];
    modifications: SyncPlanEntry[];
    deletions: SyncPlanEntry[];
    moves: SyncPlanEntry[];
    /** Remote-only/remote-modified entries a unified Sync will pull locally — zero-commit, shown for review alongside the remote mutation set. */
    downloads?: SyncPlanEntry[];
    acceptedRemote?: SyncPlanEntry[];
    skippedConflicts?: SyncPlanEntry[];
}

export interface SyncFailure {
    file: string;
    error: string;
}

export interface SyncResult {
    success: number;
    added: number;
    updated: number;
    failed: number;
    conflicts: number;
    errors: SyncFailure[];
}

export interface FileDiff {
    path: string;
    localContent?: string | ArrayBuffer;
    remoteContent?: string | ArrayBuffer;
    kind: ContentKind;
}

export type ConflictResolution = 'keep-local' | 'keep-remote' | 'skip';

export interface BatchPushConflict {
    path: string;
    name: string;
    repoPath: string;
    localContent: string | ArrayBuffer;
    remoteSha: string;
    remoteRevision?: string;
    resolution?: ConflictResolution;
}

export interface PushResults {
    success: number;
    added: number;
    updated: number;
    failed: number;
    conflicts: number;
    resolvedConflicts: number;
    skippedConflicts: number;
    cancelled?: boolean;
    errors: Array<{ file: string; error: string }>;
    syncedPaths: Array<{ path: string; sha?: string }>;
    conflictedPaths?: string[];
}

export interface PushQueueEntry {
    path: string;
    name: string;
    repoPath: string;
    content: string | ArrayBuffer;
    existingSha?: string;
    existingRevision?: string;
}

export interface MoveQueueEntry {
    path: string;
    name: string;
    repoPath: string;
    oldPath: string;
    oldRepoPath: string;
    content: string | ArrayBuffer;
    oldRevision?: string;
}

export interface DeleteQueueEntry {
    path: string;
    name: string;
    repoPath: string;
}

export function isSyncPlanEmpty(plan: SyncPlan): boolean {
    return plan.additions.length === 0
        && plan.modifications.length === 0
        && plan.deletions.length === 0
        && plan.moves.length === 0
        && !plan.downloads?.length
        && !plan.acceptedRemote?.length
        && !plan.skippedConflicts?.length;
}
