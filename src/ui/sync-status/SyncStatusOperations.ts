import { type App, Notice } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { PushResults, SyncPlan } from '../../logic/sync/types';
import type { SyncWorkspace } from '../../logic/sync/SyncWorkspace';
import type { FileStatus, SyncStatusService } from '../../logic/sync-status-service';
import { logger } from '../../utils/logger';
import { ConfirmModal } from '../ConfirmModal';
import { SyncPlanModal } from '../SyncPlanModal';
import type { SyncStatusRefreshService } from '../../logic/sync/SyncStatusRefreshService';
import type { SyncStatusViewState } from './SyncStatusViewState';
import type { SyncStatusNavigator } from './SyncStatusNavigator';

type BatchFilter = 'modified' | 'selected';
type SyncOperation = 'push' | 'pull';

const NO_RUNNABLE_FILES_KEYS: Record<SyncOperation, Record<'selected' | 'found', TranslationKey>> = {
    push: { selected: 'syncStatus.notice.noPushableFiles.selected', found: 'syncStatus.notice.noPushableFiles.found' },
    pull: { selected: 'syncStatus.notice.noPullableFiles.selected', found: 'syncStatus.notice.noPullableFiles.found' },
};

/** Orchestrates sync-status commands while the View only forwards UI events. */
export class SyncStatusOperations {
    constructor(
        private readonly app: App,
        private readonly workspace: SyncWorkspace,
        private readonly statuses: SyncStatusService,
        private readonly state: SyncStatusViewState,
        private readonly statusRefresh: SyncStatusRefreshService,
        private readonly navigator: SyncStatusNavigator,
        private readonly render: () => void,
        private readonly refresh: () => Promise<void>,
    ) {}

    async revertMove(status: FileStatus): Promise<void> {
        if (!status.movedFrom) return;
        const confirmed = await this.confirm(t('syncStatus.confirmRevertMove', { from: status.path, to: status.movedFrom }));
        if (!confirmed) return;
        try {
            await this.moveBack(status);
            new Notice(t('syncStatus.notice.moveReverted', { path: status.movedFrom }));
            await this.refresh();
        } catch (error) {
            new Notice(t('syncStatus.notice.revertFailed', { message: this.errorMessage(error) }));
        }
    }

    async pushMoveGroup(members: FileStatus[]): Promise<void> {
        try {
            const results = await this.workspace.push(members.map(member => member.path));
            this.markSynced(results.syncedPaths);
            this.render();
        } catch (error) {
            new Notice(t('syncStatus.notice.opFailed', { verb: t('main.verb.push'), message: this.errorMessage(error) }));
        }
    }

    async revertMoveGroup(members: FileStatus[]): Promise<void> {
        if (!await this.confirm(t('syncStatus.confirmRevertMoveGroup', { count: members.length }))) return;
        for (const member of members) {
            if (!member.movedFrom) continue;
            try {
                await this.moveBack(member);
            } catch (error) {
                logger.warn(`Failed to revert move for ${member.path}`, error);
            }
        }
        new Notice(t('syncStatus.notice.moveReverted', { path: `${members.length} file(s)` }));
        await this.refresh();
    }

    async deleteLocal(status: FileStatus): Promise<void> {
        if (!await this.confirm(t('syncStatus.confirmDeleteLocal', { path: status.path }))) return;
        try {
            await this.workspace.deleteLocal(status.path);
            new Notice(t('syncStatus.notice.deleted', { path: status.path }));
            this.statuses.delete(status.path);
            this.render();
        } catch (error) {
            new Notice(t('syncStatus.notice.deleteFailed', { message: this.errorMessage(error) }));
        }
    }

    async runSingle(status: FileStatus, operation: SyncOperation): Promise<void> {
        const runVerb = operation === 'push' ? t('main.verb.pushing') : t('main.verb.pulling');
        const progress = new Notice(t('syncStatus.notice.opStarted', { verb: runVerb, name: status.path }), 0);
        try {
            this.statuses.set({ ...status, status: 'checking' });
            this.navigator.closeDiffFor([status.path]);
            this.render();
            await this.executeSingle(status, operation);
            progress.hide();
            this.render();
        } catch (error) {
            progress.hide();
            const verb = operation === 'push' ? t('main.verb.push') : t('main.verb.pull');
            new Notice(t('syncStatus.notice.opFailed', { verb, message: this.errorMessage(error) }));
            await this.statusRefresh.refreshFileStatusByContent(status.file || status.path);
            this.render();
        }
    }

    async runBatch(filter: BatchFilter, operation: SyncOperation): Promise<void> {
        const targets = this.runnableStatuses(operation, filter === 'selected' ? this.state.selectedFiles : undefined);
        if (targets.length === 0) {
            const scope = filter === 'selected' ? 'selected' : 'found';
            new Notice(t(NO_RUNNABLE_FILES_KEYS[operation][scope]));
            return;
        }
        const files = targets.map(status => status.path);
        if (!await this.confirmBatch(operation, files.length)) return;
        await this.executeBatch(filter, operation, files);
    }

    async runPaths(paths: readonly string[], operation: SyncOperation): Promise<void> {
        const targets = this.runnableStatuses(operation, new Set(paths));
        if (targets.length === 0) {
            new Notice(t(NO_RUNNABLE_FILES_KEYS[operation].selected));
            return;
        }
        const files = targets.map(status => status.path);
        if (!await this.confirmBatch(operation, files.length)) return;
        await this.executeBatch('selected', operation, files);
    }

    async executeBatch(filter: BatchFilter, operation: SyncOperation, files: string[]): Promise<void> {
        const runVerb = operation === 'push' ? t('main.verb.pushing') : t('main.verb.pulling');
        const progress = new Notice(t('main.progress.running', { verb: runVerb, total: files.length }), 0);
        this.navigator.closeDiffFor(files);
        try {
            const results = operation === 'push'
                ? await this.workspace.push(files, (current, total, name) => progress.setMessage(t('syncStatus.progress.pushing', { current, total, name })))
                : await this.workspace.pull(files, (current, total, name) => progress.setMessage(t('syncStatus.progress.pulling', { current, total, name })));
            progress.hide();
            if (results.errors.length > 0) logger.error(`${operation} errors:`, results.errors);
            if (filter === 'selected') this.state.clearSelection();
            const doneVerb = operation === 'push' ? t('main.verb.push') : t('main.verb.pull');
            new Notice(t('syncStatus.notice.opCompleted', { verb: doneVerb }));
            if (operation === 'push') {
                this.markSynced((results as PushResults).syncedPaths);
                this.render();
            } else {
                await this.refresh();
            }
        } catch (error) {
            progress.hide();
            const verb = operation === 'push' ? t('main.verb.push') : t('main.verb.pull');
            new Notice(t('syncStatus.notice.opFailed', { verb, message: this.errorMessage(error) }));
        }
    }

    async deletePaths(paths: readonly string[]): Promise<void> {
        const targets = [...new Set(paths)]
            .map(path => this.statuses.get(path))
            .filter((status): status is FileStatus => status !== undefined);
        if (targets.length === 0) {
            if (this.state.selectedFiles.size === 0) new Notice(t('syncStatus.notice.noFilesSelected'));
            return;
        }
        const { local, remote } = this.partitionTargets(targets);
        if (local.length === 0 && remote.length === 0) {
            new Notice(t('syncStatus.notice.nothingToDelete'));
            return;
        }
        if (!await this.confirmDeletion(local, remote)) return;

        const total = local.length + remote.length;
        const progress = new Notice(t('syncStatus.progress.deleting', { total }), 0);
        const errors: Array<{ path: string; message: string }> = [];
        await this.performLocalDeletion(local, total, progress, errors);
        await this.performRemoteDeletion(remote, total, local.length, progress, errors);
        progress.hide();
        this.notifyDeleteResult(total, errors);
        this.render();
    }

    async confirmDeletion(local: FileStatus[], remote: FileStatus[]): Promise<boolean> {
        if (remote.length === 0) return this.confirm(t('syncStatus.confirmDelete.localOnly', { local: local.length }));
        const plan: SyncPlan = {
            additions: [],
            modifications: [],
            moves: [],
            deletions: remote.map(status => ({
                path: status.path,
                name: status.file?.name ?? status.path.split('/').pop() ?? status.path,
            })),
        };
        const description = local.length > 0 ? t('syncStatus.confirmDelete.alsoLocal', { local: local.length }) : undefined;
        return new Promise(resolve => {
            new SyncPlanModal(this.app, plan, 'delete', () => resolve(true), () => resolve(false), description).open();
        });
    }

    async performRemoteDeletion(
        remote: FileStatus[],
        total: number,
        localCount: number,
        progress: Notice,
        errors: Array<{ path: string; message: string }>,
    ): Promise<void> {
        if (remote.length === 0) return;
        const result = await this.workspace.deleteRemote(
            remote.map(status => status.path),
            (current, path) => progress.setMessage(t('syncStatus.progress.deletingRemote', {
                current: localCount + current,
                total,
                path,
            })),
        );
        errors.push(...result.errors);
        for (const path of result.deletedPaths) {
            this.statuses.delete(path);
            this.state.deselect(path);
        }
    }

    private async executeSingle(status: FileStatus, operation: SyncOperation): Promise<void> {
        const file = status.file || status.path;
        if (operation === 'pull') {
            await this.workspace.pullOne(status.path);
            await this.statusRefresh.refreshFileStatusByContent(file);
            return;
        }
        const results = await this.workspace.push([status.path]);
        const synced = results.syncedPaths.find(path => path.path === status.path);
        if (synced) this.markSynced([synced]);
        else await this.statusRefresh.refreshFileStatusByContent(file);
    }

    private runnableStatuses(operation: SyncOperation, paths?: ReadonlySet<string>): FileStatus[] {
        return Array.from(this.statuses.values()).filter(status => {
            if (paths && !paths.has(status.path)) return false;
            return operation === 'push'
                ? ['modified', 'unsynced', 'moved'].includes(status.status)
                : ['modified', 'remote-only'].includes(status.status);
        });
    }

    private async confirmBatch(operation: SyncOperation, count: number): Promise<boolean> {
        const service = this.workspace.getInfo().serviceName;
        const message = operation === 'push'
            ? t('syncStatus.confirm.pushSelected', { count, service })
            : t('syncStatus.confirm.pullSelected', { count, service });
        return this.confirm(message);
    }

    private markSynced(paths: Array<{ path: string; sha?: string }>): void {
        for (const { path, sha } of paths) this.statuses.markSynced(path, sha);
    }

    private async moveBack(status: FileStatus): Promise<void> {
        const target = status.movedFrom;
        if (!target) return;
        await this.workspace.moveLocal(status.path, target);
    }

    private partitionTargets(targets: FileStatus[]): { local: FileStatus[]; remote: FileStatus[] } {
        return {
            local: targets.filter(status => status.status !== 'remote-only' && status.status !== 'moved'),
            remote: targets.filter(status => status.status === 'remote-only'),
        };
    }

    private async performLocalDeletion(
        local: FileStatus[],
        total: number,
        progress: Notice,
        errors: Array<{ path: string; message: string }>,
    ): Promise<void> {
        let current = 0;
        for (const status of local) {
            current += 1;
            progress.setMessage(t('syncStatus.progress.deletingLocal', { current, total, path: status.path }));
            try {
                await this.workspace.deleteLocal(status.path);
                this.statuses.delete(status.path);
                this.state.deselect(status.path);
            } catch (error) {
                errors.push({ path: status.path, message: this.errorMessage(error) });
            }
        }
    }

    private notifyDeleteResult(total: number, errors: Array<{ path: string; message: string }>): void {
        if (errors.length === 0) {
            new Notice(t('syncStatus.notice.deleteResult.success', { total }));
            return;
        }
        logger.error('Delete errors:', errors);
        new Notice(t('syncStatus.notice.deleteResult.partialWithMessage', {
            succeeded: total - errors.length,
            total,
            failed: errors.length,
            message: errors.map(error => error.message).join('; '),
        }));
    }

    private confirm(message: string): Promise<boolean> {
        return new Promise(resolve => {
            new ConfirmModal(this.app, message, () => resolve(true), () => resolve(false)).open();
        });
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
