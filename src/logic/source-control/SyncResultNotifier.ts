import { t } from '../../i18n';
import type { SyncFailure } from '../sync/types';

const COUNT_KEYS = {
    added: 'sourceControl.notice.sync.added',
    updated: 'sourceControl.notice.sync.updated',
    moved: 'sourceControl.notice.sync.moved',
    deleted: 'sourceControl.notice.sync.deleted',
    downloaded: 'sourceControl.notice.sync.downloaded',
    acceptedRemote: 'sourceControl.notice.sync.acceptedRemote',
    failed: 'sourceControl.notice.sync.failedCount',
    conflicts: 'sourceControl.notice.sync.conflicts',
    skippedConflicts: 'sourceControl.notice.sync.skippedConflicts',
} as const;

export interface SyncExecutionResult {
    added: number;
    updated: number;
    moved: number;
    deleted: number;
    downloaded: number;
    acceptedRemote: number;
    failed: number;
    conflicts: number;
    skippedConflicts: number;
    errors: SyncFailure[];
}

export interface SyncResultNotificationPort {
    notify(result: SyncExecutionResult): void;
}

/** Presents the single completion outcome owned by a unified Sync transaction. */
export class SyncResultNotifier implements SyncResultNotificationPort {
    constructor(private readonly showNotice: (message: string) => void) {}

    notify(result: SyncExecutionResult): void {
        const details = this.summary(result);
        if (!details) return;
        this.showNotice(t(this.messageKey(result), { details }));
    }

    private messageKey(result: SyncExecutionResult): 'sourceControl.notice.sync.success' | 'sourceControl.notice.sync.partial' | 'sourceControl.notice.sync.failed' {
        if (result.failed > 0 || result.conflicts > 0 || result.skippedConflicts > 0) {
            return this.hasSuccessfulWork(result) ? 'sourceControl.notice.sync.partial' : 'sourceControl.notice.sync.failed';
        }
        return 'sourceControl.notice.sync.success';
    }

    private hasSuccessfulWork(result: SyncExecutionResult): boolean {
        return result.added + result.updated + result.moved + result.deleted + result.downloaded + result.acceptedRemote > 0;
    }

    private summary(result: SyncExecutionResult): string {
        const parts = [
            this.count(result.added, 'added'),
            this.count(result.updated, 'updated'),
            this.count(result.moved, 'moved'),
            this.count(result.deleted, 'deleted'),
            this.count(result.downloaded, 'downloaded'),
            this.count(result.acceptedRemote, 'acceptedRemote'),
            this.count(result.failed, 'failed'),
            this.count(result.conflicts, 'conflicts'),
            this.count(result.skippedConflicts, 'skippedConflicts'),
        ].filter((part): part is string => part !== undefined);
        return parts.join(', ');
    }

    private count(value: number, kind: 'added' | 'updated' | 'moved' | 'deleted' | 'downloaded' | 'acceptedRemote' | 'failed' | 'conflicts' | 'skippedConflicts'): string | undefined {
        if (value === 0) return undefined;
        return t(COUNT_KEYS[kind], { count: value });
    }
}
