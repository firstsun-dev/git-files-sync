import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, setIcon, setTooltip } from 'obsidian';
import GitLabFilesPush from '../main';
import { getServiceName, getEffectiveSymlinkHandling, type SymlinkHandling } from '../settings';
import { ConfirmModal } from './ConfirmModal';
import { logger } from '../utils/logger';
import { type FileStatus, type FilterValue } from './types';
import { renderActionBar } from './components/ActionBar';
import { renderFileItem, statusMeta, type FileItemCallbacks } from './components/FileListItem';
import { ICONS } from './components/icons';
import { isBinaryPath, contentsEqual } from '../utils/path';
import { readLocalSymlinkTarget } from '../utils/symlink';
import { gitBlobSha } from '../utils/git-blob-sha';
import { type GitTreeEntry } from '../services/git-service-interface';
import { MAX_BATCH_PUSH_SIZE } from '../services/git-service-base';
import { t, type TranslationKey } from '../i18n';
import { type PushResults } from '../logic/sync-manager';

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
    getDisplayText(): string { return t('syncStatus.viewTitle'); }
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

        const prevListEl = container.querySelector<HTMLElement>('.ssv-list');
        const scrollTop = prevListEl?.scrollTop ?? 0;

        container.empty();

        this.renderInfoStrip(container);
        this.renderTabs(container);
        this.renderActionBarSection(container);

        const listEl = container.createDiv({ cls: 'ssv-list' });

        if (this.isRefreshing) {
            this.renderProgressBar(listEl);
            this.renderCheckedFilesDuringRefresh(listEl);
        } else if (this.fileStatuses.size === 0) {
            listEl.createDiv({ cls: 'ssv-empty', text: t('syncStatus.emptyPrompt') });
        } else {
            this.renderFileList(listEl);
        }

        listEl.scrollTop = scrollTop;
    }

    private renderProgressBar(container: HTMLElement): void {
        const { current, total } = this.refreshProgress;
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        const prog = container.createDiv({ cls: 'ssv-progress' });
        prog.createDiv({
            cls: 'ssv-progress-text',
            text: total > 0 ? t('syncStatus.progress.checkingWithCount', { current, total, pct }) : t('syncStatus.progress.checking')
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
                    : t('syncStatus.lastSync', { time: new Date(this.lastSyncTime).toLocaleTimeString() })
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
            { value: 'all',         label: t('syncStatus.tab.all') },
            { value: 'synced',      label: t('syncStatus.tab.synced') },
            { value: 'modified',    label: t('syncStatus.tab.modified') },
            { value: 'unsynced',    label: t('syncStatus.tab.unsynced') },
            { value: 'remote-only', label: t('syncStatus.tab.remote-only') },
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
            onExpandDiff: (fs) => this.loadDiffContent(fs),
        };
    }

    /**
     * Lazily fetches a modified file's remote content by SHA (Phase 2 of the
     * SHA-based refresh) so the diff panel has something to render. Mutates
     * the FileStatus object in place, caching the result on the same instance
     * held in this.fileStatuses so re-expanding doesn't refetch.
     */
    private async loadDiffContent(fileStatus: FileStatus): Promise<void> {
        if (fileStatus.remoteContent !== undefined || !fileStatus.remoteSha) return;
        try {
            const blob = await this.plugin.gitService.getBlob(fileStatus.remoteSha, fileStatus.path);
            fileStatus.remoteContent = blob.content;
        } catch (e) {
            logger.warn(`Failed to load diff content for ${fileStatus.path}`, e);
        }
    }

    private renderFileList(container: HTMLElement): void {
        const all = Array.from(this.fileStatuses.values());
        const statuses = this.statusFilter === 'all'
            ? all
            : all.filter(s => s.status === this.statusFilter);

        if (statuses.length === 0) {
            const filterLabel = this.statusFilter === 'all' ? t('syncStatus.tab.all') : statusMeta(this.statusFilter).label;
            container.createDiv({ cls: 'ssv-empty', text: t('syncStatus.noFilesForFilter', { filter: filterLabel }) });
            return;
        }

        const cb = this.fileItemCallbacks();
        for (const fs of statuses) {
            renderFileItem(container, fs, this.selectedFiles.has(fs.path), cb);
        }
    }

    // ── Single-file operations ──────────────────────────────────────

    private async handleLocalDelete(fileStatus: FileStatus): Promise<void> {
        const confirmed = await this.showConfirmDialog(t('syncStatus.confirmDeleteLocal', { path: fileStatus.path }));
        if (!confirmed) return;
        try {
            if (fileStatus.file) {
                await this.app.fileManager.trashFile(fileStatus.file);
            } else {
                await this.app.vault.adapter.remove(fileStatus.path);
            }
            await this.plugin.sync.clearMetadata(fileStatus.path);
            new Notice(t('syncStatus.notice.deleted', { path: fileStatus.path }));
            this.fileStatuses.delete(fileStatus.path);
            this.renderView();
        } catch (e) {
            new Notice(t('syncStatus.notice.deleteFailed', { message: e instanceof Error ? e.message : String(e) }));
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
            await this.refreshFileStatus(fileStatus.file || fileStatus.path, undefined);
            this.renderView();
        } catch (e) {
            const verb = op === 'push' ? t('main.verb.push') : t('main.verb.pull');
            new Notice(t('syncStatus.notice.opFailed', { verb, message: e instanceof Error ? e.message : String(e) }));
            await this.refreshFileStatus(fileStatus.file || fileStatus.path, undefined);
            this.renderView();
        }
    }

    // ── Batch / refresh operations ─────────────────────────────────

    async refreshAllStatuses(): Promise<void> {
        if (this.isRefreshing) {
            new Notice(t('syncStatus.notice.alreadyRefreshing'));
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
            await this.performStatusCheck(filesToCheck, files.remoteMap);

            this.lastSyncTime = Date.now();
            this.isRefreshing = false; // Set to false BEFORE final renderView
            this.renderView();
            new Notice(t('syncStatus.notice.refreshed', { local: files.local.length + files.hiddenLocalPaths.size, remote: files.remoteMap.size }));
        } catch (e) {
            this.isRefreshing = false;
            this.renderView();
            new Notice(t('syncStatus.notice.refreshFailed', { message: e instanceof Error ? e.message : String(e) }));
        }
    }

    private async discoverFiles() {
        const allFiles = this.app.vault.getFiles();
        let local = this.plugin.filterFilesByVaultFolder(allFiles);
        const remoteEntries = await this.plugin.gitService.listFilesDetailed(this.plugin.settings.branch);

        await this.plugin.gitignoreManager.loadGitignores();

        // Map remote paths to vault paths
        const remoteMap = new Map<string, GitTreeEntry>(); // vaultPath -> tree entry (path, symlink, sha)
        const skipSymlinks = getEffectiveSymlinkHandling(this.plugin.settings) === 'skip';
        for (const entry of remoteEntries) {
            if (entry.symlink && skipSymlinks) continue; // Symlink handling: skip
            const normalized = this.getNormalizedRemotePath(entry.path);
            if (normalized === null) continue; // Not under rootPath

            const vaultPath = this.plugin.getVaultPath(normalized);
            if (!this.plugin.gitignoreManager.isIgnored(normalized)) {
                remoteMap.set(vaultPath, entry);
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
                if (!this.isHidden(file)) continue;
                // Guard against a symlinked folder being misclassified as a file
                // by the adapter's raw listing (Node's dirent type doesn't follow
                // links) — still track it as a link entry rather than a readable
                // file, same as a symlinked folder found via listing.folders below.
                if (readLocalSymlinkTarget(this.app, file) !== null || await this.isLocalFile(file)) {
                    result.push(file);
                }
            }
            for (const folder of listing.folders) {
                if (folder === '.git' || folder.endsWith('/.git')) continue;
                // A symlinked folder is a single blob on the remote, not a real tree —
                // walking into it would scan whatever unrelated directory it points at.
                // Track the link itself (same as a hidden file) so push/pull can still
                // handle it via the existing symlink machinery, without recursing.
                if (readLocalSymlinkTarget(this.app, folder) !== null) {
                    if (this.isHidden(folder)) result.push(folder);
                    continue;
                }
                await this.recursiveScan(folder, result);
            }
        } catch { /* adapter may not support listing */ }
    }

    private isHidden(path: string): boolean {
        return path.split('/').some(part => part.startsWith('.'));
    }

    /** True only for an actual local file — excludes real directories (and symlinks to one), which `adapter.stat()` follows. */
    private async isLocalFile(vaultPath: string): Promise<boolean> {
        const stat = await this.app.vault.adapter.stat(vaultPath);
        return stat?.type === 'file';
    }

    private initializeFileStatuses(localFiles: TFile[]): void {
        for (const file of localFiles) {
            this.fileStatuses.set(file.path, { file, path: file.path, status: 'checking' });
        }
    }

    private async identifyExtraFiles(remoteMap: Map<string, GitTreeEntry>, localFilePaths: Set<string>, allLocalFileMap: Map<string, TFile>) {
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
            } else if (await this.isLocalFile(vaultPath)) {
                extra.push(vaultPath);
            } else {
                // Either nothing exists locally, or the remote's record (e.g. a
                // stale symlink push) now collides with a real local folder of
                // the same name — either way there's no readable local file to
                // compare, so it's remote-only.
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

    private async performStatusCheck(filesToCheck: Array<TFile | string>, remoteMap: Map<string, GitTreeEntry>): Promise<void> {
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
                if (file) {
                    const path = typeof file === 'string' ? file : file.path;
                    await this.refreshFileStatus(file, remoteMap.get(path));
                }
                this.refreshProgress.current++;
                maybeRender();
            }
        };

        const workerCount = Math.min(SyncStatusView.STATUS_CHECK_CONCURRENCY, total);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        maybeRender(true);
    }

    /**
     * Classifies a file's sync status. When the remote tree entry carries a git
     * blob SHA (the common case), this is a single local hash + comparison with
     * no network request (Phase 1 of the SHA-based refresh). Falls back to the
     * full-content comparison via getFile() only when a tree entry exists but
     * carries no SHA (providers whose tree listing omits it).
     *
     * A file with no tree entry at all isn't on the remote, so it is 'unsynced'
     * by definition — fetching it would 404 once per file, which on a vault with
     * many not-yet-pushed files floods the console with failed requests before
     * every push.
     */
    private async refreshFileStatus(fileOrPath: TFile | string, remoteEntry: GitTreeEntry | undefined): Promise<void> {
        try {
            if (remoteEntry?.sha !== undefined) {
                await this.refreshFileStatusBySha(fileOrPath, remoteEntry);
            } else if (remoteEntry) {
                await this.refreshFileStatusByContent(fileOrPath);
            } else {
                await this.markLocalOnlyUnsynced(fileOrPath);
            }
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

    private async refreshFileStatusBySha(fileOrPath: TFile | string, remoteEntry: GitTreeEntry): Promise<void> {
        const isStr = typeof fileOrPath === 'string';
        const path = isStr ? fileOrPath : fileOrPath.path;
        const file = isStr ? undefined : fileOrPath;
        const binary = this.isBinary(path);

        const symlinkMode = getEffectiveSymlinkHandling(this.plugin.settings);
        const localContent = await this.readLocalContentForSha(fileOrPath, isStr, binary, remoteEntry.symlink, symlinkMode);
        const localSha = await gitBlobSha(localContent);

        const status = localSha === remoteEntry.sha ? 'synced' : 'modified';
        this.fileStatuses.set(path, {
            file, path, status, localContent,
            remoteSha: remoteEntry.sha,
            isSymlink: remoteEntry.symlink,
        });
    }

    /**
     * Determines what to hash locally so it's comparable to the remote blob SHA.
     * A symlink's blob content is its target path string, not the content it
     * points at, so "real" mode hashes the raw link target instead of following
     * it. "follow" mode (and "real" without an actual local OS symlink, e.g. on
     * mobile) always hashes the local file's content as read normally.
     */
    private async readLocalContentForSha(
        fileOrPath: TFile | string, isStr: boolean, binary: boolean, remoteIsSymlink: boolean, symlinkMode: SymlinkHandling
    ): Promise<string | ArrayBuffer> {
        if (remoteIsSymlink && symlinkMode === 'real') {
            const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
            const target = readLocalSymlinkTarget(this.app, path);
            if (target !== null) return target;
        }
        return this.readFileContent(fileOrPath, binary, isStr);
    }

    /**
     * Status for a file the remote tree doesn't list at all. Local content is
     * still read so the row can be pushed/diffed like any other, and the empty
     * remote sha/content match what a 404 lookup used to yield.
     */
    private async markLocalOnlyUnsynced(fileOrPath: TFile | string): Promise<void> {
        const isStr = typeof fileOrPath === 'string';
        const path = isStr ? fileOrPath : fileOrPath.path;
        const localContent = await this.readFileContent(fileOrPath, this.isBinary(path), isStr);

        this.fileStatuses.set(path, {
            file: isStr ? undefined : fileOrPath,
            path,
            status: 'unsynced',
            localContent,
            remoteContent: '',
            remoteSha: '',
        });
    }

    /** Fallback status check via full content fetch, for entries without a usable tree SHA. */
    private async refreshFileStatusByContent(fileOrPath: TFile | string): Promise<void> {
        const isStr = typeof fileOrPath === 'string';
        const path = isStr ? fileOrPath : fileOrPath.path;
        const file = isStr ? undefined : fileOrPath;

        const binary = this.isBinary(path);
        const localContent = await this.readFileContent(fileOrPath, binary, isStr);

        // Important: Use SyncManager's logic which handles rootPath/vaultFolder mapping
        const repoPath = this.plugin.getNormalizedPath(path);
        const remote = await this.plugin.gitService.getFile(repoPath, this.plugin.settings.branch);

        const status = this.determineFileStatus(localContent, remote);

        this.fileStatuses.set(path, { file, path, status, localContent, remoteContent: remote.content, remoteSha: remote.sha });
    }

    private async readStringPathContent(path: string, binary: boolean): Promise<string | ArrayBuffer> {
        try {
            return binary
                ? await this.app.vault.adapter.readBinary(path)
                : await this.app.vault.adapter.read(path);
        } catch (e) {
            // A folder that's an OS symlink can surface here (not yet known to
            // the remote, so it skipped the sha-based symlink handling above);
            // adapter.read() follows the link and throws EISDIR trying to read
            // a directory. Fall back to the raw link target, consistent with
            // how a symlinked folder is treated as a single blob elsewhere.
            const target = readLocalSymlinkTarget(this.app, path);
            if (target !== null) return target;
            throw e;
        }
    }

    private async readFileContent(fileOrPath: TFile | string, binary: boolean, isStr: boolean): Promise<string | ArrayBuffer> {
        if (isStr) {
            return this.readStringPathContent(fileOrPath as string, binary);
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

    private determineFileStatus(localContent: string | ArrayBuffer, remote: { sha?: string; content?: string | ArrayBuffer }): FileStatus['status'] {
        if (!remote.sha) return 'unsynced';
        if (remote.content && this.contentsEqual(localContent, remote.content)) return 'synced';
        return 'modified';
    }

    private isBinary(path: string): boolean { return isBinaryPath(path); }

    private contentsEqual(a: string | ArrayBuffer, b: string | ArrayBuffer): boolean {
        return contentsEqual(a, b);
    }

    // ── Batch push/pull/delete ─────────────────────────────────────

    async pushAllModified(): Promise<void> { await this.runBatchOperation('modified', 'push'); }
    async pullAllModified(): Promise<void> { await this.runBatchOperation('modified', 'pull'); }
    async pushSelected():   Promise<void> { await this.runBatchOperation('selected', 'push'); }
    async pullSelected():   Promise<void> { await this.runBatchOperation('selected', 'pull'); }

    private static readonly NO_RUNNABLE_FILES_KEYS: Record<'push' | 'pull', Record<'selected' | 'found', TranslationKey>> = {
        push: { selected: 'syncStatus.notice.noPushableFiles.selected', found: 'syncStatus.notice.noPushableFiles.found' },
        pull: { selected: 'syncStatus.notice.noPullableFiles.selected', found: 'syncStatus.notice.noPullableFiles.found' },
    };

    private async runBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull'): Promise<void> {
        const targets = Array.from(this.fileStatuses.values()).filter(s => {
            if (filter === 'selected' && !this.selectedFiles.has(s.path)) return false;
            return op === 'push'
                ? s.status === 'modified' || s.status === 'unsynced'
                : s.status === 'modified' || s.status === 'remote-only';
        });

        if (targets.length === 0) {
            const scope = filter === 'selected' ? 'selected' : 'found';
            new Notice(t(SyncStatusView.NO_RUNNABLE_FILES_KEYS[op][scope]));
            return;
        }

        const files = targets.map(s => s.file || s.path);
        const serviceName = getServiceName(this.plugin.settings);
        const msg = op === 'push'
            ? t('syncStatus.confirm.pushSelected', { count: files.length, service: serviceName })
            : t('syncStatus.confirm.pullSelected', { count: files.length, service: serviceName });

        if (!await this.showConfirmDialog(msg)) return;

        await this.executeBatchOperation(filter, op, files);
    }

    /**
     * Marks just-pushed paths as 'synced' directly from data already in hand
     * (the content that was just written, and the new sha when the provider
     * reported one), instead of re-fetching the remote tree. Used in place of
     * refreshAllStatuses() right after a push — see the call site's comment.
     */
    private applyOptimisticSyncedStatus(syncedPaths: Array<{ path: string; sha?: string }>): void {
        for (const { path, sha } of syncedPaths) {
            const existing = this.fileStatuses.get(path);
            this.fileStatuses.set(path, {
                ...existing,
                path,
                status: 'synced',
                remoteSha: sha ?? existing?.remoteSha,
            });
        }
    }

    private async executeBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull', files: Array<string | TFile>): Promise<void> {
        const runVerb = op === 'push' ? t('main.verb.pushing') : t('main.verb.pulling');
        const prog = new Notice(t('main.progress.running', { verb: runVerb, total: files.length }), 0);
        try {
            const results = op === 'push'
                ? await this.plugin.sync.pushAllFiles(files, (cur, total, name) => prog.setMessage(t('syncStatus.progress.pushing', { current: cur, total, name })))
                : await this.plugin.sync.pullAllFiles(files, (cur, total, name) => prog.setMessage(t('syncStatus.progress.pulling', { current: cur, total, name })));

            prog.hide();
            if (results.errors.length > 0) logger.error(`${op} errors:`, results.errors);
            if (filter === 'selected') this.selectedFiles.clear();
            const doneVerb = op === 'push' ? t('main.verb.push') : t('main.verb.pull');
            new Notice(t('syncStatus.notice.opCompleted', { verb: doneVerb }));

            if (op === 'push') {
                // Mark just-pushed files synced directly instead of re-fetching the
                // remote tree: GitHub's tree-by-branch-name read can lag a few
                // seconds behind a just-completed write, so an immediate refresh
                // can misreport a file we know just synced correctly as "modified".
                this.applyOptimisticSyncedStatus((results as PushResults).syncedPaths);
                this.renderView();
            } else {
                await this.refreshAllStatuses();
            }
        } catch (e) {
            prog.hide();
            const failVerb = op === 'push' ? t('main.verb.push') : t('main.verb.pull');
            new Notice(t('syncStatus.notice.opFailed', { verb: failVerb, message: e instanceof Error ? e.message : String(e) }));
        }
    }

    async deleteSelected(): Promise<void> {
        const targets = this.getSelectedTargets();
        if (targets.length === 0) return;

        const { local, remote } = this.partitionTargets(targets);
        if (local.length === 0 && remote.length === 0) { new Notice(t('syncStatus.notice.nothingToDelete')); return; }
        if (!await this.confirmDeletion(local.length, remote.length)) return;

        const total = local.length + remote.length;
        const prog = new Notice(t('syncStatus.progress.deleting', { total }), 0);
        const errors: { path: string, message: string }[] = [];

        await this.performLocalDeletion(local, total, prog, errors);
        await this.performRemoteDeletion(remote, total, local.length, prog, errors);

        prog.hide();
        if (errors.length > 0) {
            logger.error('Delete errors:', errors);
            new Notice(t('syncStatus.notice.deleteResult.partialWithMessage', {
                succeeded: total - errors.length,
                total,
                failed: errors.length,
                message: errors.map(e => e.message).join('; ')
            }));
        } else {
            new Notice(t('syncStatus.notice.deleteResult.success', { total }));
        }
        this.renderView();
    }

    private getSelectedTargets(): FileStatus[] {
        if (this.selectedFiles.size === 0) { new Notice(t('syncStatus.notice.noFilesSelected')); return []; }
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
            msg = t('syncStatus.confirmDelete.localAndRemote', { local: localCount, remote: remoteCount });
        } else if (localCount > 0) {
            msg = t('syncStatus.confirmDelete.localOnly', { local: localCount });
        } else {
            msg = t('syncStatus.confirmDelete.remoteOnly', { remote: remoteCount });
        }
        return this.showConfirmDialog(msg);
    }

    private async performLocalDeletion(local: FileStatus[], total: number, prog: Notice, errors: { path: string, message: string }[]): Promise<void> {
        let cur = 0;
        for (const s of local) {
            cur++;
            prog.setMessage(t('syncStatus.progress.deletingLocal', { current: cur, total, path: s.path }));
            try {
                if (s.file) await this.app.fileManager.trashFile(s.file);
                else await this.app.vault.adapter.remove(s.path);
                await this.plugin.sync.clearMetadata(s.path);
                this.fileStatuses.delete(s.path);
                this.selectedFiles.delete(s.path);
            } catch (e) {
                errors.push({ path: s.path, message: e instanceof Error ? e.message : String(e) });
            }
        }
    }

    private async performRemoteDeletion(remote: FileStatus[], total: number, localCount: number, prog: Notice, errors: { path: string, message: string }[]): Promise<void> {
        if (remote.length === 0) return;

        // s.path is a vault-relative path (may carry the vaultFolder prefix); the
        // git service expects a path relative to rootPath only, so strip
        // vaultFolder first, same as every other gitService call site.
        const entries = remote.map(s => ({ status: s, repoPath: this.plugin.getNormalizedPath(s.path) }));

        if (!this.plugin.gitService.deleteBatch) {
            await this.performRemoteDeletionSequential(entries, total, localCount, prog, errors);
            return;
        }

        let cur = localCount;
        for (const e of entries) {
            cur++;
            prog.setMessage(t('syncStatus.progress.deletingRemote', { current: cur, total, path: e.status.path }));
        }

        const branch = this.plugin.settings.branch;
        for (let i = 0; i < entries.length; i += MAX_BATCH_PUSH_SIZE) {
            const chunk = entries.slice(i, i + MAX_BATCH_PUSH_SIZE);
            try {
                const message = `Delete ${chunk.length} file(s) from Obsidian`;
                await this.plugin.gitService.deleteBatch(chunk.map(e => e.repoPath), branch, message);
                for (const e of chunk) {
                    this.fileStatuses.delete(e.status.path);
                    this.selectedFiles.delete(e.status.path);
                }
            } catch (err) {
                // Atomic per-provider failure: none of this chunk's files were
                // actually deleted, so every path in it is failed, not dropped.
                const message = err instanceof Error ? err.message : String(err);
                for (const e of chunk) errors.push({ path: e.status.path, message });
            }
        }
    }

    /** Provider doesn't support a batch/atomic multi-file delete commit —
     * fall back to the original sequential per-file delete. */
    private async performRemoteDeletionSequential(
        entries: Array<{ status: FileStatus; repoPath: string }>,
        total: number,
        localCount: number,
        prog: Notice,
        errors: { path: string, message: string }[]
    ): Promise<void> {
        let cur = localCount;
        for (const e of entries) {
            cur++;
            prog.setMessage(t('syncStatus.progress.deletingRemote', { current: cur, total, path: e.status.path }));
            try {
                await this.plugin.gitService.deleteFile(e.repoPath, this.plugin.settings.branch, `Delete ${e.repoPath}`);
                this.fileStatuses.delete(e.status.path);
                this.selectedFiles.delete(e.status.path);
            } catch (err) {
                errors.push({ path: e.status.path, message: err instanceof Error ? err.message : String(err) });
            }
        }
    }

    onClose(): Promise<void> { return Promise.resolve(); }

    private showConfirmDialog(message: string): Promise<boolean> {
        return new Promise(resolve => {
            new ConfirmModal(this.app, message, () => resolve(true), () => resolve(false)).open();
        });
    }
}
