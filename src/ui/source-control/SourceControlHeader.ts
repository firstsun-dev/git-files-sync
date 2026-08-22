import { Platform, setIcon } from 'obsidian';
import { t } from '../../i18n';
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
}

export interface SourceControlHeaderCallbacks {
    onPush: () => void;
}

/**
 * Renders the Sync status view's connection/branch/last-sync info and Push
 * button. No title here -- Obsidian's own tab header already shows "Sync
 * status" (SourceControlItemView.getDisplayText), so repeating it in-panel
 * duplicated the label, most visibly on mobile's stacked tab layout.
 */
export function renderSourceControlHeader(
    container: HTMLElement,
    props: SourceControlHeaderProps,
    callbacks: SourceControlHeaderCallbacks,
): void {
    const header = container.createDiv({ cls: 'scv-header' });
    const titleRow = header.createDiv({ cls: 'scv-header-title-row' });
    renderPushButton(titleRow, props.readyToPushCount, callbacks.onPush);

    renderInfoStrip(header, props.workspaceInfo);
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
