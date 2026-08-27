import type { GitServiceInterface } from '../../services/git-service-interface';
import type { BatchPushConflict, SyncPlan } from './types';

export type SyncPlanDirection = 'push' | 'pull' | 'delete' | 'sync';
export type SingleConflictChoice = 'local' | 'remote';

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
