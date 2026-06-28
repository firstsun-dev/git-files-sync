import { setIcon, setTooltip } from 'obsidian';
import { ICONS } from './icons';

export interface ActionBarProps {
    hasFiles:     boolean;
    allSelected:  boolean;
    indeterminate: boolean;
    canPush:      number;
    canPull:      number;
    canDelete:    number;
}

export interface ActionBarCallbacks {
    onRefresh:   () => void;
    onSelectAll: (select: boolean) => void;
    onPush:      () => void;
    onPull:      () => void;
    onDelete:    () => void;
}

export function renderActionBar(container: HTMLElement, props: ActionBarProps, callbacks: ActionBarCallbacks): void {
    const bar = container.createDiv({ cls: 'ssv-action-bar' });
    renderRefreshButton(bar, callbacks.onRefresh);

    if (props.hasFiles) {
        bar.createDiv({ cls: 'ssv-bar-spacer' });
        renderSelectAllRow(bar, props.allSelected, props.indeterminate, callbacks.onSelectAll);
        renderLargeButton(bar, ICONS.push,   ` Push (${props.canPush})`,   `Push ${props.canPush} files`,   callbacks.onPush,   'push',   props.canPush === 0);
        renderLargeButton(bar, ICONS.pull,   ` Pull (${props.canPull})`,   `Pull ${props.canPull} files`,   callbacks.onPull,   'pull',   props.canPull === 0);
        renderLargeButton(bar, ICONS.delete, ` Delete (${props.canDelete})`, `Delete ${props.canDelete} files`, callbacks.onDelete, 'danger', props.canDelete === 0);
    }
}

function renderRefreshButton(bar: HTMLElement, onRefresh: () => void): void {
    const btn = bar.createEl('button', { cls: 'ssv-btn ssv-btn-refresh' });
    setIcon(btn.createSpan(), ICONS.refresh);
    btn.createSpan({ cls: 'ssv-btn-label', text: ' Refresh' });
    setTooltip(btn, 'Refresh all statuses');
    btn.addEventListener('click', onRefresh);
}

function renderSelectAllRow(bar: HTMLElement, allSelected: boolean, indeterminate: boolean, onSelectAll: (select: boolean) => void): void {
    const selectRow = bar.createDiv({ cls: 'ssv-select-row' });
    const cb = selectRow.createEl('input', { type: 'checkbox' });
    cb.checked = allSelected;
    cb.indeterminate = indeterminate;
    selectRow.createSpan({ cls: 'ssv-select-label', text: 'Select' });
    cb.addEventListener('change', () => onSelectAll(cb.checked));
}

function renderLargeButton(container: HTMLElement, icon: string, label: string, tooltip: string, onClick: () => void, cls: string, disabled: boolean): void {
    const btn = container.createEl('button', { cls: `ssv-btn ssv-btn-${cls}` });
    setIcon(btn.createSpan(), icon);
    btn.createSpan({ cls: 'ssv-btn-label', text: label });
    btn.disabled = disabled;
    setTooltip(btn, tooltip);
    btn.addEventListener('click', onClick);
}
