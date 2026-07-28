import { setIcon, setTooltip } from 'obsidian';
import { ICONS } from './icons';
import { t } from '../../i18n';

export interface ActionBarProps {
    hasFiles:     boolean;
    allSelected:  boolean;
    indeterminate: boolean;
    canPush:      number;
    canPull:      number;
    canDelete:    number;
    treeViewEnabled: boolean;
    showSynced:   boolean;
}

export interface ActionBarCallbacks {
    onRefresh:   () => void;
    onSelectAll: (select: boolean) => void;
    onPush:      () => void;
    onPull:      () => void;
    onDelete:    () => void;
    onTreeViewChange: (enabled: boolean) => void;
    onShowSyncedChange: (show: boolean) => void;
}

export function renderActionBar(container: HTMLElement, props: ActionBarProps, callbacks: ActionBarCallbacks): void {
    const bar = container.createDiv({ cls: 'ssv-action-bar' });
    const actions = bar.createDiv({ cls: 'ssv-action-bar-row' });
    renderRefreshButton(actions, callbacks.onRefresh);

    if (props.hasFiles) {
        actions.createDiv({ cls: 'ssv-bar-spacer' });
        renderSelectAllRow(actions, props.allSelected, props.indeterminate, callbacks.onSelectAll);
        renderLargeButton(actions, ICONS.push,   t('actionBar.pushCount', { count: props.canPush }),     t('actionBar.pushFiles', { count: props.canPush }),     callbacks.onPush,   'push',   props.canPush === 0);
        renderLargeButton(actions, ICONS.pull,   t('actionBar.pullCount', { count: props.canPull }),     t('actionBar.pullFiles', { count: props.canPull }),     callbacks.onPull,   'pull',   props.canPull === 0);
        renderLargeButton(actions, ICONS.delete, t('actionBar.deleteCount', { count: props.canDelete }), t('actionBar.deleteFiles', { count: props.canDelete }), callbacks.onDelete, 'danger', props.canDelete === 0);
    }

    renderTreeOptions(bar, props, callbacks);
}

function renderTreeOptions(bar: HTMLElement, props: ActionBarProps, callbacks: ActionBarCallbacks): void {
    const options = bar.createDiv({ cls: 'ssv-tree-options' });
    renderCheckboxOption(options, 'ssv-tree-view-toggle', t('syncStatus.treeView'), props.treeViewEnabled, callbacks.onTreeViewChange);
    if (props.treeViewEnabled) {
        renderCheckboxOption(options, 'ssv-show-synced-toggle', t('syncStatus.showSynced'), props.showSynced, callbacks.onShowSyncedChange);
    }
}

function renderCheckboxOption(container: HTMLElement, checkboxClass: string, labelText: string, checked: boolean, onChange: (checked: boolean) => void): void {
    const label = container.createEl('label', { cls: 'ssv-tree-option' });
    const checkbox = label.createEl('input', { type: 'checkbox', cls: checkboxClass });
    checkbox.checked = checked;
    label.createSpan({ text: labelText });
    checkbox.addEventListener('change', () => onChange(checkbox.checked));
}

function renderRefreshButton(bar: HTMLElement, onRefresh: () => void): void {
    const btn = bar.createEl('button', { cls: 'ssv-btn ssv-btn-refresh' });
    setIcon(btn.createSpan(), ICONS.refresh);
    btn.createSpan({ cls: 'ssv-btn-label', text: t('actionBar.refresh') });
    setTooltip(btn, t('actionBar.refreshAll'));
    btn.addEventListener('click', onRefresh);
}

function renderSelectAllRow(bar: HTMLElement, allSelected: boolean, indeterminate: boolean, onSelectAll: (select: boolean) => void): void {
    const selectRow = bar.createDiv({ cls: 'ssv-select-row' });
    const cb = selectRow.createEl('input', { type: 'checkbox' });
    cb.checked = allSelected;
    cb.indeterminate = indeterminate;
    selectRow.createSpan({ cls: 'ssv-select-label', text: t('actionBar.select') });
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
