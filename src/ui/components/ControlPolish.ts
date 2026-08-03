const STYLE_ATTRIBUTE = 'data-gfs-control-polish';

/**
 * Adds a view-scoped style layer for control sizing, spacing, hierarchy, and
 * touch targets. Keeping the element inside the view ties its lifetime to the
 * workspace leaf and avoids leaking overrides after the view is closed.
 */
export function ensureControlPolishStyles(container: HTMLElement): void {
    const scope = (container.closest('.sync-status-view') as HTMLElement | null) ?? container;
    if (scope.querySelector(`style[${STYLE_ATTRIBUTE}]`)) return;

    const style = document.createElement('style');
    style.setAttribute(STYLE_ATTRIBUTE, '');
    style.textContent = CONTROL_POLISH_CSS;
    scope.prepend(style);
}

const CONTROL_POLISH_CSS = `
.sync-status-view {
    --gfs-control-height: 32px;
    --gfs-control-gap: 6px;
    --gfs-section-gap: 8px;
    --gfs-control-radius: 6px;
    --gfs-touch-target: 44px;
}

.sync-status-view .ssv-search {
    gap: var(--gfs-control-gap);
    padding: 8px 10px;
}

.sync-status-view .ssv-search-input {
    height: var(--gfs-control-height);
    padding-inline: 8px;
    border-radius: var(--gfs-control-radius);
}

.sync-status-view .ssv-search-clear {
    width: var(--gfs-control-height);
    height: var(--gfs-control-height);
    border-radius: var(--gfs-control-radius);
}

.sync-status-view .ssv-tabs {
    gap: var(--gfs-control-gap);
    padding: 8px 10px;
}

.sync-status-view .ssv-tab {
    min-height: 30px;
    padding: 5px 10px;
    gap: var(--gfs-control-gap);
    border-radius: 999px;
}

.sync-status-view .ssv-action-bar {
    gap: var(--gfs-section-gap);
    padding: 8px 10px;
}

.sync-status-view .ssv-action-bar-row {
    gap: var(--gfs-control-gap);
}

.sync-status-view .ssv-btn {
    min-height: var(--gfs-control-height);
    padding: 5px 10px;
    gap: var(--gfs-control-gap);
    border-radius: var(--gfs-control-radius);
    line-height: 1.2;
    transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
}

.sync-status-view .ssv-btn:not(:disabled):hover {
    opacity: 1;
}

.sync-status-view .ssv-btn-refresh,
.sync-status-view .ssv-btn-pull {
    background: var(--background-secondary);
    border-color: var(--background-modifier-border);
    color: var(--text-normal);
}

.sync-status-view .ssv-btn-refresh:not(:disabled):hover,
.sync-status-view .ssv-btn-pull:not(:disabled):hover {
    background: var(--background-modifier-hover);
    border-color: var(--background-modifier-border-hover);
}

.sync-status-view .ssv-btn-push {
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
    color: var(--text-on-accent);
}

.sync-status-view .ssv-btn-delete {
    background: transparent;
    border-color: var(--text-error);
    color: var(--text-error);
}

.sync-status-view .ssv-btn-delete:not(:disabled):hover {
    background: var(--background-modifier-hover);
}

.sync-status-view .ssv-select-row {
    min-height: var(--gfs-control-height);
    padding-inline: 4px 6px;
    gap: var(--gfs-control-gap);
}

.sync-status-view .ssv-tree-options {
    min-height: 28px;
    gap: 16px;
    padding-left: 2px;
    flex-wrap: wrap;
}

.sync-status-view .ssv-tree-option {
    min-height: 28px;
    gap: var(--gfs-control-gap);
}

.sync-status-view .ssv-file {
    padding: 10px 12px;
}

.sync-status-view .ssv-file-row {
    min-height: 32px;
    gap: 8px;
}

.sync-status-view .ssv-file-actions {
    gap: var(--gfs-control-gap);
    margin-top: 8px;
}

.sync-status-view .ssv-action-btn {
    min-height: 30px;
    padding: 5px 9px;
    gap: var(--gfs-control-gap);
    border-radius: var(--gfs-control-radius);
    line-height: 1.2;
}

.sync-status-view .ssv-action-btn.push {
    border-color: var(--interactive-accent);
    color: var(--interactive-accent);
}

.sync-status-view .ssv-action-btn.pull,
.sync-status-view .ssv-action-btn.diff {
    border-color: var(--background-modifier-border);
    color: var(--text-normal);
}

.sync-status-view .ssv-action-btn.danger {
    border-color: var(--text-error);
    color: var(--text-error);
}

.sync-status-view .ssv-folder-toggle {
    width: 28px;
    height: 28px;
    border-radius: var(--gfs-control-radius);
}

.sync-status-view .ssv-folder-toggle:hover,
.sync-status-view .ssv-folder-toggle:focus-visible {
    background: var(--background-modifier-hover);
}

.sync-status-view .ssv-tree-folder-row {
    min-height: 38px;
    gap: 8px;
    padding: 5px 12px 5px 4px;
}

@container (max-width: 520px) {
    .sync-status-view .ssv-action-bar-row {
        flex-wrap: wrap;
        gap: var(--gfs-control-gap);
    }

    .sync-status-view .ssv-bar-spacer {
        display: none;
    }

    .sync-status-view .ssv-btn {
        width: 36px;
        min-width: 36px;
        height: 36px;
        padding: 0;
        justify-content: center;
    }

    .sync-status-view .ssv-btn-label,
    .sync-status-view .ssv-select-label {
        display: none;
    }

    .sync-status-view .ssv-select-row {
        margin-right: auto;
    }

    .sync-status-view .ssv-tree-options {
        gap: 12px;
    }

    .sync-status-view .ssv-file-actions {
        padding-left: 0;
    }
}

.is-mobile .sync-status-view .ssv-search-input,
.is-mobile .sync-status-view .ssv-search-clear,
.is-mobile .sync-status-view .ssv-filter-select,
.is-mobile .sync-status-view .ssv-btn,
.is-mobile .sync-status-view .ssv-select-row,
.is-mobile .sync-status-view .ssv-tree-option,
.is-mobile .sync-status-view .ssv-action-btn,
.is-mobile .sync-status-view .ssv-folder-toggle {
    min-height: var(--gfs-touch-target);
}

.is-mobile .sync-status-view .ssv-action-bar {
    gap: var(--gfs-section-gap);
    padding: 8px 10px;
}

.is-mobile .sync-status-view .ssv-action-bar-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
}

.is-mobile .sync-status-view .ssv-action-bar-row > .ssv-btn:only-child {
    grid-column: 1 / -1;
}

.is-mobile .sync-status-view .ssv-bar-spacer {
    display: none;
}

.is-mobile .sync-status-view .ssv-select-row {
    justify-content: center;
    margin-right: 0;
}

.is-mobile .sync-status-view .ssv-btn {
    width: 100%;
    min-width: 0;
    height: auto;
    padding: 9px 12px;
}

.is-mobile .sync-status-view .ssv-btn-label,
.is-mobile .sync-status-view .ssv-select-label {
    display: inline;
}

.is-mobile .sync-status-view .ssv-tree-options {
    gap: 8px 16px;
}

.is-mobile .sync-status-view .ssv-tree-option {
    padding-block: 4px;
}

.is-mobile .sync-status-view .ssv-file-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
}

.is-mobile .sync-status-view .ssv-action-btn {
    width: 100%;
    justify-content: center;
    padding: 9px 12px;
}

.is-mobile .sync-status-view .ssv-folder-toggle {
    width: var(--gfs-touch-target);
    height: var(--gfs-touch-target);
}
`;
