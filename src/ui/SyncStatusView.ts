import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, setTooltip } from 'obsidian';
import GitLabFilesPush from '../main';
import { getServiceName } from '../settings';
import { ConfirmModal } from './ConfirmModal';
import { logger } from '../utils/logger';
import { type FileStatus, type FilterValue } from './types';
import { renderActionBar } from './components/ActionBar';
import { renderFileItem } from './components/FileListItem';

export const SYNC_STATUS_VIEW_TYPE = 'sync-status-view';

export class SyncStatusView extends ItemView {
    plugin: GitLabFilesPush;
    private readonly fileStatuses: Map<string, FileStatus> = new Map();
    private isRefreshing = false;
    private statusFilter: FilterValue = 'all';
    private readonly selectedFiles: Set<string> = new Set();
    private lastSyncTime: number = 0;

    constructor(leaf: WorkspaceLeaf, plugin: GitLabFilesPush) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return SYNC_STATUS_VIEW_TYPE; }
    getDisplayText(): string { return 'Sync status'; }
    getIcon(): string { return 'git-compare'; }

    onOpen(): Promise<void> {
        const container = this.containerEl.children[1];
        if (!container) return Promise.resolve();
        container.empty();
        container.addClass('sync-status-view');
        this.renderView();
        return Promise.resolve();
    }

    private renderView(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        if (!container) return;
        container.empty();

        this.renderInfoStrip(container);
        this.renderTabs(container);
        this.renderActionBarSection(container);

        const listEl = container.createDiv({ cls: 'ssv-list' });
        if (this.fileStatuses.size === 0) {
            listEl.createDiv({ cls: 'ssv-empty', text: 'Click "Refresh" to check sync status' });
        } else {
            this.renderFileList(listEl);
        }
    }

    // ── Info strip ─────────────────────────────────────────────────

    private renderInfoStrip(container: HTMLElement): void {
        const el = container.createDiv({ cls: 'ssv-info' });
        const serviceName = getServiceName(this.plugin.settings);

        el.createSpan({ cls: 'ssv-info-item', text: serviceName });

        if (!Platform.isMobile) {
            el.createSpan({ cls: 'ssv-info-sep', text: '·' });
            el.createSpan({ cls: 'ssv-info-item' }).textContent = `⎇ ${this.plugin.settings.branch}`;
        }

        if (this.plugin.settings.vaultFolder) {
            el.createSpan({ cls: 'ssv-info-sep', text: '·' });
            el.createSpan({ cls: 'ssv-info-item', text: `📁 ${this.plugin.settings.vaultFolder}` });
        }

        if (this.lastSyncTime > 0) {
            el.createSpan({ cls: 'ssv-info-sep', text: '·' });
            el.createSpan({
                cls: 'ssv-info-time',
                text: Platform.isMobile
                    ? new Date(this.lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : `Last sync: ${new Date(this.lastSyncTime).toLocaleTimeString()}`
            });
        }
    }

    // ── Filter tabs ─────────────────────────────────────────────────

    private renderTabs(container: HTMLElement): void {
        const all = Array.from(this.fileStatuses.values());
        const counts: Record<FilterValue, number> = {
            all: all.length,
            synced: all.filter(s => s.status === 'synced').length,
            modified: all.filter(s => s.status === 'modified').length,
            unsynced: all.filter(s => s.status === 'unsynced').length,
            'remote-only': all.filter(s => s.status === 'remote-only').length,
        };

        const tabs: Array<{ value: FilterValue; label: string; icon: string }> = [
            { value: 'all',         label: 'All',        icon: '' },
            { value: 'synced',      label: 'Synced',     icon: '✓' },
            { value: 'modified',    label: 'Changed',    icon: '⚠' },
            { value: 'unsynced',    label: 'Local only', icon: '↑' },
            { value: 'remote-only', label: 'Remote',     icon: '↓' },
        ];

        const tabsEl = container.createDiv({ cls: 'ssv-tabs' });
        for (const tab of tabs) {
            const btn = tabsEl.createEl('button', {
                cls: `ssv-tab${this.statusFilter === tab.value ? ' active' : ''}`
            });
            if (tab.icon) btn.createSpan({ text: tab.icon });
            btn.createSpan({ cls: 'ssv-tab-label', text: ` ${tab.label}` });
            const count = counts[tab.value];
            if (tab.value === 'all' || count > 0) {
                btn.createSpan({ cls: 'ssv-tab-count', text: String(count) });
            }
            setTooltip(btn, tab.label);
            btn.addEventListener('click', () => {
                if (this.statusFilter !== tab.value) this.selectedFiles.clear();
                this.statusFilter = tab.value;
                this.renderView();
            });
        }
    }

    // ── Action bar ─────────────────────────────────────────────────

    private renderActionBarSection(container: HTMLElement): void {
        const all = Array.from(this.fileStatuses.values());
        const visible = this.statusFilter === 'all' ? all : all.filter(s => s.status === this.statusFilter);
        const selected = Array.from(this.selectedFiles)
            .map(p => this.fileStatuses.get(p))
            .filter(Boolean) as FileStatus[];

        const allSelected = visible.length > 0 && visible.every(s => this.selectedFiles.has(s.path));

        renderActionBar(container, {
            hasFiles:      this.fileStatuses.size > 0,
            allSelected,
            indeterminate: this.selectedFiles.size > 0 && !allSelected,
            canPush:   selected.filter(s => s.file && (s.status === 'modified' || s.status === 'unsynced')).length,
            canPull:   selected.filter(s => s.status === 'modified' || s.status === 'remote-only').length,
            canDelete: selected.filter(s => s.file || s.status === 'remote-only').length,
        }, {
            onRefresh:   () => void this.refreshAllStatuses(),
            onSelectAll: (select) => {
                if (select) { for (const s of visible) this.selectedFiles.add(s.path); }
                else { this.selectedFiles.clear(); }
                this.renderView();
            },
            onPush:   () => void this.pushSelected(),
            onPull:   () => void this.pullSelected(),
            onDelete: () => void this.deleteSelected(),
        });
    }

    // ── File list ──────────────────────────────────────────────────

    private renderFileList(container: HTMLElement): void {
        const all = Array.from(this.fileStatuses.values());
        const statuses = this.statusFilter === 'all'
            ? all
            : all.filter(s => s.status === this.statusFilter);

        if (statuses.length === 0) {
            container.createDiv({ cls: 'ssv-empty', text: `No ${this.statusFilter} files` });
            return;
        }

        for (const fs of statuses) {
            renderFileItem(container, fs, this.selectedFiles.has(fs.path), {
                onSelect: (path, selected) => {
                    if (selected) this.selectedFiles.add(path);
                    else this.selectedFiles.delete(path);
                    this.renderView();
                },
                onPush:   (fileStatus) => void this.runSingleFile(fileStatus, 'push'),
                onPull:   (fileStatus) => void this.runSingleFile(fileStatus, 'pull'),
                onDelete: (fileStatus) => void this.handleLocalDelete(fileStatus),
            });
        }
    }

    // ── Single-file operations ──────────────────────────────────────

    private async handleLocalDelete(fileStatus: FileStatus): Promise<void> {
        const confirmed = await this.showConfirmDialog(`Delete local file "${fileStatus.path}"?`);
        if (!confirmed) return;
        try {
            if (fileStatus.file) {
                await this.app.fileManager.trashFile(fileStatus.file);
            } else {
                await this.app.vault.adapter.remove(fileStatus.path);
            }
            new Notice(`Deleted ${fileStatus.path}`);
            this.fileStatuses.delete(fileStatus.path);
            this.renderView();
        } catch (e) {
            new Notice(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async runSingleFile(fileStatus: FileStatus, op: 'push' | 'pull'): Promise<void> {
        try {
            fileStatus.status = 'checking';
            this.renderView();

            if (op === 'push') {
                await this.plugin.sync.pushFile(fileStatus.file || fileStatus.path);
            } else {
                await this.plugin.sync.pullFile(fileStatus.file || fileStatus.path);
            }

            // eslint-disable-next-line no-undef
            await new Promise(r => activeWindow.setTimeout(r, 500));
            await this.refreshFileStatus(fileStatus.file || fileStatus.path);
            this.renderView();
        } catch (e) {
            new Notice(`${op === 'push' ? 'Push' : 'Pull'} failed: ${e instanceof Error ? e.message : String(e)}`);
            await this.refreshFileStatus(fileStatus.file || fileStatus.path);
            this.renderView();
        }
    }

    // ── Batch / refresh operations ─────────────────────────────────

    async refreshAllStatuses(): Promise<void> {
        if (this.isRefreshing) {
            new Notice('Already refreshing…');
            return;
        }

        this.isRefreshing = true;
        this.fileStatuses.clear();
        this.showProgressIndicator();

        try {
            const files = await this.discoverFiles();
            this.initializeFileStatuses(files.local);
            const extra = await this.identifyExtraFiles(files.remote, files.localMap, files.allMap);
            this.addExtraToStatuses(extra);

            this.renderView();

            const filesToCheck = this.getCheckableFiles(files.local, extra);
            await this.performStatusCheck(filesToCheck);

            this.lastSyncTime = Date.now();
            this.renderView();
            new Notice(`Checked ${files.local.length} local + ${files.remote.length} remote files`);
        } catch (e) {
            new Notice(`Failed to refresh: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.isRefreshing = false;
        }
    }

    private showProgressIndicator(): void {
        const container = this.containerEl.children[1];
        if (!container) return;
        const listEl = container.querySelector('.ssv-list');
        if (!listEl) return;
        listEl.empty();
        const prog = listEl.createDiv({ cls: 'ssv-progress' });
        prog.createDiv({ cls: 'ssv-progress-text', text: 'Checking files…' });
        const bar = prog.createDiv({ cls: 'ssv-progress-bar' });
        bar.createDiv({ cls: 'ssv-progress-fill' }).setAttr('style', 'width: 0%');
    }

    private async discoverFiles() {
        const allFiles = this.app.vault.getFiles();
        let local = this.plugin.filterFilesByVaultFolder(allFiles);
        let remote = await this.plugin.gitService.listFiles(this.plugin.settings.branch);

        await this.plugin.gitignoreManager.loadGitignores();
        remote = remote.filter(p => !this.plugin.gitignoreManager.isIgnored(p));
        local  = local.filter(f => !this.plugin.gitignoreManager.isIgnored(f.path));

        return {
            local,
            remote,
            localMap: new Set(local.map(f => f.path)),
            allMap:   new Map<string, TFile>(allFiles.map(f => [f.path, f]))
        };
    }

    private initializeFileStatuses(localFiles: TFile[]): void {
        for (const file of localFiles) {
            this.fileStatuses.set(file.path, { file, path: file.path, status: 'checking' });
        }
    }

    private async identifyExtraFiles(remoteFiles: string[], localFilePaths: Set<string>, allLocalFileMap: Map<string, TFile>) {
        const extra: Array<TFile | string> = [];
        for (const remotePath of remoteFiles) {
            if (localFilePaths.has(remotePath)) continue;

            let localFile = allLocalFileMap.get(remotePath);
            if (!localFile) {
                const abs = this.app.vault.getAbstractFileByPath(remotePath);
                if (abs instanceof TFile) localFile = abs;
            }

            if (localFile) {
                extra.push(localFile);
            } else if (await this.app.vault.adapter.exists(remotePath)) {
                extra.push(remotePath);
            } else {
                this.fileStatuses.set(remotePath, { path: remotePath, status: 'remote-only' });
            }
        }
        return extra;
    }

    private addExtraToStatuses(extra: Array<TFile | string>): void {
        for (const item of extra) {
            const path = typeof item === 'string' ? item : item.path;
            const file = typeof item === 'string' ? undefined : item;
            this.fileStatuses.set(path, { file, path, status: 'checking' });
        }
    }

    private getCheckableFiles(local: TFile[], extra: Array<TFile | string>) {
        return ([...local, ...extra] as Array<TFile | string>).filter(f => {
            const p = typeof f === 'string' ? f : f.path;
            return !this.plugin.gitignoreManager.isIgnored(p);
        });
    }

    private async performStatusCheck(filesToCheck: Array<TFile | string>): Promise<void> {
        const total = filesToCheck.length;
        for (let i = 0; i < total; i++) {
            const file = filesToCheck[i];
            if (file) await this.refreshFileStatus(file);
            this.updateRefreshProgress(i + 1, total);
        }
    }

    private updateRefreshProgress(current: number, total: number): void {
        const c = this.containerEl.children[1];
        if (!c) return;
        const fill = c.querySelector('.ssv-progress-fill');
        const text = c.querySelector('.ssv-progress-text');
        if (fill && text) {
            const pct = Math.round((current / total) * 100);
            fill.setAttr('style', `width: ${pct}%`);
            text.textContent = `Checking files… ${current}/${total} (${pct}%)`;
        }
    }

    private async refreshFileStatus(fileOrPath: TFile | string): Promise<void> {
        try {
            const isStr = typeof fileOrPath === 'string';
            const path = isStr ? fileOrPath : fileOrPath.path;
            const file = isStr ? undefined : fileOrPath;

            const localContent = isStr
                ? await this.app.vault.adapter.read(fileOrPath)
                : await this.app.vault.read(fileOrPath);

            const remote = await this.plugin.gitService.getFile(path, this.plugin.settings.branch);

            let status: FileStatus['status'];
            let diff: string | undefined;

            if (!remote.sha) {
                status = 'unsynced';
            } else if (localContent === remote.content) {
                status = 'synced';
            } else {
                status = 'modified';
                diff = this.generateDiff(remote.content, localContent);
            }

            this.fileStatuses.set(path, { file, path, status, localContent, remoteContent: remote.content, remoteSha: remote.sha, diff });
        } catch {
            const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
            this.fileStatuses.set(path, {
                file: typeof fileOrPath === 'string' ? undefined : fileOrPath,
                path,
                status: 'unsynced'
            });
        }
    }

    private generateDiff(oldContent: string, newContent: string): string {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        const diff = ['--- Remote', '+++ Local', ''];
        const maxLines = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < maxLines; i++) {
            const o = oldLines[i], n = newLines[i];
            if (o !== n) {
                if (o !== undefined) diff.push(`- ${o}`);
                if (n !== undefined) diff.push(`+ ${n}`);
            }
        }
        return diff.join('\n');
    }

    // ── Batch push/pull/delete ─────────────────────────────────────

    async pushAllModified(): Promise<void> { await this.runBatchOperation('modified', 'push'); }
    async pullAllModified(): Promise<void> { await this.runBatchOperation('modified', 'pull'); }
    async pushSelected():   Promise<void> { await this.runBatchOperation('selected', 'push'); }
    async pullSelected():   Promise<void> { await this.runBatchOperation('selected', 'pull'); }

    private async runBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull'): Promise<void> {
        const targets = Array.from(this.fileStatuses.values()).filter(s => {
            if (filter === 'selected' && !this.selectedFiles.has(s.path)) return false;
            return op === 'push'
                ? s.status === 'modified' || s.status === 'unsynced'
                : s.status === 'modified' || s.status === 'remote-only';
        });

        if (targets.length === 0) {
            new Notice(`No ${op}able files ${filter === 'selected' ? 'selected' : 'found'}.`);
            return;
        }

        const files = targets.map(s => s.file || s.path);
        const serviceName = getServiceName(this.plugin.settings);
        const msg = op === 'push'
            ? `Push ${files.length} file(s) to ${serviceName}?`
            : `Pull ${files.length} file(s) from ${serviceName}? This will overwrite local changes.`;

        if (!await this.showConfirmDialog(msg)) return;

        const prog = new Notice(`${op === 'push' ? 'Pushing' : 'Pulling'} 0/${files.length} files…`, 0);
        try {
            const results = op === 'push'
                ? await this.plugin.sync.pushAllFiles(files, (cur, total, name) => prog.setMessage(`Pushing ${cur}/${total}: ${name}`))
                : await this.plugin.sync.pullAllFiles(files, (cur, total, name) => prog.setMessage(`Pulling ${cur}/${total}: ${name}`));

            prog.hide();
            if (results.errors.length > 0) logger.error(`${op} errors:`, results.errors);
            if (filter === 'selected') this.selectedFiles.clear();
            new Notice(`${op === 'push' ? 'Push' : 'Pull'} completed. Refreshing…`);
            await this.refreshAllStatuses();
        } catch (e) {
            prog.hide();
            new Notice(`${op === 'push' ? 'Push' : 'Pull'} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async deleteSelected(): Promise<void> {
        const targets = this.getSelectedTargets();
        if (targets.length === 0) return;

        const { local, remote } = this.partitionTargets(targets);
        if (local.length === 0 && remote.length === 0) { new Notice('Nothing to delete'); return; }
        if (!await this.confirmDeletion(local.length, remote.length)) return;

        const total = local.length + remote.length;
        const prog = new Notice(`Deleting 0/${total} files…`, 0);
        const errors: string[] = [];

        await this.performLocalDeletion(local, total, prog, errors);
        await this.performRemoteDeletion(remote, total, local.length, prog, errors);

        prog.hide();
        new Notice(errors.length > 0
            ? `Deleted ${total - errors.length}/${total}. ${errors.length} failed.`
            : `Deleted ${total} files`
        );
        this.renderView();
    }

    private getSelectedTargets(): FileStatus[] {
        if (this.selectedFiles.size === 0) { new Notice('No files selected'); return []; }
        return Array.from(this.selectedFiles)
            .map(p => this.fileStatuses.get(p))
            .filter(Boolean) as FileStatus[];
    }

    private partitionTargets(targets: FileStatus[]) {
        return {
            local:  targets.filter(s => s.status !== 'remote-only'),
            remote: targets.filter(s => s.status === 'remote-only')
        };
    }

    private async confirmDeletion(localCount: number, remoteCount: number): Promise<boolean> {
        let msg = '';
        if (localCount > 0 && remoteCount > 0) msg = `Delete ${localCount} local + ${remoteCount} remote file(s)? Cannot be undone.`;
        else if (localCount > 0) msg = `Delete ${localCount} local file(s)? Cannot be undone.`;
        else msg = `Delete ${remoteCount} remote file(s)? Cannot be undone.`;
        return this.showConfirmDialog(msg);
    }

    private async performLocalDeletion(local: FileStatus[], total: number, prog: Notice, errors: string[]): Promise<void> {
        let cur = 0;
        for (const s of local) {
            cur++;
            prog.setMessage(`Deleting local ${cur}/${total}: ${s.path}`);
            try {
                if (s.file) await this.app.fileManager.trashFile(s.file);
                else await this.app.vault.adapter.remove(s.path);
                this.fileStatuses.delete(s.path);
                this.selectedFiles.delete(s.path);
            } catch { errors.push(s.path); }
        }
    }

    private async performRemoteDeletion(remote: FileStatus[], total: number, localCount: number, prog: Notice, errors: string[]): Promise<void> {
        let cur = localCount;
        for (const s of remote) {
            cur++;
            prog.setMessage(`Deleting remote ${cur}/${total}: ${s.path}`);
            try {
                await this.plugin.gitService.deleteFile(s.path, this.plugin.settings.branch, `Delete ${s.path}`);
                this.fileStatuses.delete(s.path);
                this.selectedFiles.delete(s.path);
            } catch { errors.push(s.path); }
        }
    }

    onClose(): Promise<void> { return Promise.resolve(); }

    private showConfirmDialog(message: string): Promise<boolean> {
        return new Promise(resolve => {
            new ConfirmModal(this.app, message, () => resolve(true), () => resolve(false)).open();
        });
    }
}
