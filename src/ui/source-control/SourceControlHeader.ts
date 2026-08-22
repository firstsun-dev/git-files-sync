import { Platform, setIcon, setTooltip } from 'obsidian';
import { t } from '../../i18n';
import type { RefreshStatus } from '../../logic/source-control/RefreshState';
import { ICONS } from '../components/icons';
import { renderPushButton } from './PushButton';

export interface SourceControlWorkspaceInfo {
    serviceName: string;
    branch: string;
    vaultFolder: string;
    /** Epoch ms of the most recent successful push/pull, or 0 if nothing has synced yet. */
    lastSyncTime: number;
}

export interface SourceControlHeaderProps {
    readyToPushCount: number;
    workspaceInfo: SourceControlWorkspaceInfo;
    refreshStatus: RefreshStatus;
}

export interface SourceControlHeaderCallbacks {
    onPush: () => void;
    onRefresh: () => void;
}

export interface SourceControlHeaderOptions {
    /** When false the in-header Sync button is omitted (e.g. mobile uses a bottom bar instead). */
    showPush?: boolean;
    /** Mobile layout flag, currently unused for branching but threaded for future header tweaks. */
    isMobile?: boolean;
}

/**
 * Renders the Sync status view's connection/branch/last-sync info, Sync
 * button, and Refresh button. No title here -- Obsidian's own tab header
 * already shows "Sync status" (SourceControlItemView.getDisplayText), so
 * repeating it in-panel duplicated the label, most visibly on mobile's
 * stacked tab layout.
 */
export function renderSourceControlHeader(
    container: HTMLElement,
    props: SourceControlHeaderProps,
    callbacks: SourceControlHeaderCallbacks,
    options: SourceControlHeaderOptions = {},
): void {
    const header = container.createDiv({ cls: 'scv-header' });
    const titleRow = header.createDiv({ cls: 'scv-header-title-row' });
    if (options.showPush !== false) renderPushButton(titleRow, props.readyToPushCount, callbacks.onPush);
    renderRefreshButton(titleRow, props.refreshStatus, callbacks.onRefresh);

    renderInfoStrip(header, props.workspaceInfo);
}

function renderRefreshButton(container: HTMLElement, status: RefreshStatus, onRefresh: () => void): void {
    const btn = container.createEl('button', { cls: `scv-refresh-btn is-${status}` });
    btn.setAttr('aria-label', t('sourceControl.refresh.tooltip'));
    setIcon(btn.createSpan({ cls: 'scv-refresh-btn-icon' }), ICONS.refresh);

    const label = btn.createSpan({ cls: 'scv-refresh-btn-label' });
    if (status === 'loading') {
        label.textContent = t('sourceControl.refresh.refreshing');
        btn.disabled = true;
    } else if (status === 'failed') {
        label.textContent = t('sourceControl.refresh.failed');
        setTooltip(btn, t('sourceControl.refresh.failed'));
    } else {
        label.textContent = '';
        setTooltip(btn, t('sourceControl.refresh.tooltip'));
    }

    // Show the label span only when there's text (loading/failed); idle stays icon-only.
    if (status === 'idle') label.addClass('is-hidden');

    btn.addEventListener('click', () => {
        if (status === 'loading') return;
        onRefresh();
    });
}

function renderInfoStrip(container: HTMLElement, info: SourceControlWorkspaceInfo): void {
    const strip = container.createDiv({ cls: 'scv-info' });

    strip.createSpan({ cls: 'scv-info-item', text: info.serviceName });

    if (!Platform.isMobile) {
        strip.createSpan({ cls: 'scv-info-sep', text: '·' });
        const branch = strip.createSpan({ cls: 'scv-info-item' });
        setIcon(branch.createSpan({ cls: 'scv-info-icon' }), ICONS.branch);
        branch.createSpan({ text: ` ${info.branch}` });
    }

    if (info.vaultFolder) {
        strip.createSpan({ cls: 'scv-info-sep', text: '·' });
        const folder = strip.createSpan({ cls: 'scv-info-item' });
        setIcon(folder.createSpan({ cls: 'scv-info-icon' }), ICONS.folder);
        folder.createSpan({ text: ` ${info.vaultFolder}` });
    }

    strip.createSpan({ cls: 'scv-info-sep', text: '·' });
    strip.createSpan({
        cls: 'scv-info-time',
        text: info.lastSyncTime > 0
            ? t('sourceControl.info.lastSync', { time: new Date(info.lastSyncTime).toLocaleTimeString() })
            : t('sourceControl.info.neverSynced'),
    });
}
