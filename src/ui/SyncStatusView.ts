import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, setIcon, setTooltip } from 'obsidian';
import GitLabFilesPush from '../main';
import { getServiceName, getEffectiveSymlinkHandling } from '../settings';
import { ConfirmModal } from './ConfirmModal';
import { logger } from '../utils/logger';
import { type FileStatus, type FilterValue } from './types';
import { renderActionBar } from './components/ActionBar';
import { renderFileItem, statusMeta, type FileItemCallbacks } from './components/FileListItem';
import { ICONS } from './components/icons';
import { isBinaryPath, contentsEqual } from '../utils/path';

export const SYNC_STATUS_VIEW_TYPE = 'sync-status-view';

export class SyncStatusView extends ItemView {
    plugin: GitLabFilesPush;
    private readonly fileStatuses: Map<string, FileStatus> = new Map();
    private isRefreshing = false;
    private refreshProgress = { current: 0, total: 0 };
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

        if (this.isRefreshing) {
            this.renderProgressBar(listEl);
            this.renderCheckedFilesDuringRefresh(listEl);
        } else if (this.fileStatuses.size === 0) {
            listEl.createDiv({ cls: 'ssv-empty', text: 'Click "Refresh" to check sync status' });
        } else {
            this.renderFileList(listEl);
        }
    }

    private renderProgressBar(container: HTMLElement): void {
        const { current, total } = this.refreshProgress;
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        const prog = container.createDiv({ cls: 'ssv-progress' });
        prog.createDiv({
            cls: 'ssv-progress-text',
            text: total > 0 ? `Checking files… ${current}/${total} (${pct}%)` : 'Checking files…'
        });
        const bar = prog.createDiv({ cls: 'ssv-progress-bar' });
        bar.createDiv({ cls: 'ssv-progress-fill' }).setAttr('style', `width: ${pct}%`);
    }

    private renderCheckedFilesDuringRefresh(container: HTMLElement): void {
        const checked = Array.from(this.fileStatuses.values())
            .filter(s => s.status !== 'checking')
            .filter(s => this.statusFilter === 'all' || s.status === this.statusFilter);
        if (checked.length === 0) return;
        const checkedList = container.createDiv({ cls: 'ssv-list-checked' });
        const cb = this.fileItemCallbacks();
        for (const fs of checked) {
            renderFileItem(checkedList, fs, this.selectedFiles.has(fs.path), cb);
        }
    }

    // ── Info strip ─────────────────────────────────────────────────

    private renderInfoStrip(container: HTMLElement): void {
        const el = container.createDiv({ cls: 'ssv-info' });
        const serviceName = getServiceName(this.plugin.settings);

        el.createSpan({ cls: 'ssv-info-item', text: serviceName });

        if (!Platform.isMobile) {
            el.createSpan({ cls: 'ssv-info-sep', text: '·' });
            const branchItem = el.createSpan({ cls: 'ssv-info-item' });
            setIcon(branchItem.createSpan({ cls: 'ssv-info-icon' }), ICONS.branch);
            branchItem.createSpan({ text: ` ${this.plugin.settings.branch}` });
        }

        if (this.plugin.settings.vaultFolder) {
            el.createSpan({ cls: 'ssv-info-sep', text: '·' });
            const folderItem = el.createSpan({ cls: 'ssv-info-item' });
            setIcon(folderItem.createSpan({ cls: 'ssv-info-icon' }), ICONS.folder);
            folderItem.createSpan({ text: ` ${this.plugin.settings.vaultFolder}` });
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

        const tabs: Array<{ value: FilterValue; label: string }> = [
            { value: 'all',         label: 'All' },
            { value: 'synced',      label: 'Synced' },
            { value: 'modified',    label: 'Changed' },
            { value: 'unsynced',    label: 'Local only' },
            { value: 'remote-only', label: 'Remote' },
        ];

        const tabsEl = container.createDiv({ cls: 'ssv-tabs' });
        for (const tab of tabs) {
            const btn = tabsEl.createEl('button', {
                cls: `ssv-tab${this.statusFilter === tab.value ? ' active' : ''}`
            });
            // Share the status icon set with the file list so tabs never drift.
            if (tab.value !== 'all') {
                setIcon(btn.createSpan(), statusMeta(tab.value).icon);
            }
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
            canPush:   selected.filter(s => s.status === 'modified' || s.status === 'unsynced').length,
            canPull:   selected.filter(s => s.status === 'modified' || s.status === 'remote-only').length,
            canDelete: selected.length,
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

    private fileItemCallbacks(): FileItemCallbacks {
        return {
            onSelect: (path, selected) => {
                if (selected) this.selectedFiles.add(path);
                else this.selectedFiles.delete(path);
                this.renderView();
            },
            onPush:   (fs) => void this.runSingleFile(fs, 'push'),
            onPull:   (fs) => void this.runSingleFile(fs, 'pull'),
            onDelete: (fs) => void this.handleLocalDelete(fs),
        };
    }

    private renderFileList(container: HTMLElement): void {
        const all = Array.from(this.fileStatuses.values());
        const statuses = this.statusFilter === 'all'
            ? all
            : all.filter(s => s.status === this.statusFilter);

        if (statuses.length === 0) {
            container.createDiv({ cls: 'ssv-empty', text: `No ${this.statusFilter} files` });
            return;
        }

        const cb = this.fileItemCallbacks();
        for (const fs of statuses) {
            renderFileItem(container, fs, this.selectedFiles.has(fs.path), cb);
        }
    }

    // ── Single-file operations ──────────────────────────────────────

    private async handleLocalDelete(fileStatus: FileStatus): Promise<void> {
        const confirmed = await this.showConfirmDialog(`Delete local file "${fileStatus.path}"? Handled per your vault's "Deleted files" setting.`);
        if (!confirmed) return;
        try {
            if (fileStatus.file) {
                await this.app.fileManager.trashFile(fileStatus.file);
            } else {
                await this.app.vault.adapter.remove(fileStatus.path);
            }
            await this.plugin.sync.clearMetadata(fileStatus.path);
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

            await new Promise(r => window.setTimeout(r, 500));
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
        this.renderView(); // Show initial progress state

        try {
            const files = await this.discoverFiles();
            this.initializeFileStatuses(files.local);
            for (const hiddenPath of files.hiddenLocalPaths) {
                this.fileStatuses.set(hiddenPath, { path: hiddenPath, status: 'checking' });
            }
            const extra = await this.identifyExtraFiles(files.remoteMap, files.localMap, files.allMap);
            this.addExtraToStatuses(extra);

            // Re-render info/tabs but keep progress bar (renderView handles this)
            this.renderView();

            const filesToCheck = this.getCheckableFiles(files.local, extra, files.hiddenLocalPaths);
            await this.performStatusCheck(filesToCheck);

            this.lastSyncTime = Date.now();
            this.isRefreshing = false; // Set to false BEFORE final renderView
            this.renderView();
            new Notice(`Checked ${files.local.length + files.hiddenLocalPaths.size} local + ${files.remoteMap.size} remote files`);
        } catch (e) {
            this.isRefreshing = false;
            this.renderView();
            new Notice(`Failed to refresh: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async discoverFiles() {
        const allFiles = this.app.vault.getFiles();
        let local = this.plugin.filterFilesByVaultFolder(allFiles);
        const remoteEntries = await this.plugin.gitService.listFilesDetailed(this.plugin.settings.branch);

        await this.plugin.gitignoreManager.loadGitignores();

        // Map remote paths to vault paths
        const remoteMap = new Map<string, string>(); // vaultPath -> remoteFullPath
        const skipSymlinks = getEffectiveSymlinkHandling(this.plugin.settings) === 'skip';
        for (const entry of remoteEntries) {
            if (entry.symlink && skipSymlinks) continue; // Symlink handling: skip
            const normalized = this.getNormalizedRemotePath(entry.path);
            if (normalized === null) continue; // Not under rootPath

            const vaultPath = this.plugin.getVaultPath(normalized);
            if (!this.plugin.gitignoreManager.isIgnored(normalized)) {
                remoteMap.set(vaultPath, entry.path);
            }
        }

        local = local.filter(f => !this.plugin.gitignoreManager.isIgnored(this.plugin.getNormalizedPath(f.path)));

        // vault.getFiles() skips hidden dirs; scan them via adapter
        const hiddenLocalPaths = await this.discoverHiddenLocalFiles();
        const filteredHiddenPaths = new Set(
            hiddenLocalPaths
                .filter(p => this.plugin.filterPathByVaultFolder(p))
                .filter(p => !this.plugin.gitignoreManager.isIgnored(this.plugin.getNormalizedPath(p)))
        );

        return {
            local,
            remoteMap,
            localMap: new Set([...local.map(f => f.path), ...filteredHiddenPaths]),
            allMap:   new Map<string, TFile>(allFiles.map(f => [f.path, f])),
            hiddenLocalPaths: filteredHiddenPaths
        };
    }

    private getNormalizedRemotePath(remotePath: string): string | null {
        const rootPath = this.plugin.settings.rootPath;
        if (!rootPath) return remotePath;
        
        const cleanRoot = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
        if (remotePath.startsWith(cleanRoot)) {
            return remotePath.substring(cleanRoot.length);
        }
        if (remotePath === rootPath) return '';
        return null;
    }

    private async discoverHiddenLocalFiles(): Promise<string[]> {
        const result: string[] = [];
        const vaultFolder = this.plugin.settings.vaultFolder || '';
        await this.recursiveScan(vaultFolder, result);
        return result;
    }

    private async recursiveScan(folderPath: string, result: string[]): Promise<void> {
        try {
            const listing = await this.app.vault.adapter.list(folderPath);
            for (const file of listing.files) {
                if (this.isHidden(file)) {
                    result.push(file);
                }
            }
            for (const folder of listing.folders) {
                if (folder === '.git' || folder.endsWith('/.git')) continue;
                await this.recursiveScan(folder, result);
            }
        } catch { /* adapter may not support listing */ }
    }

    private isHidden(path: string): boolean {
        return path.split('/').some(part => part.startsWith('.'));
    }

    private initializeFileStatuses(localFiles: TFile[]): void {
        for (const file of localFiles) {
            this.fileStatuses.set(file.path, { file, path: file.path, status: 'checking' });
        }
    }

    private async identifyExtraFiles(remoteMap: Map<string, string>, localFilePaths: Set<string>, allLocalFileMap: Map<string, TFile>) {
        const extra: Array<TFile | string> = [];
        for (const [vaultPath] of remoteMap.entries()) {
            if (localFilePaths.has(vaultPath)) continue;

            let localFile = allLocalFileMap.get(vaultPath);
            if (!localFile) {
                const abs = this.app.vault.getAbstractFileByPath(vaultPath);
                if (abs instanceof TFile) localFile = abs;
            }

            if (localFile) {
                extra.push(localFile);
            } else if (await this.app.vault.adapter.exists(vaultPath)) {
                extra.push(vaultPath);
            } else {
                this.fileStatuses.set(vaultPath, { path: vaultPath, status: 'remote-only' });
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

    private getCheckableFiles(local: TFile[], extra: Array<TFile | string>, hiddenLocalPaths: Set<string> = new Set()): Array<TFile | string> {
        const extraPaths = new Set(extra.map(f => typeof f === 'string' ? f : f.path));
        // Hidden local files already in localMap won't appear in extra; add them directly
        const hiddenToAdd = [...hiddenLocalPaths].filter(p => !extraPaths.has(p));
        return ([...local, ...extra, ...hiddenToAdd] as Array<TFile | string>).filter(f => {
            const p = typeof f === 'string' ? f : f.path;
            return !this.plugin.gitignoreManager.isIgnored(this.plugin.getNormalizedPath(p));
        });
    }

    // Checks run with bounded concurrency (each file is an independent network
    // request) and the view is re-rendered on a throttle rather than once per
    // file, so a large vault refreshes far faster.
    private static readonly STATUS_CHECK_CONCURRENCY = 8;
    private static readonly RENDER_THROTTLE_MS = 150;

    private async performStatusCheck(filesToCheck: Array<TFile | string>): Promise<void> {
        const total = filesToCheck.length;
        this.refreshProgress = { current: 0, total };

        let next = 0;
        let lastRender = 0;
        const maybeRender = (force = false): void => {
            const now = Date.now();
            if (force || now - lastRender >= SyncStatusView.RENDER_THROTTLE_MS) {
                lastRender = now;
                this.renderView();
            }
        };

        const worker = async (): Promise<void> => {
            while (next < total) {
                const file = filesToCheck[next++];
                if (file) await this.refreshFileStatus(file);
                this.refreshProgress.current++;
                maybeRender();
            }
        };

        const workerCount = Math.min(SyncStatusView.STATUS_CHECK_CONCURRENCY, total);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        maybeRender(true);
    }

    private async refreshFileStatus(fileOrPath: TFile | string): Promise<void> {
        try {
            const isStr = typeof fileOrPath === 'string';
            const path = isStr ? fileOrPath : fileOrPath.path;
            const file = isStr ? undefined : fileOrPath;

            const binary = this.isBinary(path);
            const localContent = await this.readFileContent(fileOrPath, binary, isStr);

            // Important: Use SyncManager's logic which handles rootPath/vaultFolder mapping
            const repoPath = this.plugin.getNormalizedPath(path);
            const remote = await this.plugin.gitService.getFile(repoPath, this.plugin.settings.branch);

            const { status, diff } = this.determineFileStatus(binary, localContent, remote);

            this.fileStatuses.set(path, { file, path, status, localContent, remoteContent: remote.content, remoteSha: remote.sha, diff });
        } catch (e) {
            const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
            logger.warn(`Failed to determine sync status for ${path}`, e);
            this.fileStatuses.set(path, {
                file: typeof fileOrPath === 'string' ? undefined : fileOrPath,
                path,
                status: 'unsynced'
            });
        }
    }

    private async readFileContent(fileOrPath: TFile | string, binary: boolean, isStr: boolean): Promise<string | ArrayBuffer> {
        if (isStr) {
            return binary
                ? await this.app.vault.adapter.readBinary(fileOrPath as string)
                : await this.app.vault.adapter.read(fileOrPath as string);
        }
        if (fileOrPath instanceof TFile) {
            try {
                return binary
                    ? await this.app.vault.readBinary(fileOrPath)
                    : await this.app.vault.read(fileOrPath);
            } catch (e) {
                // Obsidian's cached vault.read can fail for symlinked files
                // (notably on mobile); fall back to reading the path directly.
                logger.warn(`vault.read failed for ${fileOrPath.path}; falling back to adapter`, e);
                return binary
                    ? await this.app.vault.adapter.readBinary(fileOrPath.path)
                    : await this.app.vault.adapter.read(fileOrPath.path);
            }
        }
        // This should not happen if isStr is false and fileOrPath is TFile
        throw new Error('Expected TFile when isStr is false');
    }

    private determineFileStatus(binary: boolean, localContent: string | ArrayBuffer, remote: { sha?: string; content?: string | ArrayBuffer }): { status: FileStatus['status']; diff?: string } {
        if (!remote.sha) {
            return { status: 'unsynced' };
        }
        if (remote.content && this.contentsEqual(localContent, remote.content)) {
            return { status: 'synced' };
        }
        const diff = this.computeDiff(binary, localContent, remote.content || '');
        return { status: 'modified', diff };
    }

    private computeDiff(binary: boolean, localContent: string | ArrayBuffer, remoteContent: string | ArrayBuffer): string {
        if (binary || typeof localContent !== 'string' || typeof remoteContent !== 'string') {
            return 'Binary file changed';
        }
        return this.generateDiff(remoteContent, localContent);
    }

    private isBinary(path: string): boolean { return isBinaryPath(path); }

    private contentsEqual(a: string | ArrayBuffer, b: string | ArrayBuffer): boolean {
        return contentsEqual(a, b);
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
        // Local deletes go through Obsidian's own trash handling, whose actual
        // destination (vault .trash/, OS trash, or permanent) depends on the
        // user's "Deleted files" setting — not something this plugin can read.
        // So local wording defers to that setting rather than promising
        // recoverability; remote deletes are unconditionally permanent.
        let msg = '';
        if (localCount > 0 && remoteCount > 0) {
            msg = `Delete ${localCount} local file(s) (per your vault's trash setting) and ${remoteCount} remote file(s) (cannot be undone)?`;
        } else if (localCount > 0) {
            msg = `Delete ${localCount} local file(s)? They'll be handled per your vault's "Deleted files" setting.`;
        } else {
            msg = `Delete ${remoteCount} remote file(s)? This cannot be undone.`;
        }
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
                await this.plugin.sync.clearMetadata(s.path);
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
