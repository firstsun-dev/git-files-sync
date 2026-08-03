type StyleMap = Partial<CSSStyleDeclaration>;

interface ControlMetrics {
    inputHeight: string;
    tabHeight: string;
    tabPadding: string;
    toolbarGap: string;
    toolbarDisplay: string;
    toolbarColumns: string;
    buttonHeight: string;
    buttonWidth: string;
    buttonMinWidth: string;
    buttonCssHeight: string;
    buttonPadding: string;
    selectHeight: string;
    selectJustify: string;
    selectMarginRight: string;
    treeHeight: string;
    treeGap: string;
    treePaddingTop: string;
    treePaddingBottom: string;
    fileRowHeight: string;
    fileActionGap: string;
    fileActionPaddingLeft: string;
    fileActionDisplay: string;
    fileActionColumns: string;
    fileButtonHeight: string;
    fileButtonWidth: string;
    fileButtonPadding: string;
    fileButtonJustify: string;
    folderSize: string;
    folderRowHeight: string;
}

const DESKTOP_METRICS: ControlMetrics = {
    inputHeight: '32px',
    tabHeight: '30px',
    tabPadding: '5px 10px',
    toolbarGap: '6px',
    toolbarDisplay: 'flex',
    toolbarColumns: '',
    buttonHeight: '32px',
    buttonWidth: '',
    buttonMinWidth: '',
    buttonCssHeight: '',
    buttonPadding: '5px 10px',
    selectHeight: '32px',
    selectJustify: '',
    selectMarginRight: '',
    treeHeight: '28px',
    treeGap: '16px',
    treePaddingTop: '',
    treePaddingBottom: '',
    fileRowHeight: '32px',
    fileActionGap: '6px',
    fileActionPaddingLeft: '',
    fileActionDisplay: 'flex',
    fileActionColumns: '',
    fileButtonHeight: '30px',
    fileButtonWidth: '',
    fileButtonPadding: '5px 9px',
    fileButtonJustify: '',
    folderSize: '28px',
    folderRowHeight: '38px',
};

const MOBILE_METRICS: ControlMetrics = {
    inputHeight: '44px',
    tabHeight: '44px',
    tabPadding: '8px 12px',
    toolbarGap: '8px',
    toolbarDisplay: 'grid',
    toolbarColumns: 'repeat(2, minmax(0, 1fr))',
    buttonHeight: '44px',
    buttonWidth: '100%',
    buttonMinWidth: '0',
    buttonCssHeight: 'auto',
    buttonPadding: '9px 12px',
    selectHeight: '44px',
    selectJustify: 'center',
    selectMarginRight: '0',
    treeHeight: '44px',
    treeGap: '8px 16px',
    treePaddingTop: '4px',
    treePaddingBottom: '4px',
    fileRowHeight: '44px',
    fileActionGap: '8px',
    fileActionPaddingLeft: '0',
    fileActionDisplay: 'grid',
    fileActionColumns: 'repeat(2, minmax(0, 1fr))',
    fileButtonHeight: '44px',
    fileButtonWidth: '100%',
    fileButtonPadding: '9px 12px',
    fileButtonJustify: 'center',
    folderSize: '44px',
    folderRowHeight: '44px',
};

/**
 * Applies the control polish after the current render pass has completed.
 * SyncStatusView rebuilds its body synchronously, so a microtask can style the
 * action bar and the file rows together without a MutationObserver.
 */
export function scheduleControlPolish(container: HTMLElement): void {
    const scope = container.closest<HTMLElement>('.sync-status-view') ?? container;
    void Promise.resolve().then(() => applyControlPolish(scope));
}

function applyControlPolish(scope: HTMLElement): void {
    const mobile = scope.closest('.is-mobile') !== null || scope.ownerDocument.body.classList.contains('is-mobile');
    const metrics = mobile ? MOBILE_METRICS : DESKTOP_METRICS;
    polishSearchAndFilters(scope, metrics);
    polishActionBar(scope, metrics);
    polishFileActions(scope, metrics);
    polishFileRows(scope, metrics);
    if (mobile) polishMobileLayouts(scope);
}

function polishSearchAndFilters(scope: HTMLElement, metrics: ControlMetrics): void {
    for (const search of scope.querySelectorAll<HTMLElement>('.ssv-search')) {
        setStyles(search, { gap: '6px', padding: '8px 10px' });
    }
    for (const input of scope.querySelectorAll<HTMLInputElement>('.ssv-search-input')) {
        setStyles(input, {
            height: metrics.inputHeight,
            minHeight: metrics.inputHeight,
            paddingLeft: '8px',
            paddingRight: '8px',
            borderRadius: '6px',
        });
    }
    for (const clear of scope.querySelectorAll<HTMLButtonElement>('.ssv-search-clear')) {
        setStyles(clear, {
            width: metrics.inputHeight,
            height: metrics.inputHeight,
            minHeight: metrics.inputHeight,
            borderRadius: '6px',
        });
    }
    for (const tabs of scope.querySelectorAll<HTMLElement>('.ssv-tabs')) {
        setStyles(tabs, { gap: '6px', padding: '8px 10px' });
    }
    for (const tab of scope.querySelectorAll<HTMLButtonElement>('.ssv-tab')) {
        setStyles(tab, {
            minHeight: metrics.tabHeight,
            padding: metrics.tabPadding,
            gap: '6px',
            borderRadius: '999px',
        });
    }
    for (const select of scope.querySelectorAll<HTMLSelectElement>('.ssv-filter-select')) {
        setStyles(select, { minHeight: metrics.inputHeight, borderRadius: '6px' });
    }
}

function polishActionBar(scope: HTMLElement, metrics: ControlMetrics): void {
    for (const bar of scope.querySelectorAll<HTMLElement>('.ssv-action-bar')) {
        setStyles(bar, { gap: '8px', padding: '8px 10px' });
    }
    for (const row of scope.querySelectorAll<HTMLElement>('.ssv-action-bar-row')) {
        setStyles(row, {
            gap: metrics.toolbarGap,
            display: metrics.toolbarDisplay,
            gridTemplateColumns: metrics.toolbarColumns,
        });
    }
    for (const button of scope.querySelectorAll<HTMLButtonElement>('.ssv-btn')) {
        setStyles(button, {
            minHeight: metrics.buttonHeight,
            width: metrics.buttonWidth,
            minWidth: metrics.buttonMinWidth,
            height: metrics.buttonCssHeight,
            padding: metrics.buttonPadding,
            gap: '6px',
            borderRadius: '6px',
            lineHeight: '1.2',
            transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease',
        });
        applyToolbarButtonHierarchy(button);
    }
    for (const selectRow of scope.querySelectorAll<HTMLElement>('.ssv-select-row')) {
        setStyles(selectRow, {
            minHeight: metrics.selectHeight,
            paddingLeft: '4px',
            paddingRight: '6px',
            gap: '6px',
            justifyContent: metrics.selectJustify,
            marginRight: metrics.selectMarginRight,
        });
    }
    for (const options of scope.querySelectorAll<HTMLElement>('.ssv-tree-options')) {
        setStyles(options, {
            minHeight: metrics.treeHeight,
            gap: metrics.treeGap,
            paddingLeft: '2px',
            flexWrap: 'wrap',
        });
    }
    for (const option of scope.querySelectorAll<HTMLElement>('.ssv-tree-option')) {
        setStyles(option, {
            minHeight: metrics.treeHeight,
            gap: '6px',
            paddingTop: metrics.treePaddingTop,
            paddingBottom: metrics.treePaddingBottom,
        });
    }
}

function polishMobileLayouts(scope: HTMLElement): void {
    for (const spacer of scope.querySelectorAll<HTMLElement>('.ssv-bar-spacer')) {
        spacer.setCssProps({ display: 'none' });
    }
    for (const row of scope.querySelectorAll<HTMLElement>('.ssv-action-bar-row')) {
        if (row.querySelectorAll(':scope > .ssv-btn').length !== 1) continue;
        row.querySelector<HTMLElement>(':scope > .ssv-btn')?.setCssProps({ 'grid-column': '1 / -1' });
    }
}

function polishFileActions(scope: HTMLElement, metrics: ControlMetrics): void {
    for (const actions of scope.querySelectorAll<HTMLElement>('.ssv-file-actions')) {
        setStyles(actions, {
            gap: metrics.fileActionGap,
            marginTop: '8px',
            paddingLeft: metrics.fileActionPaddingLeft,
            display: metrics.fileActionDisplay,
            gridTemplateColumns: metrics.fileActionColumns,
        });
    }
    for (const button of scope.querySelectorAll<HTMLButtonElement>('.ssv-action-btn')) {
        setStyles(button, {
            minHeight: metrics.fileButtonHeight,
            width: metrics.fileButtonWidth,
            padding: metrics.fileButtonPadding,
            gap: '6px',
            borderRadius: '6px',
            lineHeight: '1.2',
            justifyContent: metrics.fileButtonJustify,
        });
        applyFileButtonHierarchy(button);
    }
}

function polishFileRows(scope: HTMLElement, metrics: ControlMetrics): void {
    for (const file of scope.querySelectorAll<HTMLElement>('.ssv-file')) {
        file.setCssProps({ padding: '10px 12px' });
    }
    for (const fileRow of scope.querySelectorAll<HTMLElement>('.ssv-file-row')) {
        setStyles(fileRow, { minHeight: metrics.fileRowHeight, gap: '8px' });
    }
    for (const toggle of scope.querySelectorAll<HTMLButtonElement>('.ssv-folder-toggle')) {
        setStyles(toggle, {
            width: metrics.folderSize,
            minWidth: metrics.folderSize,
            height: metrics.folderSize,
            minHeight: metrics.folderSize,
            borderRadius: '6px',
        });
    }
    for (const folderRow of scope.querySelectorAll<HTMLElement>('.ssv-tree-folder-row')) {
        setStyles(folderRow, {
            minHeight: metrics.folderRowHeight,
            gap: '8px',
            padding: '5px 12px 5px 4px',
        });
    }
}

function applyToolbarButtonHierarchy(button: HTMLButtonElement): void {
    if (button.classList.contains('ssv-btn-push')) {
        setStyles(button, {
            background: 'var(--interactive-accent)',
            borderColor: 'var(--interactive-accent)',
            color: 'var(--text-on-accent)',
        });
        return;
    }
    if (button.classList.contains('ssv-btn-delete')) {
        setStyles(button, {
            background: 'transparent',
            borderColor: 'var(--text-error)',
            color: 'var(--text-error)',
        });
        return;
    }
    if (button.classList.contains('ssv-btn-pull') || button.classList.contains('ssv-btn-refresh')) {
        setStyles(button, {
            background: 'var(--background-secondary)',
            borderColor: 'var(--background-modifier-border)',
            color: 'var(--text-normal)',
        });
    }
}

function applyFileButtonHierarchy(button: HTMLButtonElement): void {
    if (button.classList.contains('push')) {
        button.setCssProps({
            'border-color': 'var(--interactive-accent)',
            color: 'var(--interactive-accent)',
        });
    } else if (button.classList.contains('danger')) {
        button.setCssProps({
            'border-color': 'var(--text-error)',
            color: 'var(--text-error)',
        });
    } else if (button.classList.contains('pull') || button.classList.contains('diff')) {
        button.setCssProps({
            'border-color': 'var(--background-modifier-border)',
            color: 'var(--text-normal)',
        });
    }
}

function setStyles(element: HTMLElement, styles: StyleMap): void {
    element.setCssStyles(styles);
}
