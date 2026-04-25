import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, setTooltip } from 'obsidian';
import GitLabFilesPush from '../main';
import { ConfirmModal } from './ConfirmModal';

export const SYNC_STATUS_VIEW_TYPE = 'sync-status-view';

interface FileStatus {
    file?: TFile;
    path: string;
    status: 'synced' | 'modified' | 'unsynced' | 'remote-only' | 'checking';
    localContent?: string;
    remoteContent?: string;
    remoteSha?: string;
    diff?: string;
}

interface DiffSide {
    lineNum: number | null;
    content: string | null;
    type: 'removed' | 'added' | 'unchanged' | 'empty';
}

interface DiffRow {
    left: DiffSide;
    right: DiffSide;
}

type FilterValue = 'all' | 'synced' | 'modified' | 'unsynced' | 'remote-only';

export class SyncStatusView extends ItemView {
    plugin: GitLabFilesPush;
    private fileStatuses: Map<string, FileStatus> = new Map();
    private isRefreshing = false;
    private statusFilter: FilterValue = 'all';
    private selectedFiles: Set<string> = new Set();
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
        this.renderActionBar(container);

        const listEl = container.createDiv({ cls: 'ssv-list' });
        if (this.fileStatuses.size === 0) {
            listEl.createDiv({ cls: 'ssv-empty', text: 'Click "Refresh" to check sync status' });
        } else {
            this.renderFileList(listEl);
        }
    }

    private renderInfoStrip(container: HTMLElement): void {
        const el = container.createDiv({ cls: 'ssv-info' });
        const serviceName = this.plugin.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';

        el.createSpan({ cls: 'ssv-info-item', text: serviceName });

        if (!Platform.isMobile) {
            el.createSpan({ cls: 'ssv-info-sep', text: '·' });
            const branchEl = el.createSpan({ cls: 'ssv-info-item' });
            branchEl.textContent = `⎇ ${this.plugin.settings.branch}`;
        }

        if (this.plugin.settings.vaultFolder) {
            el.createSpan({ cls: 'ssv-info-sep', text: '·' });
            el.createSpan({ cls: 'ssv-info-item', text: `📁 ${this.plugin.settings.vaultFolder}` });
        }

        if (this.lastSyncTime > 0) {
            el.createSpan({ cls: 'ssv-info-sep', text: '·' });
            el.createSpan({
                cls: 'ssv-info-time',
                text: Platform.isMobile ? new Date(this.lastSyncTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : `Last sync: ${new Date(this.lastSyncTime).toLocaleTimeString()}`
            });
        }
    }

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

    private renderActionBar(container: HTMLElement): void {
        const all = Array.from(this.fileStatuses.values());
        const visible = this.statusFilter === 'all'
            ? all
            : all.filter(s => s.status === this.statusFilter);

        const selected = Array.from(this.selectedFiles)
            .map(p => this.fileStatuses.get(p))
            .filter(Boolean) as FileStatus[];

        const canPush   = selected.filter(s => s.file && (s.status === 'modified' || s.status === 'unsynced')).length;
        const canPull   = selected.filter(s => s.status === 'modified' || s.status === 'remote-only').length;
        const canDelete = selected.filter(s => s.file || s.status === 'remote-only').length;

        const allSelected = visible.length > 0 && visible.every(s => this.selectedFiles.has(s.path));

        const bar = container.createDiv({ cls: 'ssv-action-bar' });

        const refreshBtn = bar.createEl('button', { cls: 'ssv-btn ssv-btn-refresh' });
        refreshBtn.createSpan({ text: '↻' });
        refreshBtn.createSpan({ cls: 'ssv-btn-label', text: ' Refresh' });
        setTooltip(refreshBtn, 'Refresh all statuses');
        refreshBtn.addEventListener('click', () => void this.refreshAllStatuses());

        if (this.fileStatuses.size > 0) {
            bar.createDiv({ cls: 'ssv-bar-spacer' });

            const selectRow = bar.createDiv({ cls: 'ssv-select-row' });
            const cb = selectRow.createEl('input', { type: 'checkbox' });
            cb.checked = allSelected;
            cb.indeterminate = this.selectedFiles.size > 0 && !allSelected;
            selectRow.createSpan({ cls: 'ssv-select-label', text: 'Select' });
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    for (const s of visible) this.selectedFiles.add(s.path);
                } else {
                    this.selectedFiles.clear();
                }
                this.renderView();
            });

            const pushBtn = bar.createEl('button', { cls: 'ssv-btn ssv-btn-push' });
            pushBtn.createSpan({ text: '↑' });
            pushBtn.createSpan({ cls: 'ssv-btn-label', text: ` Push (${canPush})` });
            pushBtn.disabled = canPush === 0;
            setTooltip(pushBtn, `Push ${canPush} files`);
            pushBtn.addEventListener('click', () => void this.pushSelected());

            const pullBtn = bar.createEl('button', { cls: 'ssv-btn ssv-btn-pull' });
            pullBtn.createSpan({ text: '↓' });
            pullBtn.createSpan({ cls: 'ssv-btn-label', text: ` Pull (${canPull})` });
            pullBtn.disabled = canPull === 0;
            setTooltip(pullBtn, `Pull ${canPull} files`);
            pullBtn.addEventListener('click', () => void this.pullSelected());

            const delBtn = bar.createEl('button', { cls: 'ssv-btn ssv-btn-delete' });
            delBtn.createSpan({ text: '✕' });
            delBtn.createSpan({ cls: 'ssv-btn-label', text: ` Delete (${canDelete})` });
            delBtn.disabled = canDelete === 0;
            setTooltip(delBtn, `Delete ${canDelete} files`);
            delBtn.addEventListener('click', () => void this.deleteSelected());
        }
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
        for (const fs of statuses) this.renderFileItem(container, fs);
    }

    private renderFileItem(container: HTMLElement, fileStatus: FileStatus): void {
        const { icon, label, iconCls, badgeCls, fileCls } = this.statusMeta(fileStatus.status);

        const fileEl = container.createDiv({ cls: `ssv-file ${fileCls}` });

        // ── Main row ──
        const row = fileEl.createDiv({ cls: 'ssv-file-row' });

        const cb = row.createEl('input', { type: 'checkbox', cls: 'ssv-file-checkbox' });
        cb.checked = this.selectedFiles.has(fileStatus.path);
        cb.addEventListener('change', () => {
            if (cb.checked) {
                this.selectedFiles.add(fileStatus.path);
            } else {
                this.selectedFiles.delete(fileStatus.path);
            }
            this.renderView();
        });

        row.createSpan({ cls: `ssv-file-icon ${iconCls}`, text: icon });
        row.createSpan({ cls: 'ssv-file-path', text: fileStatus.path });
        row.createSpan({ cls: `ssv-status-badge ${badgeCls}`, text: label });

        if (fileStatus.status === 'synced' || fileStatus.status === 'checking') return;

        // ── Action row ──
        const actions = fileEl.createDiv({ cls: 'ssv-file-actions' });

        // Diff toggle (modified only)
        if (fileStatus.status === 'modified' && fileStatus.diff) {
            const diffBtn = actions.createEl('button', { cls: 'ssv-action-btn diff' });
            diffBtn.createSpan({ text: '≡' });
            const btnLabel = diffBtn.createSpan({ cls: 'ssv-btn-label', text: ' Diff' });
            const diffEl = this.renderDiffPanel(fileEl, fileStatus);
            setTooltip(diffBtn, 'Toggle diff view');
            diffBtn.addEventListener('click', () => {
                const open = diffEl.hasClass('visible');
                diffEl.toggleClass('visible', !open);
                btnLabel.setText(open ? ' Diff' : ' Hide');
                const firstChild = diffBtn.firstChild;
                if (firstChild instanceof HTMLElement || firstChild instanceof Text) {
                    firstChild.textContent = open ? '≡' : '▴';
                }
            });
        }

        // Push
        if ((fileStatus.status === 'modified' || fileStatus.status === 'unsynced') && fileStatus.file) {
            const pushBtn = actions.createEl('button', { cls: 'ssv-action-btn push' });
            pushBtn.createSpan({ text: '↑' });
            pushBtn.createSpan({ cls: 'ssv-btn-label', text: ' Push' });
            setTooltip(pushBtn, 'Push to remote');
            pushBtn.addEventListener('click', () => void this.runSingleFile(fileStatus, 'push'));
        }

        // Pull
        if (fileStatus.status === 'modified' || fileStatus.status === 'remote-only') {
            const pullBtn = actions.createEl('button', { cls: 'ssv-action-btn pull' });
            pullBtn.createSpan({ text: '↓' });
            pullBtn.createSpan({ cls: 'ssv-btn-label', text: ' Pull' });
            setTooltip(pullBtn, 'Pull from remote');
            pullBtn.addEventListener('click', () => void this.runSingleFile(fileStatus, 'pull'));
        }

        // Remove local
        if (fileStatus.status === 'unsynced' && fileStatus.file) {
            const removeBtn = actions.createEl('button', { cls: 'ssv-action-btn danger' });
            removeBtn.createSpan({ text: '✕' });
            removeBtn.createSpan({ cls: 'ssv-btn-label', text: ' Remove' });
            setTooltip(removeBtn, 'Delete local file');
            removeBtn.addEventListener('click', () => {
                void (async () => {
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
                })();
            });
        }
    }

    private async runSingleFile(fileStatus: FileStatus, op: 'push' | 'pull'): Promise<void> {
        try {
            const originalStatus = fileStatus.status;
            fileStatus.status = 'checking';
            this.renderView();

            if (op === 'push') {
                await this.plugin.sync.pushFile(fileStatus.file || fileStatus.path);
                await new Promise(r => setTimeout(r, 500));
            } else if (originalStatus === 'remote-only' || !fileStatus.file) {
                // pull remote-only
                const remote = await this.plugin.gitService.getFile(fileStatus.path, this.plugin.settings.branch);
                if (remote.content) {
                    await this.ensureParentDirs(fileStatus.path);
                    await this.app.vault.adapter.write(fileStatus.path, remote.content);
                    this.plugin.settings.syncMetadata[fileStatus.path] = {
                        lastSyncedSha: remote.sha,
                        lastSyncedAt: Date.now(),
                        lastKnownPath: fileStatus.path
                    };
                    await this.plugin.saveSettings();
                }
                await new Promise(r => setTimeout(r, 1000));
                await this.refreshAllStatuses();
                return;
            } else {
                await this.plugin.sync.pullFile(fileStatus.file || fileStatus.path);
                await new Promise(r => setTimeout(r, 500));
            }

            await this.refreshFileStatus(fileStatus.file || fileStatus.path);
            this.renderView();
        } catch (e) {
            new Notice(`${op === 'push' ? 'Push' : 'Pull'} failed: ${e instanceof Error ? e.message : String(e)}`);
            await this.refreshFileStatus(fileStatus.file || fileStatus.path);
            this.renderView();
        }
    }

    private statusMeta(status: FileStatus['status']) {
        switch (status) {
            case 'synced':      return { icon: '✓', label: 'Synced',     iconCls: 'ssv-icon-synced',   badgeCls: 'ssv-badge-synced',   fileCls: 'status-synced' };
            case 'modified':    return { icon: '⚠', label: 'Changed',    iconCls: 'ssv-icon-modified', badgeCls: 'ssv-badge-modified', fileCls: 'status-modified' };
            case 'unsynced':    return { icon: '↑', label: 'Local only', iconCls: 'ssv-icon-unsynced', badgeCls: 'ssv-badge-unsynced', fileCls: 'status-unsynced' };
            case 'remote-only': return { icon: '↓', label: 'Remote',     iconCls: 'ssv-icon-remote',   badgeCls: 'ssv-badge-remote',   fileCls: 'status-remote' };
            default:            return { icon: '⟳', label: 'Checking',   iconCls: 'ssv-icon-checking', badgeCls: 'ssv-badge-checking', fileCls: 'status-checking' };
        }
    }

    // ── Side-by-side diff ─────────────────────────────────────────

    private renderDiffPanel(fileEl: HTMLElement, fileStatus: FileStatus): HTMLElement {
        const diffEl = fileEl.createDiv({ cls: 'ssv-diff' });
        const rows = this.computeSideBySideDiff(fileStatus.remoteContent ?? '', fileStatus.localContent ?? '');

        // Side-by-side (shown on wide containers via container query)
        const splitEl = diffEl.createDiv({ cls: 'ssv-diff-split' });
        const grid = splitEl.createDiv({ cls: 'ssv-diff-grid' });
        grid.createDiv({ cls: 'ssv-diff-hd', text: 'Remote' });
        grid.createDiv({ cls: 'ssv-diff-hd', text: 'Local' });
        for (const row of rows) {
            this.renderDiffCell(grid, row.left);
            this.renderDiffCell(grid, row.right);
        }

        // Unified (shown on narrow containers / mobile via container query)
        const unifiedEl = diffEl.createEl('pre', { cls: 'ssv-diff-unified' });
        for (const row of rows) {
            const { left, right } = row;
            if (left.type === 'removed') {
                unifiedEl.createSpan({ cls: 'ssv-u-line removed' }).textContent = `- ${left.content ?? ''}\n`;
            }
            if (right.type === 'added') {
                unifiedEl.createSpan({ cls: 'ssv-u-line added' }).textContent = `+ ${right.content ?? ''}\n`;
            }
            if (left.type === 'unchanged') {
                unifiedEl.createSpan({ cls: 'ssv-u-line unchanged' }).textContent = `  ${left.content ?? ''}\n`;
            }
        }

        return diffEl;
    }

    private renderDiffCell(grid: HTMLElement, side: DiffSide): void {
        const cell = grid.createDiv({ cls: `ssv-diff-cell ${side.type}` });
        cell.createSpan({ cls: 'ssv-diff-ln' }).textContent = side.lineNum !== null ? String(side.lineNum) : '';
        if (side.content !== null) {
            cell.createSpan({ cls: 'ssv-diff-code' }).textContent = side.content;
        }
    }

    private computeSideBySideDiff(remote: string, local: string): DiffRow[] {
        const normalize = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const L = normalize(remote).split('\n');
        const R = normalize(local).split('\n');
        const m = L.length, n = R.length;

        // For very large files fall back to simple comparison
        if (m * n > 250_000) return this.simpleDiff(L, R);

        // LCS DP — flat Uint32Array avoids noUncheckedIndexedAccess issues
        const W = n + 1;
        const totalSize = (m + 1) * W;
        
        // Security hotspot: prevent huge memory allocations that could lead to DoS
        if (totalSize > 1_000_000) return this.simpleDiff(L, R);

        const dp = new Uint32Array(totalSize);
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i * W + j] = L[i - 1] === R[j - 1]
                    ? (dp[(i - 1) * W + (j - 1)] ?? 0) + 1
                    : Math.max(dp[(i - 1) * W + j] ?? 0, dp[i * W + (j - 1)] ?? 0);
            }
        }

        // Backtrack — li/ri = -1 when not applicable (avoids optional fields)
        type Op = { type: 'unchanged' | 'removed' | 'added'; li: number; ri: number };
        const ops: Op[] = [];
        let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && L[i - 1] === R[j - 1]) {
                ops.push({ type: 'unchanged', li: i - 1, ri: j - 1 });
                i--; j--;
            } else if (j > 0 && (i === 0 || (dp[i * W + (j - 1)] ?? 0) >= (dp[(i - 1) * W + j] ?? 0))) {
                ops.push({ type: 'added', li: -1, ri: j - 1 });
                j--;
            } else {
                ops.push({ type: 'removed', li: i - 1, ri: -1 });
                i--;
            }
        }
        ops.reverse();

        // Pair consecutive removed ↔ added side-by-side
        const rows: DiffRow[] = [];
        let k = 0;
        while (k < ops.length) {
            const op = ops[k];
            if (op === undefined) break;

            if (op.type === 'unchanged') {
                rows.push({
                    left:  { lineNum: op.li + 1, content: L[op.li] ?? null, type: 'unchanged' },
                    right: { lineNum: op.ri + 1, content: R[op.ri] ?? null, type: 'unchanged' },
                });
                k++;
            } else {
                const removedIdxs: number[] = [];
                const addedIdxs: number[] = [];
                while (k < ops.length) {
                    const cur = ops[k];
                    if (cur === undefined || cur.type === 'unchanged') break;
                    if (cur.type === 'removed') removedIdxs.push(cur.li);
                    else addedIdxs.push(cur.ri);
                    k++;
                }
                const len = Math.max(removedIdxs.length, addedIdxs.length);
                for (let x = 0; x < len; x++) {
                    const rIdx = removedIdxs[x];
                    const aIdx = addedIdxs[x];
                    rows.push({
                        left:  rIdx !== undefined
                            ? { lineNum: rIdx + 1, content: L[rIdx] ?? null, type: 'removed' }
                            : { lineNum: null, content: null, type: 'empty' },
                        right: aIdx !== undefined
                            ? { lineNum: aIdx + 1, content: R[aIdx] ?? null, type: 'added'   }
                            : { lineNum: null, content: null, type: 'empty' },
                    });
                }
            }
        }
        return rows;
    }

    // Fallback for very large files (> 500×500 lines)
    private simpleDiff(L: string[], R: string[]): DiffRow[] {
        const rows: DiffRow[] = [];
        const max = Math.max(L.length, R.length);
        for (let i = 0; i < max; i++) {
            const l = L[i], r = R[i];
            if (l === undefined)      rows.push({ left: { lineNum: null,  content: null, type: 'empty'     }, right: { lineNum: i + 1, content: r ?? null, type: 'added'     } });
            else if (r === undefined) rows.push({ left: { lineNum: i + 1, content: l,    type: 'removed'   }, right: { lineNum: null,  content: null,      type: 'empty'     } });
            else if (l === r)         rows.push({ left: { lineNum: i + 1, content: l,    type: 'unchanged' }, right: { lineNum: i + 1, content: r,         type: 'unchanged' } });
            else                      rows.push({ left: { lineNum: i + 1, content: l,    type: 'removed'   }, right: { lineNum: i + 1, content: r,         type: 'added'     } });
        }
        return rows;
    }

    // ── Batch / refresh operations (logic unchanged) ──────────────

    async refreshAllStatuses(): Promise<void> {
        if (this.isRefreshing) {
            new Notice('Already refreshing…');
            return;
        }

        this.isRefreshing = true;
        this.fileStatuses.clear();

        // Show progress bar inside the list container
        const container = this.containerEl.children[1];
        if (container) {
            const listEl = container.querySelector('.ssv-list');
            if (listEl) {
                listEl.empty();
                const prog = listEl.createDiv({ cls: 'ssv-progress' });
                prog.createDiv({ cls: 'ssv-progress-text', text: 'Checking files…' });
                const bar = prog.createDiv({ cls: 'ssv-progress-bar' });
                const fill = bar.createDiv({ cls: 'ssv-progress-fill' });
                fill.setAttr('style', 'width: 0%');
            }
        }

        try {
            const allFiles = this.app.vault.getFiles();
            let files = this.plugin.filterFilesByVaultFolder(allFiles);

            let remoteFiles = await this.plugin.gitService.listFiles(this.plugin.settings.branch);

            await this.plugin.gitignoreManager.loadGitignores();
            remoteFiles = remoteFiles.filter(p => !this.plugin.gitignoreManager.isIgnored(p));
            files = files.filter(f => !this.plugin.gitignoreManager.isIgnored(f.path));

            const localFilePaths = new Set(files.map(f => f.path));
            const allLocalFileMap = new Map<string, TFile>(allFiles.map(f => [f.path, f]));

            for (const file of files) {
                this.fileStatuses.set(file.path, { file, path: file.path, status: 'checking' });
            }

            const extraFilesToCheck: Array<TFile | string> = [];
            for (const remotePath of remoteFiles) {
                if (!localFilePaths.has(remotePath)) {
                    let localFile = allLocalFileMap.get(remotePath);
                    if (!localFile) {
                        const abs = this.app.vault.getAbstractFileByPath(remotePath);
                        if (abs instanceof TFile) localFile = abs;
                    }
                    if (localFile) {
                        this.fileStatuses.set(remotePath, { file: localFile, path: remotePath, status: 'checking' });
                        extraFilesToCheck.push(localFile);
                    } else if (await this.app.vault.adapter.exists(remotePath)) {
                        this.fileStatuses.set(remotePath, { path: remotePath, status: 'checking' });
                        extraFilesToCheck.push(remotePath);
                    } else {
                        this.fileStatuses.set(remotePath, { path: remotePath, status: 'remote-only' });
                    }
                }
            }

            this.renderView();

            let filesToCheck: Array<TFile | string> = [...files, ...extraFilesToCheck];
            filesToCheck = filesToCheck.filter(f => {
                const p = typeof f === 'string' ? f : f.path;
                return !this.plugin.gitignoreManager.isIgnored(p);
            });
            const total = filesToCheck.length;
            let checked = 0;

            for (const file of filesToCheck) {
                await this.refreshFileStatus(file);
                checked++;
                const c = this.containerEl.children[1];
                if (c) {
                    const fill = c.querySelector('.ssv-progress-fill');
                    const text = c.querySelector('.ssv-progress-text');
                    if (fill && text) {
                        const pct = Math.round((checked / total) * 100);
                        fill.setAttr('style', `width: ${pct}%`);
                        text.textContent = `Checking files… ${checked}/${total} (${pct}%)`;
                    }
                }
            }

            this.lastSyncTime = Date.now();
            this.renderView();
            new Notice(`Checked ${files.length} local + ${remoteFiles.length} remote files`);
        } catch (e) {
            new Notice(`Failed to refresh: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.isRefreshing = false;
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

    private async ensureParentDirs(filePath: string): Promise<void> {
        const parts = filePath.split('/');
        let cur = '';
        for (let i = 0; i < parts.length - 1; i++) {
            cur += (i > 0 ? '/' : '') + parts[i];
            if (!this.app.vault.getAbstractFileByPath(cur)) {
                try { await this.app.vault.createFolder(cur); } catch { /* already exists */ }
            }
        }
    }

    async pushAllModified(): Promise<void> {
        await this.runBatchOperation('modified', 'push');
    }

    async pullAllModified(): Promise<void> {
        await this.runBatchOperation('modified', 'pull');
    }

    private async runBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull'): Promise<void> {
        const targets = Array.from(this.fileStatuses.values())
            .filter(s => {
                if (filter === 'selected' && !this.selectedFiles.has(s.path)) return false;
                if (op === 'push') return s.status === 'modified' || s.status === 'unsynced';
                return s.status === 'modified' || s.status === 'remote-only';
            });

        if (targets.length === 0) {
            new Notice(`No ${op}able files ${filter === 'selected' ? 'selected' : 'found'}.`);
            return;
        }

        const files = targets.map(s => s.file || s.path);
        const serviceName = this.plugin.settings.serviceType === 'gitlab' ? 'GitLab' : 'GitHub';
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
            if (results.errors.length > 0) console.error(`${op} errors:`, results.errors);
            if (filter === 'selected') this.selectedFiles.clear();
            
            new Notice(`${op === 'push' ? 'Push' : 'Pull'} completed. Refreshing…`);
            await this.refreshAllStatuses();
        } catch (e) {
            prog.hide();
            new Notice(`${op === 'push' ? 'Push' : 'Pull'} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async pushSelected(): Promise<void> {
        await this.runBatchOperation('selected', 'push');
    }

    async pullSelected(): Promise<void> {
        await this.runBatchOperation('selected', 'pull');
    }

    async deleteSelected(): Promise<void> {
        if (this.selectedFiles.size === 0) { new Notice('No files selected'); return; }

        const targets = Array.from(this.selectedFiles)
            .map(p => this.fileStatuses.get(p))
            .filter(Boolean) as FileStatus[];

        const local  = targets.filter(s => s.status !== 'remote-only');
        const remote = targets.filter(s => s.status === 'remote-only');
        if (local.length === 0 && remote.length === 0) { new Notice('Nothing to delete'); return; }

        let msg = '';
        if (local.length > 0 && remote.length > 0) msg = `Delete ${local.length} local + ${remote.length} remote file(s)? Cannot be undone.`;
        else if (local.length > 0) msg = `Delete ${local.length} local file(s)? Cannot be undone.`;
        else msg = `Delete ${remote.length} remote file(s)? Cannot be undone.`;

        if (!await this.showConfirmDialog(msg)) return;

        const total = local.length + remote.length;
        const prog = new Notice(`Deleting 0/${total} files…`, 0);
        const errors: string[] = [];
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

        for (const s of remote) {
            cur++;
            prog.setMessage(`Deleting remote ${cur}/${total}: ${s.path}`);
            try {
                await this.plugin.gitService.deleteFile(s.path, this.plugin.settings.branch, `Delete ${s.path}`);
                this.fileStatuses.delete(s.path);
                this.selectedFiles.delete(s.path);
            } catch { errors.push(s.path); }
        }

        prog.hide();
        new Notice(errors.length > 0
            ? `Deleted ${total - errors.length}/${total}. ${errors.length} failed.`
            : `Deleted ${total} files`
        );
        this.renderView();
    }

    onClose(): Promise<void> {
        return Promise.resolve();
    }

    private showConfirmDialog(message: string): Promise<boolean> {
        return new Promise(resolve => {
            new ConfirmModal(
                this.app,
                message,
                () => resolve(true),
                () => resolve(false)
            ).open();
        });
    }
}
