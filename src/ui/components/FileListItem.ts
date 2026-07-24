import { Keymap, Platform, setIcon, setTooltip } from 'obsidian';
import { type FileStatus } from '../types';
import { renderDiffPanel } from './DiffPanel';
import { ICONS } from './icons';
import { t } from '../../i18n';

export interface FileItemCallbacks {
    onSelect: (path: string, selected: boolean) => void;
    onPush:   (fileStatus: FileStatus) => void;
    onPull:   (fileStatus: FileStatus) => void;
    onDelete: (fileStatus: FileStatus) => void;
    /**
     * Opens the file where it actually lives — in the vault when there's a
     * local copy, otherwise on the provider's site in a browser. Returns false
     * when neither is possible (a hidden path Obsidian can't open, or provider
     * settings that don't identify a web URL), in which case the path renders
     * as plain text rather than a link that goes nowhere.
     */
    onOpen: (fileStatus: FileStatus, newLeaf: boolean) => boolean;
    /** Whether onOpen would succeed, so the path can be rendered accordingly. */
    canOpen: (fileStatus: FileStatus) => boolean;
    /**
     * Called the first time a modified file's diff is expanded and its remote
     * content hasn't been fetched yet. Must fetch the content, mutate the
     * fileStatus object in place (remoteContent, localContent as needed), and
     * resolve once it's ready to render.
     */
    onExpandDiff: (fileStatus: FileStatus) => Promise<void>;
    /**
     * Desktop only: shows the diff in its own workspace pane instead of inline.
     * The inline panel is stuck at sidebar width, where the side-by-side view
     * can't fit; a pane gives it room. Mobile keeps the inline panel.
     */
    onOpenDiffPane: (fileStatus: FileStatus) => void;
    /** Undoes a pending move: moves the local file back to fileStatus.movedFrom. */
    onRevertMove: (fileStatus: FileStatus) => void;
}

// `icon` is a Lucide icon id (rendered via Obsidian's setIcon) so every status
// uses the same icon set and renders consistently across platforms.
export function statusMeta(status: FileStatus['status']) {
    switch (status) {
        case 'synced':      return { icon: ICONS.synced,   label: t('syncStatus.tab.synced'),      iconCls: 'ssv-icon-synced',   badgeCls: 'ssv-badge-synced',   fileCls: 'status-synced' };
        case 'modified':    return { icon: ICONS.modified, label: t('syncStatus.tab.modified'),    iconCls: 'ssv-icon-modified', badgeCls: 'ssv-badge-modified', fileCls: 'status-modified' };
        case 'unsynced':    return { icon: ICONS.push,     label: t('syncStatus.tab.unsynced'),    iconCls: 'ssv-icon-unsynced', badgeCls: 'ssv-badge-unsynced', fileCls: 'status-unsynced' };
        case 'remote-only': return { icon: ICONS.pull,     label: t('syncStatus.tab.remote-only'), iconCls: 'ssv-icon-remote',   badgeCls: 'ssv-badge-remote',   fileCls: 'status-remote' };
        case 'moved':       return { icon: ICONS.moved,    label: t('syncStatus.tab.moved'),       iconCls: 'ssv-icon-moved',    badgeCls: 'ssv-badge-moved',    fileCls: 'status-moved' };
        default:            return { icon: ICONS.checking, label: t('syncStatus.status.checking'), iconCls: 'ssv-icon-checking', badgeCls: 'ssv-badge-checking', fileCls: 'status-checking' };
    }
}

export function renderFileItem(
    container: HTMLElement,
    fileStatus: FileStatus,
    isSelected: boolean,
    callbacks: FileItemCallbacks
): void {
    const { icon, label, iconCls, badgeCls, fileCls } = statusMeta(fileStatus.status);
    const fileEl = container.createDiv({ cls: `ssv-file ${fileCls}` });
    const row = fileEl.createDiv({ cls: 'ssv-file-row' });

    const cb = row.createEl('input', { type: 'checkbox', cls: 'ssv-file-checkbox' });
    cb.checked = isSelected;
    cb.addEventListener('change', () => callbacks.onSelect(fileStatus.path, cb.checked));

    setIcon(row.createSpan({ cls: `ssv-file-icon ${iconCls}` }), icon);
    renderFilePath(row, fileStatus, callbacks);
    row.createSpan({ cls: `ssv-status-badge ${badgeCls}`, text: label });

    if (fileStatus.status === 'moved' && fileStatus.movedFrom) {
        fileEl.createDiv({ cls: 'ssv-moved-from', text: fileStatus.movedFrom });
    }

    if (fileStatus.status !== 'synced' && fileStatus.status !== 'checking') {
        renderFileActions(fileEl, fileStatus, callbacks);
    }
}

/**
 * The path opens the file; the rest of the row is left alone. Rows the caller
 * can't open stay plain text so there's never a link that does nothing —
 * `remote-only` rows are exactly the ones users are most curious about, so a
 * dead link there would be worse than none.
 */
function renderFilePath(row: HTMLElement, fileStatus: FileStatus, callbacks: FileItemCallbacks): void {
    if (!callbacks.canOpen(fileStatus)) {
        row.createSpan({ cls: 'ssv-file-path', text: fileStatus.path });
        return;
    }

    const pathEl = row.createSpan({ cls: 'ssv-file-path ssv-file-path-link', text: fileStatus.path });
    pathEl.setAttr('role', 'link');
    pathEl.setAttr('tabindex', '0');
    setTooltip(pathEl, fileStatus.status === 'remote-only'
        ? t('fileListItem.tooltip.openRemote')
        : t('fileListItem.tooltip.openFile'));

    pathEl.addEventListener('click', (evt) => {
        evt.preventDefault();
        // Obsidian's convention: a modifier opens in a new tab or split.
        callbacks.onOpen(fileStatus, Keymap.isModEvent(evt) !== false);
    });
    pathEl.addEventListener('keydown', (evt) => {
        if (evt.key !== 'Enter' && evt.key !== ' ') return;
        evt.preventDefault();
        callbacks.onOpen(fileStatus, false);
    });
}

function renderFileActions(fileEl: HTMLElement, fileStatus: FileStatus, callbacks: FileItemCallbacks): void {
    const actions = fileEl.createDiv({ cls: 'ssv-file-actions' });

    if (fileStatus.status === 'modified') {
        // One entry point per platform, never both: two buttons rendering the
        // same diff differently just invites "what's the difference?".
        if (Platform.isMobile) renderDiffToggleButton(actions, fileEl, fileStatus, callbacks);
        else renderDiffPaneButton(actions, fileStatus, callbacks);
    }

    if (fileStatus.status === 'modified' || fileStatus.status === 'unsynced' || fileStatus.status === 'moved') {
        renderActionBtn(actions, ICONS.push, t('fileListItem.action.push'), t('fileListItem.tooltip.pushToRemote'), () => callbacks.onPush(fileStatus), 'push');
    }

    if (fileStatus.status === 'modified' || fileStatus.status === 'remote-only') {
        renderActionBtn(actions, ICONS.pull, t('fileListItem.action.pull'), t('fileListItem.tooltip.pullFromRemote'), () => callbacks.onPull(fileStatus), 'pull');
    }

    if (fileStatus.status === 'unsynced') {
        renderActionBtn(actions, ICONS.delete, t('fileListItem.action.remove'), t('fileListItem.tooltip.deleteLocalFile'), () => callbacks.onDelete(fileStatus), 'danger');
    }

    // Pull has no meaning on a moved row (it would silently undo the move);
    // revert is the explicit, confirmed equivalent.
    if (fileStatus.status === 'moved') {
        renderActionBtn(actions, ICONS.revert, t('fileListItem.action.revert'), t('fileListItem.tooltip.revertMove'), () => callbacks.onRevertMove(fileStatus), 'danger');
    }
}

function renderDiffPaneButton(actions: HTMLElement, fileStatus: FileStatus, callbacks: FileItemCallbacks): void {
    renderActionBtn(
        actions, ICONS.diff, t('fileListItem.action.diff'), t('fileListItem.tooltip.openDiffPane'),
        () => callbacks.onOpenDiffPane(fileStatus), 'diff'
    );
}

function renderDiffToggleButton(actions: HTMLElement, fileEl: HTMLElement, fileStatus: FileStatus, callbacks: FileItemCallbacks): void {
    const diffBtn = actions.createEl('button', { cls: 'ssv-action-btn diff' });
    const iconEl = diffBtn.createSpan();
    setIcon(iconEl, ICONS.diff);
    const btnLabel = diffBtn.createSpan({ cls: 'ssv-btn-label', text: t('fileListItem.action.diff') });

    const diffEl = fileEl.createDiv({ cls: 'ssv-diff' });
    renderDiffBody(diffEl, fileStatus);

    setTooltip(diffBtn, t('fileListItem.tooltip.toggleDiff'));
    diffBtn.addEventListener('click', () => {
        const open = diffEl.hasClass('visible');
        if (!open && needsContentFetch(fileStatus)) {
            diffEl.empty();
            diffEl.createDiv({ cls: 'ssv-diff-loading', text: t('fileListItem.diff.loading') });
            void callbacks.onExpandDiff(fileStatus).then(() => renderDiffBody(diffEl, fileStatus));
        }
        diffEl.toggleClass('visible', !open);
        btnLabel.setText(open ? t('fileListItem.action.diff') : t('fileListItem.action.hide'));
        setIcon(iconEl, open ? ICONS.diff : ICONS.diffOpen);
    });
}

function needsContentFetch(fileStatus: FileStatus): boolean {
    return !fileStatus.isSymlink && fileStatus.remoteContent === undefined;
}

function renderDiffBody(diffEl: HTMLElement, fileStatus: FileStatus): void {
    diffEl.empty();
    if (fileStatus.isSymlink) {
        diffEl.createDiv({ cls: 'ssv-diff-binary', text: t('fileListItem.diff.symlinkChanged') });
    } else if (typeof fileStatus.remoteContent === 'string' && typeof fileStatus.localContent === 'string') {
        renderDiffPanel(diffEl, fileStatus.remoteContent, fileStatus.localContent);
    } else if (fileStatus.remoteContent === undefined) {
        diffEl.createDiv({ cls: 'ssv-diff-loading', text: t('fileListItem.diff.clickToLoad') });
    } else {
        diffEl.createDiv({ cls: 'ssv-diff-binary', text: t('fileListItem.diff.binaryChanged') });
    }
}

function renderActionBtn(actions: HTMLElement, icon: string, label: string, tooltip: string, onClick: () => void, cls: string): void {
    const btn = actions.createEl('button', { cls: `ssv-action-btn ${cls}` });
    setIcon(btn.createSpan(), icon);
    btn.createSpan({ cls: 'ssv-btn-label', text: label });
    setTooltip(btn, tooltip);
    btn.addEventListener('click', onClick);
}
