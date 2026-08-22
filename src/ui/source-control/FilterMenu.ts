import { t, type TranslationKey } from '../../i18n';
import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';

/** Order and labels match the Phase 3 spec's Filter section exactly. */
const FILTER_ORDER: SourceControlFilter[] = ['all', 'changes', 'ready-to-push', 'remote-changes', 'conflicts', 'synced'];

const FILTER_LABEL_KEYS: Record<SourceControlFilter, TranslationKey> = {
    all:               'sourceControl.filter.all',
    changes:           'sourceControl.filter.changes',
    'ready-to-push':   'sourceControl.filter.readyToPush',
    'remote-changes':  'sourceControl.filter.remoteChanges',
    conflicts:         'sourceControl.filter.conflicts',
    synced:            'sourceControl.filter.synced',
};

/** Renders the six-way Source Control filter switch, with per-filter counts from the ViewModel. */
export function renderFilterMenu(
    container: HTMLElement,
    current: SourceControlFilter,
    counts: Record<SourceControlFilter, number>,
    onChange: (filter: SourceControlFilter) => void,
): void {
    const menu = container.createDiv({ cls: 'scv-filter-menu' });
    for (const value of FILTER_ORDER) {
        const isActive = value === current;
        const btn = menu.createEl('button', { cls: `scv-filter-option${isActive ? ' is-active' : ''}` });
        btn.setAttr('data-filter', value);
        btn.setAttr('aria-pressed', String(isActive));
        btn.createSpan({ cls: 'scv-filter-label', text: t(FILTER_LABEL_KEYS[value]) });
        btn.createSpan({ cls: 'scv-filter-count', text: String(counts[value] ?? 0) });
        btn.addEventListener('click', () => onChange(value));
    }
}
