import { Platform, debounce, setIcon, setTooltip } from 'obsidian';
import type { SyncWorkspaceInfo } from '../../logic/sync/SyncWorkspace';
import type { FileStatus, SyncStatusService } from '../../logic/sync-status-service';
import { t } from '../../i18n';
import { renderActionBar } from '../components/ActionBar';
import {
    renderFileItem,
    renderMoveGroupItem,
    statusMeta,
    type FileItemCallbacks,
    type MoveGroupCallbacks,
} from '../components/FileListItem';
import { renderFolderItem, type FolderTreeItemCallbacks } from '../components/FolderTreeItem';
import { buildStatusTree, type StatusTreeNode } from '../components/StatusTree';
import { ICONS } from '../components/icons';
import type { FilterValue } from '../types';
import type { SyncStatusController } from './SyncStatusController';
import type { SyncStatusViewState } from './SyncStatusViewState';
import {
    collapsibleMoveGroups,
    isMoveGroupExpanded,
    isTreeFolderExpanded,
    moveGroupKey,
    pruneSelection,
    searchedStatuses,
    sortStatuses,
    visibleStatuses,
} from './SyncStatusSelectors';

type MoveGroups = Map<string, { oldPrefix: string; newPrefix: string; members: FileStatus[] }>;

/** Renders sync-status presentation from state and domain DTOs only. */
export class SyncStatusRenderer {
    constructor(
        private readonly workspaceInfo: () => SyncWorkspaceInfo,
        private readonly state: SyncStatusViewState,
        private readonly statuses: SyncStatusService,
        private readonly controller: SyncStatusController,
        private readonly rerender: () => void,
    ) {}

    render(info: HTMLElement, body: HTMLElement): void {
        const scrollTop = body.querySelector<HTMLElement>('.ssv-list')?.scrollTop ?? 0;
        info.empty();
        this.renderInfoStrip(info);
        body.empty();
        this.renderTabs(body);
        this.renderActionBar(body);
        const list = body.createDiv({ cls: 'ssv-list' });
        if (this.state.refreshState.isRefreshing) {
            this.renderProgress(list);
            this.renderCheckedFiles(list);
        } else if (this.statuses.size === 0) {
            list.createDiv({ cls: 'ssv-empty', text: t('syncStatus.emptyPrompt') });
        } else {
            this.renderFileList(list);
        }
        list.scrollTop = scrollTop;
    }

    renderSearchBox(container: HTMLElement): void {
        const row = container.createDiv({ cls: 'ssv-search' });
        setIcon(row.createSpan({ cls: 'ssv-search-icon' }), ICONS.search);
        const input = row.createEl('input', {
            type: 'text',
            cls: 'ssv-search-input',
            attr: { placeholder: t('syncStatus.search.placeholder'), spellcheck: 'false' },
        });
        const clear = row.createEl('button', { cls: 'ssv-search-clear' });
        setIcon(clear, ICONS.clear);
        setTooltip(clear, t('syncStatus.search.clear'));
        const apply = (value: string): void => {
            const next = value.trim();
            if (next === this.state.searchQuery) return;
            this.state.setSearchQuery(next);
            this.pruneSelection();
            row.toggleClass('has-query', next.length > 0);
            this.rerender();
        };
        const applyDebounced = debounce(apply, 150, false);
        input.addEventListener('input', () => applyDebounced(input.value));
        input.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || input.value === '') return;
            event.preventDefault();
            input.value = '';
            apply('');
        });
        clear.addEventListener('click', () => {
            input.value = '';
            apply('');
            input.focus();
        });
    }

    searchedStatuses(): FileStatus[] {
        return searchedStatuses(this.state, Array.from(this.statuses.values()));
    }

    visibleStatuses(): FileStatus[] {
        return visibleStatuses(this.state, Array.from(this.statuses.values()));
    }

    sortStatuses(statuses: FileStatus[]): FileStatus[] {
        return sortStatuses(statuses);
    }

    pruneSelection(): void {
        this.state.retainSelected(pruneSelection(this.state.selectedFiles, this.visibleStatuses()));
    }

    renderTabs(container: HTMLElement): void {
        const all = this.searchedStatuses();
        const counts: Record<FilterValue, number> = {
            all: !this.state.treeViewEnabled || this.state.showSyncedInAll ? all.length : all.filter(status => status.status !== 'synced').length,
            synced: all.filter(status => status.status === 'synced').length,
            modified: all.filter(status => status.status === 'modified').length,
            unsynced: all.filter(status => status.status === 'unsynced').length,
            'remote-only': all.filter(status => status.status === 'remote-only').length,
            moved: this.movedRowCount(all),
        };
        const tabs: Array<{ value: FilterValue; label: string }> = [
            { value: 'all', label: t('syncStatus.tab.all') },
            { value: 'modified', label: t('syncStatus.tab.modified') },
            { value: 'unsynced', label: t('syncStatus.tab.unsynced') },
            { value: 'remote-only', label: t('syncStatus.tab.remote-only') },
            ...(counts.moved > 0 ? [{ value: 'moved' as const, label: t('syncStatus.tab.moved') }] : []),
            { value: 'synced', label: t('syncStatus.tab.synced') },
        ];
        if (Platform.isMobile) {
            this.renderMobileFilter(container, tabs, counts);
            return;
        }
        const tabsElement = container.createDiv({ cls: 'ssv-tabs' });
        for (const tab of tabs) {
            const button = tabsElement.createEl('button', { cls: `ssv-tab${this.state.statusFilter === tab.value ? ' active' : ''}` });
            if (tab.value !== 'all') setIcon(button.createSpan(), statusMeta(tab.value).icon);
            button.createSpan({ cls: 'ssv-tab-label', text: ` ${tab.label}` });
            if (tab.value === 'all' || counts[tab.value] > 0) button.createSpan({ cls: 'ssv-tab-count', text: String(counts[tab.value]) });
            setTooltip(button, tab.label);
            button.addEventListener('click', () => this.applyFilter(tab.value));
        }
    }

    movedRowCount(statuses: FileStatus[]): number {
        const groups = this.collapsibleMoveGroups(statuses);
        const groupedPaths = new Set<string>();
        for (const group of groups.values()) for (const member of group.members) groupedPaths.add(member.path);
        return statuses.filter(status => status.status === 'moved' && !groupedPaths.has(status.path)).length + groups.size;
    }

    collapsibleMoveGroups(displayed: FileStatus[]): MoveGroups {
        return collapsibleMoveGroups(displayed, Array.from(this.statuses.values()));
    }

    private renderProgress(container: HTMLElement): void {
        const { current, total } = this.state.refreshState;
        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
        const progress = container.createDiv({ cls: 'ssv-progress' });
        progress.createDiv({
            cls: 'ssv-progress-text',
            text: total > 0
                ? t('syncStatus.progress.checkingWithCount', { current, total, pct: percentage })
                : t('syncStatus.progress.checking'),
        });
        const bar = progress.createDiv({ cls: 'ssv-progress-bar' });
        bar.createDiv({ cls: 'ssv-progress-fill' }).setAttr('style', `width: ${percentage}%`);
    }

    private renderCheckedFiles(container: HTMLElement): void {
        const checked = this.visibleStatuses().filter(status => status.status !== 'checking');
        if (checked.length === 0) return;
        const list = container.createDiv({ cls: 'ssv-list-checked' });
        const callbacks = this.fileCallbacks();
        for (const status of checked) renderFileItem(list, status, this.state.selectedFiles.has(status.path), callbacks);
    }

    private renderInfoStrip(container: HTMLElement): void {
        const infoModel = this.workspaceInfo();
        const info = container.createDiv({ cls: 'ssv-info' });
        info.createSpan({ cls: 'ssv-info-item', text: infoModel.serviceName });
        if (!Platform.isMobile) {
            info.createSpan({ cls: 'ssv-info-sep', text: '·' });
            const branch = info.createSpan({ cls: 'ssv-info-item' });
            setIcon(branch.createSpan({ cls: 'ssv-info-icon' }), ICONS.branch);
            branch.createSpan({ text: ` ${infoModel.branch}` });
        }
        if (infoModel.vaultFolder) {
            info.createSpan({ cls: 'ssv-info-sep', text: '·' });
            const folder = info.createSpan({ cls: 'ssv-info-item' });
            setIcon(folder.createSpan({ cls: 'ssv-info-icon' }), ICONS.folder);
            folder.createSpan({ text: ` ${infoModel.vaultFolder}` });
        }
        if (this.state.refreshState.lastSyncTime > 0) {
            info.createSpan({ cls: 'ssv-info-sep', text: '·' });
            const date = new Date(this.state.refreshState.lastSyncTime);
            info.createSpan({
                cls: 'ssv-info-time',
                text: Platform.isMobile
                    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : t('syncStatus.lastSync', { time: date.toLocaleTimeString() }),
            });
        }
    }

    private renderMobileFilter(container: HTMLElement, tabs: Array<{ value: FilterValue; label: string }>, counts: Record<FilterValue, number>): void {
        const select = container.createEl('select', { cls: 'ssv-filter-select', attr: { 'aria-label': t('syncStatus.filterByStatus') } });
        for (const tab of tabs) select.createEl('option', { text: `${tab.label} (${counts[tab.value]})`, value: tab.value });
        select.value = this.state.statusFilter;
        select.addEventListener('change', () => this.applyFilter(select.value as FilterValue));
    }

    private applyFilter(filter: FilterValue): void {
        this.state.setStatusFilter(filter);
        this.pruneSelection();
        this.rerender();
    }

    private renderActionBar(container: HTMLElement): void {
        const visible = this.visibleStatuses();
        const selected = Array.from(this.state.selectedFiles)
            .map(path => this.statuses.get(path))
            .filter((status): status is FileStatus => status !== undefined);
        const allSelected = visible.length > 0 && visible.every(status => this.state.selectedFiles.has(status.path));
        renderActionBar(container, {
            hasFiles: this.statuses.size > 0,
            allSelected,
            indeterminate: this.state.selectedFiles.size > 0 && !allSelected,
            canPush: selected.filter(status => ['modified', 'unsynced', 'moved'].includes(status.status)).length,
            canPull: selected.filter(status => ['modified', 'remote-only'].includes(status.status)).length,
            canDelete: selected.filter(status => status.status !== 'moved').length,
            treeViewEnabled: this.state.treeViewEnabled,
            showSynced: this.state.showSyncedInAll,
        }, {
            onRefresh: () => void this.controller.refresh(),
            onSelectAll: select => {
                for (const status of visible) {
                    if (select) this.state.select(status.path);
                    else this.state.deselect(status.path);
                }
                this.rerender();
            },
            onPush: () => void this.controller.push([...this.state.selectedFiles]),
            onPull: () => void this.controller.pull([...this.state.selectedFiles]),
            onDelete: () => void this.controller.delete([...this.state.selectedFiles]),
            onTreeViewChange: enabled => {
                this.state.setTreeViewEnabled(enabled);
                this.pruneSelection();
                this.rerender();
            },
            onShowSyncedChange: show => {
                this.state.setShowSyncedInAll(show);
                this.pruneSelection();
                this.rerender();
            },
        });
    }

    private renderFileList(container: HTMLElement): void {
        const statuses = this.visibleStatuses();
        if (statuses.length === 0) {
            const text = this.state.searchQuery !== ''
                ? t('syncStatus.noFilesForSearch', { query: this.state.searchQuery })
                : t('syncStatus.noFilesForFilter', {
                    filter: this.state.statusFilter === 'all' ? t('syncStatus.tab.all') : statusMeta(this.state.statusFilter).label,
                });
            container.createDiv({ cls: 'ssv-empty', text });
            return;
        }
        if (this.state.treeViewEnabled) this.renderTreeNodes(container, buildStatusTree(statuses).children);
        else this.renderFlatList(container, statuses);
    }

    private renderFlatList(container: HTMLElement, statuses: FileStatus[]): void {
        const groups = this.collapsibleMoveGroups(statuses);
        const groupedPaths = new Set<string>();
        for (const group of groups.values()) for (const member of group.members) groupedPaths.add(member.path);
        const callbacks = this.fileCallbacks();
        const renderedGroups = new Set<string>();
        for (const status of statuses) {
            if (groupedPaths.has(status.path)) this.renderGroupOnce(container, status, groups, renderedGroups);
            else renderFileItem(container, status, this.state.selectedFiles.has(status.path), callbacks);
        }
    }

    private renderTreeNodes(container: HTMLElement, nodes: StatusTreeNode[]): void {
        const fileCallbacks = this.fileCallbacks();
        const folderCallbacks = this.folderCallbacks();
        for (const node of nodes) {
            if (node.kind === 'file') {
                renderFileItem(container, node.status, this.state.selectedFiles.has(node.status.path), fileCallbacks);
                continue;
            }
            const children = renderFolderItem(
                container,
                node,
                this.state.selectedFiles,
                isTreeFolderExpanded(this.state.collapsedFolders, node.path),
                folderCallbacks,
            );
            if (children) this.renderTreeNodes(children, node.children);
        }
    }

    private renderGroupOnce(container: HTMLElement, status: FileStatus, groups: MoveGroups, rendered: Set<string>): void {
        const key = moveGroupKey(status);
        if (key === null || rendered.has(key)) return;
        rendered.add(key);
        const group = groups.get(key);
        if (!group) return;
        renderMoveGroupItem(
            container,
            key,
            group.oldPrefix,
            group.newPrefix,
            group.members,
            group.members.every(member => this.state.selectedFiles.has(member.path)),
            isMoveGroupExpanded(this.state.expandedMoveGroups, key),
            this.moveGroupCallbacks(),
        );
    }

    fileCallbacks(): FileItemCallbacks {
        return {
            onSelect: (path, selected) => {
                if (selected) this.state.select(path);
                else this.state.deselect(path);
                this.rerender();
            },
            onPush: status => void this.controller.pushOne(status),
            onPull: status => void this.controller.pullOne(status),
            onDelete: status => void this.controller.deleteLocal(status),
            onExpandDiff: status => this.controller.loadDiff(status.path),
            onOpen: (status, newLeaf) => this.controller.openFile(status, newLeaf),
            canOpen: status => this.controller.canOpen(status),
            onOpenDiffPane: status => void this.controller.openDiff(status.path),
            onRevertMove: status => void this.controller.revertMove(status),
        };
    }

    private folderCallbacks(): FolderTreeItemCallbacks {
        return {
            onSelect: (paths, selected) => {
                for (const path of paths) {
                    if (selected) this.state.select(path);
                    else this.state.deselect(path);
                }
                this.rerender();
            },
            onToggle: path => {
                this.state.toggleCollapsedFolder(path);
                this.rerender();
            },
        };
    }

    private moveGroupCallbacks(): MoveGroupCallbacks {
        return {
            onSelect: (members, selected) => {
                for (const member of members) {
                    if (selected) this.state.select(member.path);
                    else this.state.deselect(member.path);
                }
                this.rerender();
            },
            onPush: members => void this.controller.pushMoveGroup(members),
            onRevertMove: members => void this.controller.revertMoveGroup(members),
            onToggleExpand: key => {
                this.state.toggleExpandedMoveGroup(key);
                this.rerender();
            },
        };
    }
}
