import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import { ICONS } from '../components/icons';
import { renderChangeTree, renderChangeList, type ChangeTreeCallbacks } from './ChangeTree';

/** Tree shaping so the change tree stays a compact change view, not a full Explorer. */
const TREE_OPTIONS = { collapseSingleChild: true };
/** Mobile tree: collapse single-child folders and cap depth so the tree stays flat on a phone. */
const MOBILE_TREE_OPTIONS = { collapseSingleChild: true, maxDepth: 2 };

export interface RepositoryChangesSectionState {
    /** Rows not currently in the Sync Queue (the queue and this tree stay disjoint). */
    items: readonly SourceControlItem[];
    collapsed: boolean;
    viewMode: 'tree' | 'list';
    collapsedFolders: Set<string>;
    isMobile: boolean;
}

export interface RepositoryChangesSectionCallbacks {
    onToggleCollapsed: () => void;
    onSetViewMode: (mode: 'tree' | 'list') => void;
}

/**
 * Renders the "Repository Changes (N)" region: a collapsible header with a
 * Tree/List view toggle, above the change tree/list itself. A single role
 * label (not the active filter name — the filter chips above already carry
 * that) makes the section's job — "navigate the source I can pick from" —
 * distinct from the Sync Queue's "what I'm about to push".
 *
 * Pure presentation: receives only state and callbacks, never `SyncWorkspace`,
 * `SourceControlActionService`, or `SourceControlViewModel` directly.
 */
export function renderRepositoryChangesSection(
    container: HTMLElement,
    state: RepositoryChangesSectionState,
    treeCallbacks: ChangeTreeCallbacks,
    sectionCallbacks: RepositoryChangesSectionCallbacks,
): void {
    renderRepositoryHeader(container, state, sectionCallbacks);
    if (state.collapsed) return;

    const treeWrap = container.createDiv({ cls: 'scv-changes-tree' });
    if (state.items.length === 0) {
        treeWrap.createDiv({ cls: 'scv-empty', text: t('sourceControl.empty') });
    } else if (state.viewMode === 'list') {
        renderChangeList(treeWrap, state.items, treeCallbacks);
    } else {
        renderChangeTree(treeWrap, state.items, state.collapsedFolders, treeCallbacks, state.isMobile ? MOBILE_TREE_OPTIONS : TREE_OPTIONS);
    }
}

/**
 * The header collapses/expands the region; the Tree/List view toggle on the
 * right stops propagation so switching presentation doesn't also collapse
 * the section.
 */
function renderRepositoryHeader(
    container: HTMLElement,
    state: RepositoryChangesSectionState,
    callbacks: RepositoryChangesSectionCallbacks,
): void {
    const header = container.createDiv({ cls: 'scv-repository-header scv-collapsible-header' });
    header.setAttr('role', 'button');
    header.setAttr('aria-expanded', String(!state.collapsed));
    header.createSpan({ cls: 'scv-section-toggle', text: state.collapsed ? '▶' : '▼' });
    header.createSpan({ cls: 'scv-repository-title', text: t('sourceControl.section.repositoryChanges') });
    header.createSpan({ cls: 'scv-repository-count', text: String(state.items.length) });
    header.addEventListener('click', () => callbacks.onToggleCollapsed());
    renderViewToggle(header, state, callbacks);
}

/**
 * Tree/List segmented toggle, scoped to the Repository Changes region only
 * (the Sync Queue is always a flat list, so it gets no such toggle). The
 * active mode is highlighted; clicks stop propagation so they don't also
 * collapse the section via the title area.
 */
function renderViewToggle(
    container: HTMLElement,
    state: RepositoryChangesSectionState,
    callbacks: RepositoryChangesSectionCallbacks,
): void {
    const toggle = container.createDiv({ cls: 'scv-view-toggle' });
    toggle.setAttr('role', 'group');
    toggle.setAttr('aria-label', t('sourceControl.view.toggleLabel'));
    for (const mode of ['tree', 'list'] as const) {
        const active = state.viewMode === mode;
        const btn = toggle.createEl('button', { cls: `scv-view-toggle-btn${active ? ' is-active' : ''}` });
        btn.setAttr('data-view', mode);
        btn.setAttr('aria-pressed', String(active));
        btn.setAttr('title', mode === 'tree' ? t('sourceControl.view.tree') : t('sourceControl.view.list'));
        setIcon(btn.createSpan({ cls: 'scv-view-toggle-icon' }), mode === 'tree' ? ICONS.viewTree : ICONS.viewList);
        btn.createSpan({ cls: 'scv-view-toggle-label', text: mode === 'tree' ? t('sourceControl.view.tree') : t('sourceControl.view.list') });
        btn.addEventListener('click', (evt) => { evt.stopPropagation(); callbacks.onSetViewMode(mode); });
    }
}
