import { setIcon } from 'obsidian';
import { ICONS } from '../components/icons';
import { renderOperationIndicator } from './OperationIndicator';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeId, SyncChangeKind } from '../../logic/source-control/types';

export interface ChangeItemCallbacks {
    onToggleSelect: (id: ChangeId, selected: boolean) => void;
    onOpenDiff: (item: SourceControlItem) => void;
}

interface KindBadge {
    letter: string;
    cls: string;
}

/**
 * Single-letter status badge per change kind, matching the VS Code style
 * tree example in the Phase 3 spec (`M daily.md`, `A idea.md`, `! settings.md`).
 */
const KIND_BADGE: Record<SyncChangeKind, KindBadge> = {
    'local-only':       { letter: 'A', cls: 'local-only' },
    'local-modified':   { letter: 'M', cls: 'local-modified' },
    'remote-only':      { letter: 'A', cls: 'remote-only' },
    'remote-modified':  { letter: 'M', cls: 'remote-modified' },
    moved:              { letter: 'R', cls: 'moved' },
    conflict:           { letter: '!', cls: 'conflict' },
    synced:             { letter: 'S', cls: 'synced' },
};

/** Renders a single change row: selection checkbox, status badge, name, operation indicator. */
export function renderChangeItem(
    container: HTMLElement,
    item: SourceControlItem,
    displayName: string,
    callbacks: ChangeItemCallbacks,
): HTMLElement {
    const row = container.createDiv({ cls: `scv-change-item scv-kind-${item.kind}` });
    row.setAttr('data-change-id', item.id);

    const checkbox = row.createEl('input', { type: 'checkbox', cls: 'scv-change-select' });
    checkbox.checked = item.isReadyToPush;
    checkbox.addEventListener('change', () => callbacks.onToggleSelect(item.id, checkbox.checked));

    const badge = KIND_BADGE[item.kind];
    row.createSpan({ cls: `scv-badge scv-badge-${badge.cls}`, text: badge.letter });

    const label = row.createDiv({ cls: 'scv-change-name' });
    if (item.previousPath) {
        const previousName = item.previousPath.split('/').pop() ?? item.previousPath;
        label.createSpan({ cls: 'scv-change-rename-from', text: previousName });
        setIcon(label.createSpan({ cls: 'scv-change-rename-arrow' }), ICONS.moved);
    }
    label.createSpan({ cls: 'scv-change-name-text', text: displayName });

    renderOperationIndicator(row, item.operationStatus);

    row.addEventListener('click', (evt) => {
        if (evt.target === checkbox) return;
        callbacks.onOpenDiff(item);
    });

    return row;
}
