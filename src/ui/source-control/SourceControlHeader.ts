import { t } from '../../i18n';
import { renderPushButton } from './PushButton';

export interface SourceControlHeaderProps {
    readyToPushCount: number;
}

export interface SourceControlHeaderCallbacks {
    onPush: () => void;
}

/** Renders the Source Control view title and its Push button. */
export function renderSourceControlHeader(
    container: HTMLElement,
    props: SourceControlHeaderProps,
    callbacks: SourceControlHeaderCallbacks,
): void {
    const header = container.createDiv({ cls: 'scv-header' });
    header.createSpan({ cls: 'scv-header-title', text: t('sourceControl.viewTitle') });
    renderPushButton(header, props.readyToPushCount, callbacks.onPush);
}
