import { ItemView, WorkspaceLeaf, TFile, Notice, Platform, debounce, setIcon, setTooltip } from 'obsidian';
import GitLabFilesPush from '../main';
import { getServiceName, getEffectiveSymlinkHandling, type SymlinkHandling } from '../settings';
import { ConfirmModal } from './ConfirmModal';
import { SyncPlanModal } from './SyncPlanModal';
import { logger } from '../utils/logger';
import { type FileStatus, type FilterValue, type SyncPlan } from './types';
import { renderActionBar } from './components/ActionBar';
import { renderFileItem, renderMoveGroupItem, statusMeta, type FileItemCallbacks, type MoveGroupCallbacks } from './components/FileListItem';
import { ICONS } from './components/icons';
import { isBinaryPath, contentsEqual } from '../utils/path';
import { buildRemoteFileUrl } from '../utils/remote-url';
import { DiffView, SYNC_DIFF_VIEW_TYPE } from './DiffView';
import { readLocalSymlinkTarget } from '../utils/symlink';
import { gitBlobSha } from '../utils/git-blob-sha';
import { type GitTreeEntry } from '../services/git-service-interface';
import { MAX_BATCH_PUSH_SIZE } from '../services/git-service-base';
import { t, type TranslationKey } from '../i18n';
import { type PushResults } from '../logic/sync-manager';

export const SYNC_STATUS_VIEW_TYPE = 'sync-status-view';

type RemoteTreeSnapshot = { branch: string; rootPath: string; head: string; entries: GitTreeEntry[] };

export class SyncStatusView extends ItemView {
    plugin: GitLabFilesPush;
    private readonly fileStatuses: Map<string, FileStatus> = new Map();
    private isRefreshing = false;
    private refreshProgress = { current: 0, total: 0 };
    private statusFilter: FilterValue = 'all';
    private searchQuery = '';
    private readonly selectedFiles: Set<string> = new Set();
    /** Group keys (see groupKey()) currently expanded to show their member rows. */
    private readonly expandedMoveGroups: Set<string> = new Set();
    private lastSyncTime: number = 0;
    private remoteTreeSnapshot?: RemoteTreeSnapshot;
    // Persistent containers created once in onOpen(). renderView() rebuilds
    // only what's inside them, so the search input (which lives in the header,
    // outside both) is never destroyed mid-typing.
    private infoEl?: HTMLElement;
    private bodyEl?: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: GitLabFilesPush) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return SYNC_STATUS_VIEW_TYPE; }
    getDisplayText(): string { return t('syncStatus.viewTitle'); }
    getIcon(): string { return 'git-compare'; }

    onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement | null;
        if (!container) return Promise.resolve();
        container.empty();
        container.addClass('sync-status-view');

        // The search input must sit outside everything renderView() rebuilds:
        // renderView() empties its containers on every interaction (even a
        // checkbox tick), and an input destroyed mid-typing loses focus after
        // a single character. The info strip still needs re-rendering for its
        // last-sync time, so it gets its own slot inside the header.
        const headerEl = container.createDiv({ cls: 'ssv-header' });
        this.infoEl = headerEl.createDiv({ cls: 'ssv-info-slot' });
        this.renderSearchBox(headerEl);
        this.bodyEl = container.createDiv({ cls: 'ssv-body' });

        this.renderView();
        return Promise.resolve();
    }

    private renderView(): void {
        const infoEl = this.infoEl;
        const container = this.bodyEl;
        if (!infoEl || !container) return;

        const prevListEl = container.querySelector<HTMLElement>('.ssv-list');
        const scrollTop = prevListEl?.scrollTop ?? 0;

        infoEl.empty();
        this.renderInfoStrip(infoEl);

        container.empty();

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
        const checked = this.visibleStatuses().filter(s => s.status !== 'checking');
        if (checked.length === 0) return;
        const checkedList = container.createDiv({ cls: 'ssv-list-checked' });
        const cb = this.fileItemCallbacks();
        for (const fs of checked) {
            renderFileItem(checkedList, fs, this.selectedFiles.has(fs.path), cb);
        }
    }

    // ── Search filter ──────────────────────────────────────────────

    /**
     * Built once from onOpen() and deliberately never re-rendered — see the
     * comment there. Applying a filter re-renders the body only, so the
     * input's focus and caret position survive typing.
     */
    private renderSearchBox(container: HTMLElement): void {
        const row = container.createDiv({ cls: 'ssv-search' });
        setIcon(row.createSpan({ cls: 'ssv-search-icon' }), ICONS.search);

        const input = row.createEl('input', {
            type: 'text',
            cls: 'ssv-search-input',
            attr: { placeholder: t('syncStatus.search.placeholder'), spellcheck: 'false' },
        });

        const clearBtn = row.createEl('button', { cls: 'ssv-search-clear' });
        setIcon(clearBtn, ICONS.clear);
        setTooltip(clearBtn, t('syncStatus.search.clear'));

        const apply = (value: string): void => {
            const next = value.trim();
            if (next === this.searchQuery) return;
            this.searchQuery = next;
            this.pruneSelectionToVisible();
            row.toggleClass('has-query', next.length > 0);
            this.renderView();
        };

        // Debounced: every keystroke re-renders the whole list, which is
        // noticeable on a large vault.
        const applyDebounced = debounce(apply, 150, false);

        input.addEventListener('input', () => applyDebounced(input.value));
        input.addEventListener('keydown', (evt) => {
            if (evt.key !== 'Escape' || input.value === '') return;
            evt.preventDefault();
            input.value = '';
            apply('');
        });
        clearBtn.addEventListener('click', () => {
            input.value = '';
            apply('');
            input.focus();
        });
    }

    /**
     * Files matching the search box, before the status tab is applied.
     * Case-insensitive substring against the *full* path — not fuzzy, so a
     * match is always explainable, and typing a folder prefix filters to that
     * folder.
     */
    private searchedStatuses(): FileStatus[] {
        const all = Array.from(this.fileStatuses.values());
        if (this.searchQuery === '') return all;
        const query = this.searchQuery.toLowerCase();
        return all.filter(s => s.path.toLowerCase().includes(query));
    }

    /** The rows actually on screen: search and status tab applied together. */
    private visibleStatuses(): FileStatus[] {
        const searched = this.searchedStatuses();
        return this.statusFilter === 'all' ? searched : searched.filter(s => s.status === this.statusFilter);
    }

    /**
     * Keeps the invariant that the selection is always a subset of what's on
     * screen, by dropping only the entries the current filter hides. Call it
     * after any change to the search or the status tab.
     *
     * The alternative — letting the selection outlive the filter — puts a
     * count on Push/Pull/Delete that the visible rows don't explain. Those
     * actions overwrite the remote, overwrite local files, and delete remote
     * files irreversibly, so acting on something off-screen is not a risk worth
     * trading for the convenience of accumulating a selection across filters.
     * Clearing the selection outright is the other extreme, and throws away
     * ticks that the new filter would still have shown.
     */
    private pruneSelectionToVisible(): void {
        const visible = new Set(this.visibleStatuses().map(s => s.path));
        for (const path of this.selectedFiles) {
            if (!visible.has(path)) this.selectedFiles.delete(path);
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
        // Counted against the search results, not the whole vault: with a
        // filter active the tabs answer "where did my match go?" directly
        // (e.g. `modified 0 · remote-only 3`) instead of leaving the user to
        // hunt through tabs for a file the search has already found.
        const all = this.searchedStatuses();
        const counts: Record<FilterValue, number> = {
            all: all.length,
            synced: all.filter(s => s.status === 'synced').length,
            modified: all.filter(s => s.status === 'modified').length,
            unsynced: all.filter(s => s.status === 'unsynced').length,
            'remote-only': all.filter(s => s.status === 'remote-only').length,
            // Rows, not files: a collapsed 40-file folder move counts as 1, same
            // as every other tab counting what's actually on screen.
            moved: this.movedRowCount(all),
        };

        const tabs: Array<{ value: FilterValue; label: string }> = [
            { value: 'all',         label: t('syncStatus.tab.all') },
            { value: 'synced',      label: t('syncStatus.tab.synced') },
            { value: 'modified',    label: t('syncStatus.tab.modified') },
            { value: 'unsynced',    label: t('syncStatus.tab.unsynced') },
            { value: 'remote-only', label: t('syncStatus.tab.remote-only') },
            // Shown only when there's at least one moved row — most vaults
            // never see one, and a permanent empty tab would just be clutter.
            ...(counts.moved > 0 ? [{ value: 'moved' as const, label: t('syncStatus.tab.moved') }] : []),
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
                // Was: clear the whole selection on any tab change. Pruning
                // instead keeps the ticks the new tab still shows, under the
                // same invariant the search filter follows.
                this.statusFilter = tab.value;
                this.pruneSelectionToVisible();
                this.renderView();
            });
        }
    }

    /** The 'moved' tab count: rows, not files — a collapsed folder-move group is 1 row. */
    private movedRowCount(statuses: FileStatus[]): number {
        const groups = this.collapsibleMoveGroups(statuses);
        const groupedPaths = new Set<string>();
        for (const group of groups.values()) for (const m of group.members) groupedPaths.add(m.path);

        const ungroupedMoved = statuses.filter(s => s.status === 'moved' && !groupedPaths.has(s.path)).length;
        return ungroupedMoved + groups.size;
    }

    // ── Action bar ─────────────────────────────────────────────────

    private renderActionBarSection(container: HTMLElement): void {
        const visible = this.visibleStatuses();
        const selected = Array.from(this.selectedFiles)
            .map(p => this.fileStatuses.get(p))
            .filter(Boolean) as FileStatus[];

        const allSelected = visible.length > 0 && visible.every(s => this.selectedFiles.has(s.path));

        renderActionBar(container, {
            hasFiles:      this.fileStatuses.size > 0,
            allSelected,
            indeterminate: this.selectedFiles.size > 0 && !allSelected,
            canPush:   selected.filter(s => s.status === 'modified' || s.status === 'unsynced' || s.status === 'moved').length,
            // Moved rows are excluded here too: a bulk Pull on a moved row
            // would silently undo the move, so it only has a per-row revert
            // action with its own confirm — see FileListItem's onRevertMove.
            canPull:   selected.filter(s => s.status === 'modified' || s.status === 'remote-only').length,
            canDelete: selected.filter(s => s.status !== 'moved').length,
        }, {
            onRefresh:   () => void this.refreshAllStatuses(),
            onSelectAll: (select) => {
                // Symmetric with select, and both act only on what's on screen —
                // consistent with the invariant that the selection never holds
                // anything the current filter is hiding.
                for (const s of visible) {
                    if (select) this.selectedFiles.add(s.path);
                    else this.selectedFiles.delete(s.path);
                }
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
            onOpen:   (fs, newLeaf) => this.openFileFromRow(fs, newLeaf),
            canOpen:  (fs) => this.openTargetFor(fs) !== null,
            onOpenDiffPane: (fs) => void this.openDiffPane(fs),
            onRevertMove: (fs) => void this.revertMove(fs),
        };
    }

    /**
     * Undoes a pending move by moving the local file back to where it was
     * last synced. Reuses the same trackRename mechanism a real vault rename
     * goes through: moving back to the still-unpushed remote path is exactly
     * the "rename cancels itself" case, so the pending move disappears.
     */
    private async revertMove(fileStatus: FileStatus): Promise<void> {
        if (!fileStatus.movedFrom) return;
        const confirmed = await this.showConfirmDialog(
            t('syncStatus.confirmRevertMove', { from: fileStatus.path, to: fileStatus.movedFrom })
        );
        if (!confirmed) return;

        try {
            const file = fileStatus.file ?? this.app.vault.getFileByPath(fileStatus.path);
            if (file instanceof TFile) {
                await this.app.fileManager.renameFile(file, fileStatus.movedFrom);
            } else {
                await this.app.vault.adapter.rename(fileStatus.path, fileStatus.movedFrom);
                await this.plugin.sync.trackRename(fileStatus.movedFrom, fileStatus.path);
            }
            new Notice(t('syncStatus.notice.moveReverted', { path: fileStatus.movedFrom }));
            await this.refreshAllStatuses();
        } catch (e) {
            new Notice(t('syncStatus.notice.revertFailed', { message: e instanceof Error ? e.message : String(e) }));
        }
    }

    /**
     * Shows a file's diff in its own workspace pane, reusing the one already
     * open rather than stacking a pane per file. The first pane goes in a new
     * tab and stays wherever the user drags it, since reuse keeps it there.
     */
    private async openDiffPane(fileStatus: FileStatus): Promise<void> {
        await this.loadDiffContent(fileStatus);

        const existing = this.app.workspace.getLeavesOfType(SYNC_DIFF_VIEW_TYPE)[0];
        const leaf = existing ?? this.app.workspace.getLeaf('tab');
        if (!existing) {
            await leaf.setViewState({ type: SYNC_DIFF_VIEW_TYPE, active: true });
        }

        const view = leaf.view;
        if (view instanceof DiffView) view.setDiff(fileStatus);
        await this.app.workspace.revealLeaf(leaf);
    }

    /**
     * Closes the diff pane when it's showing a file whose content has just
     * changed under it. The pane would otherwise keep displaying the pre-push
     * diff while looking perfectly current.
     */
    private closeDiffPaneFor(paths: Iterable<string>): void {
        const changed = new Set(paths);
        for (const leaf of this.app.workspace.getLeavesOfType(SYNC_DIFF_VIEW_TYPE)) {
            const view = leaf.view;
            const shown = view instanceof DiffView ? view.getPath() : null;
            if (shown !== null && changed.has(shown)) leaf.detach();
        }
    }

    /**
     * Where a row's path points: the vault when there's a local file to open,
     * the provider's site when the file only exists on the remote. Null means
     * neither is possible, and the caller renders plain text — a link that goes
     * nowhere is worse than no link.
     */
    private openTargetFor(fileStatus: FileStatus): { kind: 'local'; file: TFile } | { kind: 'remote'; url: string } | null {
        if (fileStatus.status === 'remote-only') {
            const url = buildRemoteFileUrl(this.plugin.settings, this.plugin.getNormalizedPath(fileStatus.path));
            return url ? { kind: 'remote', url } : null;
        }

        // The panel deliberately tracks paths outside Obsidian's file index
        // (hidden files, .obsidian/), and those have no TFile to open. They
        // don't fall back to the remote link: a local-only file isn't there.
        const file = fileStatus.file ?? this.app.vault.getFileByPath(fileStatus.path);
        return file instanceof TFile ? { kind: 'local', file } : null;
    }

    private openFileFromRow(fileStatus: FileStatus, newLeaf: boolean): boolean {
        const target = this.openTargetFor(fileStatus);
        if (!target) return false;

        if (target.kind === 'local') {
            void this.app.workspace.getLeaf(newLeaf).openFile(target.file);
        } else {
            window.open(target.url, '_blank');
        }
        return true;
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
        const statuses = this.visibleStatuses();

        if (statuses.length === 0) {
            // With a search active, "no Changed files" would misattribute the
            // empty list to the tab when it's the query that matched nothing.
            const text = this.searchQuery !== ''
                ? t('syncStatus.noFilesForSearch', { query: this.searchQuery })
                : t('syncStatus.noFilesForFilter', {
                    filter: this.statusFilter === 'all' ? t('syncStatus.tab.all') : statusMeta(this.statusFilter).label
                });
            container.createDiv({ cls: 'ssv-empty', text });
            return;
        }

        const groups = this.collapsibleMoveGroups(statuses);
        const groupedPaths = new Set<string>();
        for (const group of groups.values()) for (const m of group.members) groupedPaths.add(m.path);

        const cb = this.fileItemCallbacks();
        const renderedGroups = new Set<string>();
        for (const fs of statuses) {
            if (groupedPaths.has(fs.path)) {
                this.renderGroupedRowOnce(container, fs, groups, renderedGroups);
            } else {
                renderFileItem(container, fs, this.selectedFiles.has(fs.path), cb);
            }
        }
    }

    /** Renders a collapsed folder-move row the first time one of its members is reached, then skips its later members. */
    private renderGroupedRowOnce(
        container: HTMLElement,
        fs: FileStatus,
        groups: Map<string, { oldPrefix: string; newPrefix: string; members: FileStatus[] }>,
        renderedGroups: Set<string>
    ): void {
        const key = this.groupKey(fs);
        if (key === null || renderedGroups.has(key)) return;
        renderedGroups.add(key);

        const group = groups.get(key);
        if (!group) return;
        renderMoveGroupItem(
            container, key, group.oldPrefix, group.newPrefix, group.members,
            group.members.every(m => this.selectedFiles.has(m.path)),
            this.expandedMoveGroups.has(key),
            this.moveGroupCallbacks()
        );
    }

    // ── Folder-move collapsing (#67) ────────────────────────────

    /**
     * The (oldPrefix, newPrefix) pair a moved file belongs to, derived by
     * matching path segments from the end: everything that still matches
     * between the old and new path is the unchanged relative suffix, and
     * whatever differs before that is the folder that moved. This generalizes
     * to any nesting depth without needing to know the folder move's actual
     * boundary up front — a file whose own name also changed (not just its
     * folder) simply gets a prefix pair unique to itself, so it naturally
     * never groups with anything else. JSON-encoded so the pair round-trips
     * exactly through a Map key regardless of what characters the paths
     * themselves contain.
     */
    private groupKey(fs: FileStatus): string | null {
        const prefixes = this.groupPrefixes(fs);
        return prefixes && JSON.stringify(prefixes);
    }

    private groupPrefixes(fs: FileStatus): { oldPrefix: string; newPrefix: string } | null {
        if (!fs.movedFrom) return null;
        const oldSegs = fs.movedFrom.split('/');
        const newSegs = fs.path.split('/');
        let i = oldSegs.length - 1;
        let j = newSegs.length - 1;
        while (i >= 1 && j >= 1 && oldSegs[i] === newSegs[j]) { i--; j--; }
        return {
            oldPrefix: oldSegs.slice(0, i + 1).join('/'),
            newPrefix: newSegs.slice(0, j + 1).join('/'),
        };
    }

    /**
     * True when some currently-tracked file still lives under `oldPrefix`
     * without having moved — i.e. only part of that folder's contents moved.
     * Partial moves are exactly where the user needs the per-file detail, so
     * a group failing this check is left as individual rows instead of being
     * collapsed.
     */
    private isPartialMove(oldPrefix: string): boolean {
        const prefix = `${oldPrefix}/`;
        for (const fs of this.fileStatuses.values()) {
            if (fs.status === 'moved') continue;
            if (fs.path === oldPrefix || fs.path.startsWith(prefix)) return true;
        }
        return false;
    }

    /**
     * Groups of 'moved' rows worth collapsing into a single folder row: more
     * than one file sharing a (oldPrefix, newPrefix) pair, with nothing left
     * behind under the old prefix. A group of one is just a plain moved row —
     * collapsing it would add an expand affordance for nothing.
     */
    private collapsibleMoveGroups(statuses: FileStatus[]): Map<string, { oldPrefix: string; newPrefix: string; members: FileStatus[] }> {
        const byKey = new Map<string, { oldPrefix: string; newPrefix: string; members: FileStatus[] }>();
        for (const fs of statuses) {
            if (fs.status !== 'moved') continue;
            const prefixes = this.groupPrefixes(fs);
            if (!prefixes) continue;
            const key = JSON.stringify(prefixes);
            const existing = byKey.get(key);
            if (existing) existing.members.push(fs);
            else byKey.set(key, { ...prefixes, members: [fs] });
        }

        const collapsible = new Map<string, { oldPrefix: string; newPrefix: string; members: FileStatus[] }>();
        for (const [key, group] of byKey) {
            if (group.members.length < 2) continue;
            if (this.isPartialMove(group.oldPrefix)) continue;
            collapsible.set(key, group);
        }
        return collapsible;
    }

    private moveGroupCallbacks(): MoveGroupCallbacks {
        return {
            onSelect: (members, selected) => {
                for (const m of members) {
                    if (selected) this.selectedFiles.add(m.path);
                    else this.selectedFiles.delete(m.path);
                }
                this.renderView();
            },
            onPush: (members) => void this.pushMoveGroup(members),
            onRevertMove: (members) => void this.revertMoveGroup(members),
            onToggleExpand: (key) => {
                if (this.expandedMoveGroups.has(key)) this.expandedMoveGroups.delete(key);
                else this.expandedMoveGroups.add(key);
                this.renderView();
            },
        };
    }

    /** Pushes every member of a collapsed folder-move row through the batch flow, so the whole group lands in one commit. */
    private async pushMoveGroup(members: FileStatus[]): Promise<void> {
        const files = members.map(m => m.file || m.path);
        try {
            const results = await this.plugin.sync.pushAllFiles(files);
            this.applyOptimisticSyncedStatus(results.syncedPaths);
            this.renderView();
        } catch (e) {
            new Notice(t('syncStatus.notice.opFailed', { verb: t('main.verb.push'), message: e instanceof Error ? e.message : String(e) }));
        }
    }

    /** Reverts every member of a collapsed folder-move row — moves each local file back to where it was. */
    private async revertMoveGroup(members: FileStatus[]): Promise<void> {
        const confirmed = await this.showConfirmDialog(t('syncStatus.confirmRevertMoveGroup', { count: members.length }));
        if (!confirmed) return;

        for (const m of members) {
            if (!m.movedFrom) continue;
            try {
                const file = m.file ?? this.app.vault.getFileByPath(m.path);
                if (file instanceof TFile) {
                    await this.app.fileManager.renameFile(file, m.movedFrom);
                } else {
                    await this.app.vault.adapter.rename(m.path, m.movedFrom);
                    await this.plugin.sync.trackRename(m.movedFrom, m.path);
                }
            } catch (e) {
                logger.warn(`Failed to revert move for ${m.path}`, e);
            }
        }
        new Notice(t('syncStatus.notice.moveReverted', { path: `${members.length} file(s)` }));
        await this.refreshAllStatuses();
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
        // Unlike the batch operations below, this had no "in progress" feedback at
        // all -- only the row's icon flipped to `checking`. pushFile() can do a
        // few sequential remote requests (conflict check, rename detection) before
        // its own success/failure Notice fires, so a slow network made a push look
        // like a no-op until a toast finally appeared.
        const runVerb = op === 'push' ? t('main.verb.pushing') : t('main.verb.pulling');
        const prog = new Notice(t('syncStatus.notice.opStarted', { verb: runVerb, name: fileStatus.path }), 0);
        try {
            fileStatus.status = 'checking';
            this.closeDiffPaneFor([fileStatus.path]);
            this.renderView();

            if (op === 'push') {
                const result = await this.plugin.sync.pushFile(fileStatus.file || fileStatus.path);
                prog.hide();
                if (result) {
                    // Same approach as executeBatchOperation's applyOptimisticSyncedStatus:
                    // trust what was just written instead of re-fetching the remote tree,
                    // which can lag a successful write by a few seconds. Passing `undefined`
                    // as refreshFileStatus's remoteEntry (the old code path) claims the file
                    // isn't on the remote at all, which forces 'unsynced' right after a
                    // successful push -- the bug being fixed here.
                    this.applyOptimisticSyncedStatus([{ path: fileStatus.path, sha: result.sha }]);
                } else {
                    // Not a confirmed sync (file deleted, remote symlink left untouched, or a
                    // conflict deferred to its modal) -- fall back to an accurate live check.
                    await this.refreshFileStatusByContent(fileStatus.file || fileStatus.path);
                }
            } else {
                await this.plugin.sync.pullFile(fileStatus.file || fileStatus.path);
                prog.hide();
                await this.refreshFileStatusByContent(fileStatus.file || fileStatus.path);
            }

            this.renderView();
        } catch (e) {
            prog.hide();
            const verb = op === 'push' ? t('main.verb.push') : t('main.verb.pull');
            new Notice(t('syncStatus.notice.opFailed', { verb, message: e instanceof Error ? e.message : String(e) }));
            await this.refreshFileStatusByContent(fileStatus.file || fileStatus.path);
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
            const extra = await this.identifyExtraFiles(files.remoteMap, files.localMap, files.allMap, this.pendingMoveOldPaths());
            this.addExtraToStatuses(extra);

            // Re-render info/tabs but keep progress bar (renderView handles this)
            this.renderView();

            const filesToCheck = this.getCheckableFiles(files.local, extra, files.hiddenLocalPaths);
            await this.performStatusCheck(filesToCheck, files.remoteMap);
            await this.reconcileOutOfBandMoves(files.remoteMap);

            this.saveRemoteTreeSnapshot(files.remoteHead, files.remoteEntries);
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
        const remoteHead = await this.plugin.gitService.getBranchHead?.(this.plugin.settings.branch);
        // Unfiltered: getNormalizedRemotePath below applies the same rootPath
        // filter, and gitignore discovery needs the entries outside rootPath
        // (e.g. the repo-root .gitignore). Sharing this one tree saves
        // loadGitignores a second full-tree fetch on every refresh.
        const remoteEntries = await this.plugin.gitService.listFilesDetailed(remoteHead ?? this.plugin.settings.branch, false);

        await this.plugin.gitignoreManager.loadGitignores(remoteEntries);

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
            remoteEntries,
            remoteHead,
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

    /** Every path a pending move's `renamedFrom` still points at — the remote's copy at each is represented by the moved row at its new path, not a separate remote-only row. */
    private pendingMoveOldPaths(): Set<string> {
        const paths = new Set<string>();
        for (const meta of Object.values(this.plugin.settings.syncMetadata ?? {})) {
            if (meta.renamedFrom) paths.add(meta.renamedFrom);
        }
        return paths;
    }

    private async identifyExtraFiles(remoteMap: Map<string, GitTreeEntry>, localFilePaths: Set<string>, allLocalFileMap: Map<string, TFile>, pendingMoveOldPaths: Set<string> = new Set()) {
        const extra: Array<TFile | string> = [];
        for (const [vaultPath] of remoteMap.entries()) {
            if (localFilePaths.has(vaultPath)) continue;
            if (pendingMoveOldPaths.has(vaultPath)) continue;

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

    /**
     * Pairs an orphaned remote-only entry with a local-only file sharing its
     * exact content — for moves that happened while the plugin wasn't
     * observing the vault's live 'rename' event (Obsidian closed, an
     * external tool or another device moved it, or the plugin hadn't
     * finished loading yet). Live tracking in main.ts already covers every
     * in-app move; this only fills the gap live tracking can't see.
     *
     * An orphan only counts if it still carries synced metadata pointing at
     * that exact path — a brand-new remote file that happens to share
     * content with an unrelated local draft must never be mistaken for a
     * move. And a sha match only counts when it's unambiguous on both
     * sides — a boilerplate/template file legitimately duplicated at
     * several paths must not get paired at random.
     */
    private async reconcileOutOfBandMoves(remoteMap: Map<string, GitTreeEntry>): Promise<void> {
        const orphansBySha = this.orphanedMoveSourcesBySha(remoteMap);
        if (orphansBySha.size === 0) return;

        const candidatesBySha = await this.unsyncedMoveDestinationsBySha(remoteMap, orphansBySha);

        for (const [sha, orphanPaths] of orphansBySha) {
            if (orphanPaths.length !== 1) continue; // ambiguous on the remote side
            const newPaths = candidatesBySha.get(sha);
            if (!newPaths || newPaths.length !== 1) continue; // ambiguous or unmatched on the local side
            const oldPath = orphanPaths[0] as string;
            const newPath = newPaths[0] as string;
            await this.plugin.sync.trackRename(newPath, oldPath);
            this.fileStatuses.delete(oldPath);
            await this.refreshFileStatus(newPath, remoteMap.get(newPath));
        }
    }

    /** Every 'remote-only' row that still carries synced metadata at that exact path, grouped by its remote blob sha. */
    private orphanedMoveSourcesBySha(remoteMap: Map<string, GitTreeEntry>): Map<string, string[]> {
        const metadata = this.plugin.settings.syncMetadata ?? {};
        const orphansBySha = new Map<string, string[]>();
        for (const [path, status] of this.fileStatuses) {
            if (status.status !== 'remote-only') continue;
            const meta = metadata[path];
            if (!meta || meta.lastKnownPath !== path || meta.renamedFrom) continue;
            const entry = remoteMap.get(path);
            if (!entry || entry.symlink || !entry.sha) continue;
            const list = orphansBySha.get(entry.sha) ?? [];
            list.push(path);
            orphansBySha.set(entry.sha, list);
        }
        return orphansBySha;
    }

    /** Every 'unsynced' row with no remote entry of its own, grouped by its local blob sha — but only shas an orphan actually needs. */
    private async unsyncedMoveDestinationsBySha(
        remoteMap: Map<string, GitTreeEntry>,
        orphansBySha: Map<string, string[]>
    ): Promise<Map<string, string[]>> {
        const candidatesBySha = new Map<string, string[]>();
        for (const [path, status] of this.fileStatuses) {
            if (status.status !== 'unsynced' || status.localContent === undefined) continue;
            if (remoteMap.has(path)) continue; // has its own remote entry; not a move destination
            const sha = await gitBlobSha(status.localContent);
            if (!orphansBySha.has(sha)) continue;
            const list = candidatesBySha.get(sha) ?? [];
            list.push(path);
            candidatesBySha.set(sha, list);
        }
        return candidatesBySha;
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
     * Live-updates one already-tracked file's status after Obsidian reports its
     * content changed (called from main.ts's vault 'modify' handler, gated to
     * files inside the configured vault folder). Re-derives 'synced'/'modified'
     * from a local hash against the remote SHA already known from the last full
     * refresh -- no network call, so this is cheap enough to run on every edit.
     *
     * Only applies to a path already showing 'synced', 'modified', or
     * 'unsynced' -- the three statuses a direct content comparison drives.
     * 'moved' is driven by tracked rename metadata, not content, and stays
     * 'moved' regardless of edits (a rename + edit is still a move, per #66's
     * edge cases); 'remote-only' has no local file to have changed; 'checking'
     * means a full refresh is already in flight and will supersede this. A
     * path the panel isn't currently tracking at all is left alone too --
     * discovering new files requires the remote tree and belongs to a full
     * refresh, not a per-edit hook.
     */
    async handleFileModified(file: TFile): Promise<void> {
        const existing = this.fileStatuses.get(file.path);
        if (!existing || (existing.status !== 'synced' && existing.status !== 'modified' && existing.status !== 'unsynced')) return;

        const localContent = await this.readFileContent(file, this.isBinary(file.path), false);

        if (existing.remoteSha === undefined) {
            this.fileStatuses.set(file.path, { ...existing, localContent });
        } else {
            const localSha = await gitBlobSha(localContent);
            const status = localSha === existing.remoteSha ? 'synced' : 'modified';
            this.fileStatuses.set(file.path, { ...existing, status, localContent });
        }

        this.renderView();
    }

    /**
     * Live-updates the sync panel after Obsidian reports a rename (called from
     * main.ts's vault 'rename' handler, once SyncManager.trackRename has
     * already updated syncMetadata -- so this only ever reads state that's
     * already settled, no network call). Mirrors what a full refresh would
     * classify the new path as, from data already known:
     *
     * - Not currently tracked at the old path (gitignored, or the panel
     *   hasn't refreshed since it appeared) -- nothing to do.
     * - A refresh is mid-flight for the old path ('checking') -- it will
     *   settle on its own; touching it here would race the refresh.
     * - The new path fell outside the configured vault folder -- the row
     *   simply disappears, same as any other out-of-scope file.
     * - syncMetadata carries a renamedFrom for the new path (the common
     *   case, set by the trackRename this follows) -- becomes a 'moved' row.
     * - No renamedFrom (never synced, or renamed back to its last-synced
     *   path and the pending move cancelled itself) -- carries the previous
     *   status over at the new path rather than inventing one.
     */
    handleFileRenamed(file: TFile, oldPath: string): void {
        const existing = this.fileStatuses.get(oldPath);
        if (!existing || existing.status === 'checking') return;

        this.fileStatuses.delete(oldPath);

        if (!this.plugin.filterPathByVaultFolder(file.path)) {
            this.renderView();
            return;
        }

        const renamedFrom = this.plugin.settings.syncMetadata?.[file.path]?.renamedFrom;
        if (renamedFrom !== undefined) {
            this.fileStatuses.set(file.path, { file, path: file.path, status: 'moved', movedFrom: renamedFrom });
        } else {
            this.fileStatuses.set(file.path, { ...existing, file, path: file.path });
        }

        this.renderView();
    }

    /**
     * Classifies a file's sync status. When the remote tree entry carries a git
     * blob SHA (the common case), this is a single local hash + comparison with
     * no network request (Phase 1 of the SHA-based refresh). Falls back to the
     * previous full-content comparison via getFile() only when a tree entry
     * exists but the provider did not supply its SHA. A missing tree entry is
     * already conclusive: it is a new local-only file and needs no 404 probe.
     */
    private async refreshFileStatus(fileOrPath: TFile | string, remoteEntry: GitTreeEntry | undefined): Promise<void> {
        try {
            const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
            const renamedFrom = this.plugin.settings.syncMetadata?.[path]?.renamedFrom;
            if (renamedFrom !== undefined) {
                // A pending move is known from metadata alone — no tree lookup
                // or content read needed, same as the perf goal for every other
                // SHA-based classification here.
                this.fileStatuses.set(path, {
                    file: typeof fileOrPath === 'string' ? undefined : fileOrPath,
                    path,
                    status: 'moved',
                    movedFrom: renamedFrom,
                });
                return;
            }

            if (remoteEntry === undefined) {
                await this.refreshLocalOnlyStatus(fileOrPath);
            } else if (remoteEntry.sha !== undefined) {
                await this.refreshFileStatusBySha(fileOrPath, remoteEntry);
            } else {
                await this.refreshFileStatusByContent(fileOrPath);
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

    private async refreshLocalOnlyStatus(fileOrPath: TFile | string): Promise<void> {
        const isStr = typeof fileOrPath === 'string';
        const path = isStr ? fileOrPath : fileOrPath.path;
        const localContent = await this.readFileContent(fileOrPath, this.isBinary(path), isStr);
        this.fileStatuses.set(path, {
            file: isStr ? undefined : fileOrPath,
            path,
            status: 'unsynced',
            localContent,
        });
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
                ? s.status === 'modified' || s.status === 'unsynced' || s.status === 'moved'
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

    private saveRemoteTreeSnapshot(head: string | undefined, entries: GitTreeEntry[]): void {
        this.remoteTreeSnapshot = head
            ? { branch: this.plugin.settings.branch, rootPath: this.plugin.settings.rootPath, head, entries }
            : undefined;
    }

    private async getReusableRemoteTree(): Promise<GitTreeEntry[] | undefined> {
        const snapshot = this.remoteTreeSnapshot;
        if (!snapshot || !this.plugin.gitService.getBranchHead || snapshot.branch !== this.plugin.settings.branch || snapshot.rootPath !== this.plugin.settings.rootPath) return undefined;

        try {
            const currentHead = await this.plugin.gitService.getBranchHead(snapshot.branch);
            return currentHead === snapshot.head ? snapshot.entries : undefined;
        } catch (error) {
            logger.warn('Failed to validate remote tree snapshot; fetching a fresh tree for push.', error);
            return undefined;
        }
    }

    private async executeBatchOperation(filter: 'modified' | 'selected', op: 'push' | 'pull', files: Array<string | TFile>): Promise<void> {
        const runVerb = op === 'push' ? t('main.verb.pushing') : t('main.verb.pulling');
        const prog = new Notice(t('main.progress.running', { verb: runVerb, total: files.length }), 0);
        this.closeDiffPaneFor(files.map(f => typeof f === 'string' ? f : f.path));
        try {
            const remoteTree = await this.getReusableRemoteTree();
            const results = op === 'push'
                ? await this.plugin.sync.pushAllFiles(files, (cur, total, name) => prog.setMessage(t('syncStatus.progress.pushing', { current: cur, total, name })), remoteTree)
                : await this.plugin.sync.pullAllFiles(files, (cur, total, name) => prog.setMessage(t('syncStatus.progress.pulling', { current: cur, total, name })), remoteTree);

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
        if (!await this.confirmDeletion(local, remote)) return;

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
            // Moved rows go through neither bucket: bulk delete on a moved row
            // is ambiguous (delete the new local file? the pending remote
            // move?) and isn't offered — see canDelete's count above.
            local:  targets.filter(s => s.status !== 'remote-only' && s.status !== 'moved'),
            remote: targets.filter(s => s.status === 'remote-only')
        };
    }

    private async confirmDeletion(local: FileStatus[], remote: FileStatus[]): Promise<boolean> {
        // Local deletes go through Obsidian's own trash handling, whose actual
        // destination (vault .trash/, OS trash, or permanent) depends on the
        // user's "Deleted files" setting — not something this plugin can read.
        // So local wording defers to that setting rather than promising
        // recoverability; remote deletes are unconditionally permanent, so
        // those get the full plan-review modal instead of a plain confirm.
        if (remote.length === 0) {
            return this.showConfirmDialog(t('syncStatus.confirmDelete.localOnly', { local: local.length }));
        }

        const plan: SyncPlan = {
            additions: [], modifications: [], moves: [],
            deletions: remote.map(s => ({ path: s.path, name: s.file?.name ?? s.path.split('/').pop() ?? s.path }))
        };
        const description = local.length > 0 ? t('syncStatus.confirmDelete.alsoLocal', { local: local.length }) : undefined;
        return new Promise(resolve => {
            new SyncPlanModal(this.app, plan, 'delete', () => resolve(true), () => resolve(false), description).open();
        });
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
