import { TFile } from 'obsidian';
import type { SyncStatus } from '../logic/sync-status-service';

export interface FileStatus {
    file?: TFile;
    path: string;
    status: SyncStatus | 'checking';
    localContent?: string | ArrayBuffer;
    remoteContent?: string | ArrayBuffer;
    remoteSha?: string;
    /** True when the remote blob is a symbolic link (mode 120000). */
    isSymlink?: boolean;
    /** For status 'moved': the path this file was last synced at before the rename. */
    movedFrom?: string;
}

export type FilterValue = 'all' | 'synced' | 'modified' | 'unsynced' | 'remote-only' | 'moved';

/** One file that a sync plan would touch. */
export interface SyncPlanEntry {
    path: string;
    name: string;
    /** For a move: the path it would move from. */
    movedFrom?: string;
}

/**
 * The full set of changes a push, pull, or remote deletion would apply,
 * computed before anything is written so it can be shown for review. Only
 * entries that would actually be written appear here — files that are
 * already in sync or skipped due to a conflict are left out.
 */
export interface SyncPlan {
    additions: SyncPlanEntry[];
    modifications: SyncPlanEntry[];
    deletions: SyncPlanEntry[];
    moves: SyncPlanEntry[];
}

export function isSyncPlanEmpty(plan: SyncPlan): boolean {
    return plan.additions.length === 0 && plan.modifications.length === 0
        && plan.deletions.length === 0 && plan.moves.length === 0;
}
