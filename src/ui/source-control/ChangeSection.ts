import type { SourceControlFilter } from '../../logic/source-control/SourceControlFilter';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import { renderChangeTree, type ChangeTreeCallbacks } from './ChangeTree';

export interface ChangeSectionProps {
    /** One of the section filters (not 'all' — the "All" filter renders every section). */
    id: Exclude<SourceControlFilter, 'all'>;
    title: string;
    items: readonly SourceControlItem[];
    collapsed: boolean;
    collapsedFolders: ReadonlySet<string>;
}

export interface ChangeSectionCallbacks extends ChangeTreeCallbacks {
    onToggleSection: (id: Exclude<SourceControlFilter, 'all'>) => void;
}

/** Renders one of the five Source Control sections: a collapsible header + its change tree. */
export function renderChangeSection(
    container: HTMLElement,
    props: ChangeSectionProps,
    callbacks: ChangeSectionCallbacks,
): HTMLElement {
    const sectionEl = container.createDiv({ cls: `scv-section scv-section-${props.id}` });
    const header = sectionEl.createDiv({ cls: 'scv-section-header' });

    const toggle = header.createEl('button', { cls: 'scv-section-toggle' });
    toggle.setAttr('aria-expanded', String(!props.collapsed));
    toggle.setText(props.collapsed ? '▶' : '▼');
    toggle.addEventListener('click', () => callbacks.onToggleSection(props.id));

    header.createSpan({ cls: 'scv-section-title', text: props.title });
    header.createSpan({ cls: 'scv-section-count', text: String(props.items.length) });

    if (!props.collapsed) {
        const body = sectionEl.createDiv({ cls: 'scv-section-body' });
        renderChangeTree(body, props.items, props.collapsedFolders, callbacks);
    }

    return sectionEl;
}
