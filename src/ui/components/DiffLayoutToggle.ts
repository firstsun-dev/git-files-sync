import { setIcon, setTooltip } from 'obsidian';
import { t } from '../../i18n';
import { ICONS } from './icons';

export type DiffLayout = 'split' | 'unified';

/**
 * Renders the split/unified diff layout toggle shared by every diff surface
 * (mobile detail, desktop diff tab, conflict modal). Always shows a text
 * label alongside the icon -- an icon-only button risks rendering as a blank
 * square if the icon id isn't in the host's bundled icon set, and this
 * control needs to be unmistakable regardless of that.
 */
export function renderDiffLayoutToggle(
    container: HTMLElement,
    layout: DiffLayout,
    onToggle: (next: DiffLayout) => void,
): HTMLButtonElement {
    const btn = container.createEl('button', { cls: 'scv-diff-layout-toggle' });
    const switchingTo: DiffLayout = layout === 'split' ? 'unified' : 'split';

    setIcon(btn.createSpan({ cls: 'scv-diff-layout-toggle-icon' }), switchingTo === 'split' ? ICONS.diffSplit : ICONS.diffUnified);
    btn.createSpan({
        cls: 'scv-diff-layout-toggle-label',
        text: switchingTo === 'split' ? t('sourceControl.diff.split') : t('sourceControl.diff.unified'),
    });
    setTooltip(btn, switchingTo === 'split'
        ? t('sourceControl.diff.switchToSplit')
        : t('sourceControl.diff.switchToUnified'));

    btn.addEventListener('click', () => onToggle(switchingTo));
    return btn;
}
