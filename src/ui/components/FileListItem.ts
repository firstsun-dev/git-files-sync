import { setIcon, setTooltip } from 'obsidian';
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
     * Called the first time a modified file's diff is expanded and its remote
     * content hasn't been fetched yet. Must fetch the content, mutate the
     * fileStatus object in place (remoteContent, localContent as needed), and
     * resolve once it's ready to render.
     */
    onExpandDiff: (fileStatus: FileStatus) => Promise<void>;
}

// `icon` is a Lucide icon id (rendered via Obsidian's setIcon) so every status
// uses the same icon set and renders consistently across platforms.
export function statusMeta(status: FileStatus['status']) {
    switch (status) {
        case 'synced':      return { icon: ICONS.synced,   label: t('syncStatus.tab.synced'),      iconCls: 'ssv-icon-synced',   badgeCls: 'ssv-badge-synced',   fileCls: 'status-synced' };
        case 'modified':    return { icon: ICONS.modified, label: t('syncStatus.tab.modified'),    iconCls: 'ssv-icon-modified', badgeCls: 'ssv-badge-modified', fileCls: 'status-modified' };
        case 'unsynced':    return { icon: ICONS.push,     label: t('syncStatus.tab.unsynced'),    iconCls: 'ssv-icon-unsynced', badgeCls: 'ssv-badge-unsynced', fileCls: 'status-unsynced' };
        case 'remote-only': return { icon: ICONS.pull,     label: t('syncStatus.tab.remote-only'), iconCls: 'ssv-icon-remote',   badgeCls: 'ssv-badge-remote',   fileCls: 'status-remote' };
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
    row.createSpan({ cls: 'ssv-file-path', text: fileStatus.path });
    row.createSpan({ cls: `ssv-status-badge ${badgeCls}`, text: label });

    if (fileStatus.status !== 'synced' && fileStatus.status !== 'checking') {
        renderFileActions(fileEl, fileStatus, callbacks);
    }
}

function renderFileActions(fileEl: HTMLElement, fileStatus: FileStatus, callbacks: FileItemCallbacks): void {
    const actions = fileEl.createDiv({ cls: 'ssv-file-actions' });

    if (fileStatus.status === 'modified') {
        renderDiffToggleButton(actions, fileEl, fileStatus, callbacks);
    }

    if (fileStatus.status === 'modified' || fileStatus.status === 'unsynced') {
        renderActionBtn(actions, ICONS.push, t('fileListItem.action.push'), t('fileListItem.tooltip.pushToRemote'), () => callbacks.onPush(fileStatus), 'push');
    }

    if (fileStatus.status === 'modified' || fileStatus.status === 'remote-only') {
        renderActionBtn(actions, ICONS.pull, t('fileListItem.action.pull'), t('fileListItem.tooltip.pullFromRemote'), () => callbacks.onPull(fileStatus), 'pull');
    }

    if (fileStatus.status === 'unsynced') {
        renderActionBtn(actions, ICONS.delete, t('fileListItem.action.remove'), t('fileListItem.tooltip.deleteLocalFile'), () => callbacks.onDelete(fileStatus), 'danger');
    }
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
