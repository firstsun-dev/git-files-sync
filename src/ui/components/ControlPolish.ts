type StyleMap = Partial<CSSStyleDeclaration>;

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
    const mobile = scope.closest('.is-mobile') !== null || document.body.classList.contains('is-mobile');

    for (const search of scope.querySelectorAll<HTMLElement>('.ssv-search')) {
        setStyles(search, { gap: '6px', padding: '8px 10px' });
    }
    for (const input of scope.querySelectorAll<HTMLInputElement>('.ssv-search-input')) {
        setStyles(input, {
            height: mobile ? '44px' : '32px',
            minHeight: mobile ? '44px' : '32px',
            paddingLeft: '8px',
            paddingRight: '8px',
            borderRadius: '6px',
        });
    }
    for (const clear of scope.querySelectorAll<HTMLButtonElement>('.ssv-search-clear')) {
        setStyles(clear, {
            width: mobile ? '44px' : '32px',
            height: mobile ? '44px' : '32px',
            minHeight: mobile ? '44px' : '32px',
            borderRadius: '6px',
        });
    }

    for (const tabs of scope.querySelectorAll<HTMLElement>('.ssv-tabs')) {
        setStyles(tabs, { gap: '6px', padding: '8px 10px' });
    }
    for (const tab of scope.querySelectorAll<HTMLButtonElement>('.ssv-tab')) {
        setStyles(tab, {
            minHeight: mobile ? '44px' : '30px',
            padding: mobile ? '8px 12px' : '5px 10px',
            gap: '6px',
            borderRadius: '999px',
        });
    }
    for (const select of scope.querySelectorAll<HTMLSelectElement>('.ssv-filter-select')) {
        setStyles(select, { minHeight: mobile ? '44px' : '32px', borderRadius: '6px' });
    }

    for (const bar of scope.querySelectorAll<HTMLElement>('.ssv-action-bar')) {
        setStyles(bar, { gap: '8px', padding: '8px 10px' });
    }
    for (const row of scope.querySelectorAll<HTMLElement>('.ssv-action-bar-row')) {
        setStyles(row, {
            gap: mobile ? '8px' : '6px',
            display: mobile ? 'grid' : 'flex',
            gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : '',
        });

        if (mobile && row.querySelectorAll(':scope > .ssv-btn').length === 1) {
            const onlyButton = row.querySelector<HTMLElement>(':scope > .ssv-btn');
            if (onlyButton) onlyButton.style.gridColumn = '1 / -1';
        }
    }
    for (const spacer of scope.querySelectorAll<HTMLElement>('.ssv-bar-spacer')) {
        if (mobile) spacer.style.display = 'none';
    }
    for (const button of scope.querySelectorAll<HTMLButtonElement>('.ssv-btn')) {
        setStyles(button, {
            minHeight: mobile ? '44px' : '32px',
            width: mobile ? '100%' : '',
            minWidth: mobile ? '0' : '',
            height: mobile ? 'auto' : '',
            padding: mobile ? '9px 12px' : '5px 10px',
            gap: '6px',
            borderRadius: '6px',
            lineHeight: '1.2',
            transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease',
        });
        applyToolbarButtonHierarchy(button);
    }
    for (const selectRow of scope.querySelectorAll<HTMLElement>('.ssv-select-row')) {
        setStyles(selectRow, {
            minHeight: mobile ? '44px' : '32px',
            paddingLeft: '4px',
            paddingRight: '6px',
            gap: '6px',
            justifyContent: mobile ? 'center' : '',
            marginRight: mobile ? '0' : '',
        });
    }
    for (const options of scope.querySelectorAll<HTMLElement>('.ssv-tree-options')) {
        setStyles(options, {
            minHeight: mobile ? '44px' : '28px',
            gap: mobile ? '8px 16px' : '16px',
            paddingLeft: '2px',
            flexWrap: 'wrap',
        });
    }
    for (const option of scope.querySelectorAll<HTMLElement>('.ssv-tree-option')) {
        setStyles(option, {
            minHeight: mobile ? '44px' : '28px',
            gap: '6px',
            paddingTop: mobile ? '4px' : '',
            paddingBottom: mobile ? '4px' : '',
        });
    }

    for (const file of scope.querySelectorAll<HTMLElement>('.ssv-file')) {
        file.style.padding = '10px 12px';
    }
    for (const fileRow of scope.querySelectorAll<HTMLElement>('.ssv-file-row')) {
        setStyles(fileRow, { minHeight: mobile ? '44px' : '32px', gap: '8px' });
    }
    for (const actions of scope.querySelectorAll<HTMLElement>('.ssv-file-actions')) {
        setStyles(actions, {
            gap: mobile ? '8px' : '6px',
            marginTop: '8px',
            paddingLeft: mobile ? '0' : '',
            display: mobile ? 'grid' : 'flex',
            gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : '',
        });
    }
    for (const button of scope.querySelectorAll<HTMLButtonElement>('.ssv-action-btn')) {
        setStyles(button, {
            minHeight: mobile ? '44px' : '30px',
            width: mobile ? '100%' : '',
            padding: mobile ? '9px 12px' : '5px 9px',
            gap: '6px',
            borderRadius: '6px',
            lineHeight: '1.2',
            justifyContent: mobile ? 'center' : '',
        });
        applyFileButtonHierarchy(button);
    }

    for (const toggle of scope.querySelectorAll<HTMLButtonElement>('.ssv-folder-toggle')) {
        setStyles(toggle, {
            width: mobile ? '44px' : '28px',
            minWidth: mobile ? '44px' : '28px',
            height: mobile ? '44px' : '28px',
            minHeight: mobile ? '44px' : '28px',
            borderRadius: '6px',
        });
    }
    for (const folderRow of scope.querySelectorAll<HTMLElement>('.ssv-tree-folder-row')) {
        setStyles(folderRow, {
            minHeight: mobile ? '44px' : '38px',
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
        button.style.borderColor = 'var(--interactive-accent)';
        button.style.color = 'var(--interactive-accent)';
    } else if (button.classList.contains('danger')) {
        button.style.borderColor = 'var(--text-error)';
        button.style.color = 'var(--text-error)';
    } else if (button.classList.contains('pull') || button.classList.contains('diff')) {
        button.style.borderColor = 'var(--background-modifier-border)';
        button.style.color = 'var(--text-normal)';
    }
}

function setStyles(element: HTMLElement, styles: StyleMap): void {
    Object.assign(element.style, styles);
}
