import { setTooltip } from 'obsidian';
import { t } from '../../i18n';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import { renderChangeItem } from './ChangeItem';
import type { ChangeTreeCallbacks } from './ChangeTree';

export interface SyncQueueSectionState {
    syncQueue: readonly SourceControlItem[];
    /** Desktop: the "Sync Queue" section's own collapse state. Mobile uses {@link mobileCollapsed} instead. */
    collapsed: boolean;
    /** Mobile-only: the queue starts expanded by default, collapsed by tapping its header. */
    mobileCollapsed: boolean;
    isMobile: boolean;
}

export interface SyncQueueSectionCallbacks {
    /** Toggles the section's collapse state — desktop `collapsedSections`, mobile `mobileQueueCollapsed`. */
    onToggleCollapsed: () => void;
    /** Unselects every queued change in one shot. */
    onClearSelection: (items: readonly SourceControlItem[]) => void;
}

/**
 * Renders the "SYNC QUEUE" region — the working push batch, a flat list of
 * the changes selected for sync. Each queued change is a normal change row
 * (badge + name + diff-stat) with its selection checkbox checked: unchecking
 * it here moves the row back down into the repository tree, and checking a
 * repository row moves it up here, so the queue and the tree stay disjoint.
 *
 * On mobile the queue renders expanded by default (same as desktop) so the
 * upcoming changes are directly visible without an extra tap; the repository
 * tree's own scroll region absorbs the height. Tapping the header collapses
 * it to a header bar (the bottom sync bar still carries the count).
 *
 * Pure presentation: receives only state and callbacks, never `SyncWorkspace`,
 * `SourceControlActionService`, or `SourceControlViewModel` directly.
 */
export function renderSyncQueueSection(
    container: HTMLElement,
    state: SyncQueueSectionState,
    treeCallbacks: ChangeTreeCallbacks,
    sectionCallbacks: SyncQueueSectionCallbacks,
): void {
    const { syncQueue } = state;
    if (syncQueue.length === 0) return;
    const collapsed = state.isMobile ? state.mobileCollapsed : state.collapsed;
    const section = container.createDiv({ cls: 'scv-selected-section' });
    const header = section.createDiv({ cls: 'scv-selected-section-header scv-collapsible-header' });
    header.setAttr('role', 'button');
    header.setAttr('aria-expanded', String(!collapsed));
    header.createSpan({ cls: 'scv-section-toggle', text: collapsed ? '▶' : '▼' });
    header.createSpan({ cls: 'scv-selected-section-title', text: t('sourceControl.section.selectedForSync') });

    const clearBtn = header.createEl('button', {
        cls: 'scv-selected-section-clear',
        attr: { type: 'button' },
    });
    clearBtn.createSpan({ cls: 'scv-selected-section-clear-label', text: t('sourceControl.section.clearSelection') });
    setTooltip(clearBtn, t('sourceControl.section.clearSelection.tooltip'));
    clearBtn.addEventListener('click', (evt) => { evt.stopPropagation(); sectionCallbacks.onClearSelection(syncQueue); });
    header.addEventListener('click', () => sectionCallbacks.onToggleCollapsed());

    if (collapsed) return;
    section.createDiv({
        cls: 'scv-selected-section-subtitle',
        text: t('sourceControl.section.queueSubtitle', { count: syncQueue.length }),
    });
    const list = section.createDiv({ cls: 'scv-selected-section-list' });
    // Group the queue by its resolved sync action (the default, unless the
    // user overrode it) so a mixed batch reads as what the Sync button will
    // actually do (Upload / Download / Delete) rather than a flat list of
    // ambiguous badges. Only surface group labels when more than one action
    // is present in the batch — a single-action queue stays flat (no label
    // noise) and matches the pre-categorization layout.
    const upload = syncQueue.filter(item => item.syncAction === 'push');
    const download = syncQueue.filter(item => item.syncAction === 'pull');
    const deleteRemote = syncQueue.filter(item => item.syncAction === 'delete-remote');
    const groupCount = [upload, download, deleteRemote].filter(group => group.length > 0).length;
    const mixed = groupCount > 1;
    if (mixed && upload.length > 0) list.createDiv({ cls: 'scv-queue-group-label', text: t('sourceControl.queue.upload') });
    for (const item of upload) renderChangeItem(list, item, basename(item.path), treeCallbacks, { showActionControl: true });
    if (mixed && download.length > 0) list.createDiv({ cls: 'scv-queue-group-label', text: t('sourceControl.queue.download') });
    for (const item of download) renderChangeItem(list, item, basename(item.path), treeCallbacks, { showActionControl: true });
    if (mixed && deleteRemote.length > 0) list.createDiv({ cls: 'scv-queue-group-label', text: t('sourceControl.queue.delete') });
    for (const item of deleteRemote) renderChangeItem(list, item, basename(item.path), treeCallbacks, { showActionControl: true });
}

/** Last path segment of a change path, for the Sync Queue's flat row labels. */
function basename(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? path : path.slice(slash + 1);
}
