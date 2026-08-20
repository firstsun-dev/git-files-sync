import { ItemView, WorkspaceLeaf, TFile, Notice, debounce } from 'obsidian';
import GitLabFilesPush from '../../main';
import { logger } from '../../utils/logger';
import { type FileStatus, type FilterValue } from '../types';
import type { FileItemCallbacks } from '../components/FileListItem';
import { t } from '../../i18n';
import { SyncStatusService } from '../../logic/sync-status-service';
import { SyncStatusRefreshService } from '../../logic/sync/SyncStatusRefreshService';
import type { SyncWorkspace } from '../../logic/sync/SyncWorkspace';
import { SyncStatusViewState } from './SyncStatusViewState';
import { SyncStatusController } from './SyncStatusController';
import { SyncStatusNavigator, type SyncStatusOpenTarget } from './SyncStatusNavigator';
import { SyncStatusOperations } from './SyncStatusOperations';
import { SyncStatusRenderer } from './SyncStatusRenderer';
import { createSyncStatusComposition } from './SyncStatusComposition';
import {
    moveGroupKey,
    moveGroupPrefixes,
} from './SyncStatusSelectors';

export const SYNC_STATUS_VIEW_TYPE = 'sync-status-view';

export class SyncStatusView extends ItemView {
    private static readonly RENDER_THROTTLE_MS = 150;
    plugin: GitLabFilesPush;
    private readonly viewState = new SyncStatusViewState();
    private readonly controller: SyncStatusController;
    private readonly statusRefresh: SyncStatusRefreshService;
    private readonly navigator: SyncStatusNavigator;
    private readonly operations: SyncStatusOperations;
    private readonly renderer: SyncStatusRenderer;
    private readonly workspace: SyncWorkspace;
    private unsubscribeStatuses?: () => void;
    private readonly detachedStatusService = new SyncStatusService();
    private readonly renderStatusChanges = debounce(
        () => this.renderView(),
        SyncStatusView.RENDER_THROTTLE_MS,
        false,
    );
    private infoEl?: HTMLElement;
    private bodyEl?: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: GitLabFilesPush, controller?: SyncStatusController) {
        super(leaf);
        this.plugin = plugin;
        const composition = createSyncStatusComposition(
            this.app,
            this.plugin,
            this.viewState,
            this.fileStatuses,
            {
                render: () => this.renderView(),
                refresh: () => this.refreshAllStatuses(),
                refreshStatuses: () => this.refreshStatuses(),
            },
            controller,
        );
        this.statusRefresh = composition.statusRefresh;
        this.navigator = composition.navigator;
        this.operations = composition.operations;
        this.controller = composition.controller;
        this.renderer = composition.renderer;
        this.workspace = composition.workspace;
    }

    private get isRefreshing(): boolean { return this.viewState.refreshState.isRefreshing; }
    private set isRefreshing(value: boolean) { this.viewState.refreshState.isRefreshing = value; }
    private get refreshProgress(): { current: number; total: number } { return this.viewState.refreshState; }
    private set refreshProgress(value: { current: number; total: number }) {
        this.viewState.updateRefreshProgress(value.current, value.total);
    }
    private get statusFilter(): FilterValue { return this.viewState.statusFilter; }
    private set statusFilter(value: FilterValue) { this.viewState.setStatusFilter(value); }
    private get treeViewEnabled(): boolean { return this.viewState.treeViewEnabled; }
    private set treeViewEnabled(value: boolean) { this.viewState.setTreeViewEnabled(value); }
    private get showSyncedInAll(): boolean { return this.viewState.showSyncedInAll; }
    private set showSyncedInAll(value: boolean) { this.viewState.setShowSyncedInAll(value); }
    private get searchQuery(): string { return this.viewState.searchQuery; }
    private set searchQuery(value: string) { this.viewState.setSearchQuery(value); }
    private get selectedFiles(): Set<string> { return this.viewState.selectedFiles; }
    private get collapsedFolders(): Set<string> { return this.viewState.collapsedFolders; }
    private get expandedMoveGroups(): Set<string> { return this.viewState.expandedMoveGroups; }
    private get lastSyncTime(): number { return this.viewState.refreshState.lastSyncTime; }
    private set lastSyncTime(value: number) { this.viewState.refreshState.lastSyncTime = value; }

    private get fileStatuses(): SyncStatusService {
        return this.plugin.sync?.status ?? this.detachedStatusService;
    }

    getViewType(): string { return SYNC_STATUS_VIEW_TYPE; }
    getDisplayText(): string { return t('syncStatus.viewTitle'); }
    getIcon(): string { return 'git-compare'; }

    onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement | null;
        if (!container) return Promise.resolve();
        container.empty();
        container.addClass('sync-status-view');
        const header = container.createDiv({ cls: 'ssv-header' });
        this.infoEl = header.createDiv({ cls: 'ssv-info-slot' });
        this.renderer.renderSearchBox(header);
        this.bodyEl = container.createDiv({ cls: 'ssv-body' });
        this.unsubscribeStatuses = this.fileStatuses.subscribe(() => this.renderStatusChanges());
        this.renderView();
        return Promise.resolve();
    }

    private renderView(): void {
        if (this.infoEl && this.bodyEl) this.renderer.render(this.infoEl, this.bodyEl);
    }

    private searchedStatuses(): FileStatus[] { return this.renderer.searchedStatuses(); }
    private visibleStatuses(): FileStatus[] { return this.renderer.visibleStatuses(); }
    private sortAllStatuses(statuses: FileStatus[]): FileStatus[] { return this.renderer.sortStatuses(statuses); }
    private movedRowCount(statuses: FileStatus[]): number { return this.renderer.movedRowCount(statuses); }
    private fileItemCallbacks(): FileItemCallbacks { return this.renderer.fileCallbacks(); }

    async refreshAllStatuses(): Promise<void> { await this.controller.refresh(); }

    private async refreshStatuses(): Promise<void> {
        if (this.isRefreshing) {
            new Notice(t('syncStatus.notice.alreadyRefreshing'));
            return;
        }
        this.viewState.startRefresh();
        this.renderView();
        try {
            const result = await this.workspace.refresh(({ current, total }) => {
                this.viewState.updateRefreshProgress(current, total);
                this.renderStatusChanges();
            });
            this.viewState.finishRefresh(Date.now());
            this.renderView();
            new Notice(t('syncStatus.notice.refreshed', { local: result.localCount, remote: result.remoteCount }));
        } catch (error) {
            this.viewState.finishRefresh();
            this.renderView();
            new Notice(t('syncStatus.notice.refreshFailed', { message: error instanceof Error ? error.message : String(error) }));
        }
    }

    private async pushMoveGroup(members: FileStatus[]): Promise<void> { await this.operations.pushMoveGroup(members); }
    private async revertMoveGroup(members: FileStatus[]): Promise<void> { await this.operations.revertMoveGroup(members); }
    private async handleLocalDelete(status: FileStatus): Promise<void> { await this.operations.deleteLocal(status); }
    private async runSingleFile(status: FileStatus, operation: 'push' | 'pull'): Promise<void> {
        await this.operations.runSingle(status, operation);
    }

    private pruneSelectionToVisible(): void {
        this.renderer.pruneSelection();
    }


    private renderTabs(container: HTMLElement): void {
        this.renderer.renderTabs(container);
    }

    private async revertMove(fileStatus: FileStatus): Promise<void> {
        await this.operations.revertMove(fileStatus);
    }

    private async openDiffPane(fileStatus: FileStatus): Promise<void> {
        if (!this.fileStatuses.has(fileStatus.path)) this.fileStatuses.set(fileStatus);
        await this.navigator.openDiff(fileStatus.path);
    }

    private async openDiffPath(path: string): Promise<void> {
        if (this.fileStatuses.has(path)) await this.navigator.openDiff(path);
    }

    private closeDiffPaneFor(paths: Iterable<string>): void {
        this.navigator.closeDiffFor(paths);
    }

    private openTargetFor(fileStatus: FileStatus): SyncStatusOpenTarget | null {
        return this.navigator.targetFor(fileStatus);
    }

    private openFileFromRow(fileStatus: FileStatus, newLeaf: boolean): boolean {
        return this.navigator.openFile(fileStatus, newLeaf);
    }

    private async loadDiffContent(fileStatus: FileStatus): Promise<void> {
        try {
            if (!this.fileStatuses.has(fileStatus.path)) this.fileStatuses.set(fileStatus);
            await this.navigator.loadDiff(fileStatus.path);
        } catch (e) {
            logger.warn(`Failed to load diff content for ${fileStatus.path}`, e);
        }
    }

    private groupKey(fs: FileStatus): string | null {
        return moveGroupKey(fs);
    }

    private groupPrefixes(fs: FileStatus): { oldPrefix: string; newPrefix: string } | null {
        return moveGroupPrefixes(fs);
    }

    private collapsibleMoveGroups(statuses: FileStatus[]): Map<string, { oldPrefix: string; newPrefix: string; members: FileStatus[] }> {
        return this.renderer.collapsibleMoveGroups(statuses);
    }

    async handleFileModified(file: TFile): Promise<void> {
        if (await this.statusRefresh.handleFileModified(file)) this.renderView();
    }

    handleFileRenamed(file: TFile, oldPath: string): void {
        if (this.statusRefresh.handleFileRenamed(file, oldPath)) this.renderView();
    }

    async pushAllModified(): Promise<void> { await this.controller.pushAllModified(); }
    async pullAllModified(): Promise<void> { await this.controller.pullAllModified(); }
    async pushSelected():   Promise<void> { await this.controller.push([...this.selectedFiles]); }
    async pullSelected():   Promise<void> { await this.controller.pull([...this.selectedFiles]); }

    private async runBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull'): Promise<void> {
        await this.operations.runBatch(filter, op);
    }

    private async runPathBatchOperation(paths: readonly string[], op: 'push' | 'pull'): Promise<void> {
        await this.operations.runPaths(paths, op);
    }

    private async executeBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull', files: Array<string | TFile>): Promise<void> {
        await this.operations.executeBatch(filter, op, files.map(file => typeof file === 'string' ? file : file.path));
    }

    async deleteSelected(): Promise<void> {
        await this.controller.delete([...this.selectedFiles]);
    }

    private async deletePaths(paths: readonly string[]): Promise<void> {
        await this.operations.deletePaths(paths);
    }

    private async confirmDeletion(local: FileStatus[], remote: FileStatus[]): Promise<boolean> {
        return this.operations.confirmDeletion(local, remote);
    }

    private async performRemoteDeletion(remote: FileStatus[], total: number, localCount: number, prog: Notice, errors: { path: string, message: string }[]): Promise<void> {
        await this.operations.performRemoteDeletion(remote, total, localCount, prog, errors);
    }

    onClose(): Promise<void> {
        this.unsubscribeStatuses?.();
        this.unsubscribeStatuses = undefined;
        return Promise.resolve();
    }

}
