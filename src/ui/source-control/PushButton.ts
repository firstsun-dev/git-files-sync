import { setIcon, setTooltip } from 'obsidian';
import { ICONS } from '../components/icons';
import { t } from '../../i18n';

/** Renders the "Push (N)" button; disabled when there's nothing selected for push. */
export function renderPushButton(container: HTMLElement, readyToPushCount: number, onPush: () => void): HTMLButtonElement {
    const btn = container.createEl('button', { cls: 'scv-push-btn' });
    setIcon(btn.createSpan(), ICONS.push);
    btn.createSpan({ cls: 'scv-push-btn-label', text: t('sourceControl.push', { count: readyToPushCount }) });
    btn.disabled = readyToPushCount === 0;
    setTooltip(btn, t('sourceControl.push.tooltip', { count: readyToPushCount }));
    btn.addEventListener('click', onPush);
    return btn;
}
