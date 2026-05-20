import { setTooltip } from 'obsidian';
import { type FileStatus } from '../types';
import { renderDiffPanel } from './DiffPanel';

export interface FileItemCallbacks {
    onSelect: (path: string, selected: boolean) => void;
    onPush:   (fileStatus: FileStatus) => void;
    onPull:   (fileStatus: FileStatus) => void;
    onDelete: (fileStatus: FileStatus) => void;
}

export function statusMeta(status: FileStatus['status']) {
    switch (status) {
        case 'synced':      return { icon: '✓', label: 'Synced',     iconCls: 'ssv-icon-synced',   badgeCls: 'ssv-badge-synced',   fileCls: 'status-synced' };
        case 'modified':    return { icon: '⚠', label: 'Changed',    iconCls: 'ssv-icon-modified', badgeCls: 'ssv-badge-modified', fileCls: 'status-modified' };
        case 'unsynced':    return { icon: '↑', label: 'Local only', iconCls: 'ssv-icon-unsynced', badgeCls: 'ssv-badge-unsynced', fileCls: 'status-unsynced' };
        case 'remote-only': return { icon: '↓', label: 'Remote',     iconCls: 'ssv-icon-remote',   badgeCls: 'ssv-badge-remote',   fileCls: 'status-remote' };
        default:            return { icon: '⟳', label: 'Checking',   iconCls: 'ssv-icon-checking', badgeCls: 'ssv-badge-checking', fileCls: 'status-checking' };
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

    row.createSpan({ cls: `ssv-file-icon ${iconCls}`, text: icon });
    row.createSpan({ cls: 'ssv-file-path', text: fileStatus.path });
    row.createSpan({ cls: `ssv-status-badge ${badgeCls}`, text: label });

    if (fileStatus.status !== 'synced' && fileStatus.status !== 'checking') {
        renderFileActions(fileEl, fileStatus, callbacks);
    }
}

function renderFileActions(fileEl: HTMLElement, fileStatus: FileStatus, callbacks: FileItemCallbacks): void {
    const actions = fileEl.createDiv({ cls: 'ssv-file-actions' });

    if (fileStatus.status === 'modified' && fileStatus.diff) {
        renderDiffToggleButton(actions, fileEl, fileStatus);
    }

    if ((fileStatus.status === 'modified' || fileStatus.status === 'unsynced') && fileStatus.file) {
        renderActionBtn(actions, '↑', ' Push', 'Push to remote', () => callbacks.onPush(fileStatus), 'push');
    }

    if (fileStatus.status === 'modified' || fileStatus.status === 'remote-only') {
        renderActionBtn(actions, '↓', ' Pull', 'Pull from remote', () => callbacks.onPull(fileStatus), 'pull');
    }

    if (fileStatus.status === 'unsynced' && fileStatus.file) {
        renderActionBtn(actions, '✕', ' Remove', 'Delete local file', () => callbacks.onDelete(fileStatus), 'danger');
    }
}

function renderDiffToggleButton(actions: HTMLElement, fileEl: HTMLElement, fileStatus: FileStatus): void {
    const diffBtn = actions.createEl('button', { cls: 'ssv-action-btn diff' });
    diffBtn.createSpan({ text: '≡' });
    const btnLabel = diffBtn.createSpan({ cls: 'ssv-btn-label', text: ' Diff' });
    const diffEl = renderDiffPanel(fileEl, fileStatus.remoteContent ?? '', fileStatus.localContent ?? '');
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

function renderActionBtn(actions: HTMLElement, icon: string, label: string, tooltip: string, onClick: () => void, cls: string): void {
    const btn = actions.createEl('button', { cls: `ssv-action-btn ${cls}` });
    btn.createSpan({ text: icon });
    btn.createSpan({ cls: 'ssv-btn-label', text: label });
    setTooltip(btn, tooltip);
    btn.addEventListener('click', onClick);
}
