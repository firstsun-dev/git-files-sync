import { type App, Notice } from 'obsidian';
import { BatchConflictResolutionModal } from './BatchConflictResolutionModal';
import { SyncConflictModal } from './SyncConflictModal';
import { SyncPlanModal } from './SyncPlanModal';
import type {
    ConflictDiffStatLoader,
    SingleConflictChoice,
    SyncInteractionPort,
    SyncPlanDirection,
} from '../logic/sync/SyncInteractionPort';
import type { BatchPushConflict, SyncPlan } from '../logic/sync/types';
import type { ConflictDiffLoader } from './BatchConflictResolutionModal';

/** Obsidian implementation of the domain's user-interaction boundary. */
export class ObsidianSyncInteraction implements SyncInteractionPort {
    constructor(private readonly app: App) {}

    confirmPlan(plan: SyncPlan, direction: SyncPlanDirection): Promise<boolean> {
        return new Promise(resolve => {
            new SyncPlanModal(this.app, plan, direction, () => resolve(true), () => resolve(false)).open();
        });
    }

    openConflict(
        fileName: string,
        localContent: string | ArrayBuffer,
        remoteContent: string | ArrayBuffer,
        onChoose: (choice: SingleConflictChoice) => void,
    ): void {
        new SyncConflictModal(this.app, fileName, localContent, remoteContent, onChoose).open();
    }

    resolveBatchConflicts(
        conflicts: BatchPushConflict[],
        safeCount: number,
        loadConflictDiff?: ConflictDiffLoader,
        diffStatLoader?: ConflictDiffStatLoader,
    ): Promise<boolean> {
        return new Promise(resolve => {
            new BatchConflictResolutionModal(
                this.app,
                conflicts,
                safeCount,
                () => resolve(true),
                () => resolve(false),
                loadConflictDiff,
                diffStatLoader,
            ).open();
        });
    }

    notify(message: string, duration?: number): void {
        new Notice(message, duration);
    }
}
