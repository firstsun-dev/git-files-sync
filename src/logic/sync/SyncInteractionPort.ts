import type { DiffStatLoadResult } from '../../ui/source-control/DiffStatProvider';
import type { GitServiceInterface } from '../../services/git-service-interface';
import type { BatchPushConflict, SyncPlan } from './types';

export type SyncPlanDirection = 'push' | 'pull' | 'delete' | 'sync';
export type SingleConflictChoice = 'local' | 'remote';

/**
 * Resolves the +/- diff stat for one batch-conflict row. Consumers should
 * treat this as progressive: cheap sources (already-in-memory content)
 * resolve immediately, remote-backed sources may go out to the provider.
 * Returning `pending` lets the caller's cache retry later, `unavailable`
 * gives up permanently (binary files, fetch failures that are terminal).
 */
export type ConflictDiffStatLoader = (conflict: {
    path: string;
    localContent: string | ArrayBuffer;
    remoteSha: string;
    repoPath: string;
}) => Promise<DiffStatLoadResult>;

/** User interaction required by sync workflows, supplied by the composition layer. */
export interface SyncInteractionPort {
    confirmPlan(plan: SyncPlan, direction: SyncPlanDirection): Promise<boolean>;
    openConflict(
        fileName: string,
        localContent: string | ArrayBuffer,
        remoteContent: string | ArrayBuffer,
        onChoose: (choice: SingleConflictChoice) => void,
    ): void;
    resolveBatchConflicts(
        gitService: GitServiceInterface,
        conflicts: BatchPushConflict[],
        totalFiles: number,
        safeCount: number,
        /**
         * Optional progressive +/- diff-stat source for the batch conflict
         * modal's rows. Omit to render rows without stats. Must not block
         * modal opening — the modal renders immediately and stats land
         * asynchronously.
         */
        diffStatLoader?: ConflictDiffStatLoader,
    ): Promise<boolean>;
    notify(message: string, duration?: number): void;
}

/** Safe non-visual fallback for tests or embedders that do not provide a UI. */
export class HeadlessSyncInteraction implements SyncInteractionPort {
    confirmPlan(): Promise<boolean> { return Promise.resolve(true); }
    openConflict(): void {}
    resolveBatchConflicts(): Promise<boolean> { return Promise.resolve(false); }
    notify(): void {}
}
