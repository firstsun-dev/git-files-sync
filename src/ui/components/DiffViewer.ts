import { Platform } from 'obsidian';
import { renderDiffLayoutToggle, type DiffLayout } from './DiffLayoutToggle';
import { renderDiffPanel } from './DiffPanel';

/**
 * The one default-layout policy for every diff surface: wide surfaces
 * (desktop tab, desktop conflict modal) open in split — side-by-side is the
 * point of a wide viewport — while narrow phones open in unified, where two
 * columns would be unreadable. Every surface calls this instead of keeping
 * its own default.
 */
export function defaultDiffLayout(): DiffLayout {
    return Platform.isMobile ? 'unified' : 'split';
}

/**
 * Session-wide diff layout memory, shared by all diff surfaces: switching to
 * unified in the conflict modal also opens the next diff tab and mobile
 * detail in unified. One policy, one memory — surfaces never drift apart
 * within a plugin session (deliberately not persisted to disk: layout is a
 * per-session reading preference, not a setting).
 */
let sessionDiffLayout: DiffLayout | undefined;

export function currentDiffLayout(): DiffLayout {
    return sessionDiffLayout ?? defaultDiffLayout();
}

export function rememberDiffLayout(layout: DiffLayout): void {
    sessionDiffLayout = layout;
}

export function resetDiffLayoutMemoryForTests(): void {
    sessionDiffLayout = undefined;
}

export interface DiffViewerOptions {
    remote: string;
    local: string;
    layout: DiffLayout;
    /**
     * Where the split/unified toggle renders — typically the fixed header
     * region of the enclosing surface, so it stays reachable while a long
     * diff scrolls below. When omitted, no toggle is rendered and the viewer
     * shows the given layout statically.
     */
    toggleHost?: HTMLElement;
    /** State-sync callback so the owning surface can persist the layout across its own re-renders. */
    onLayoutChange?: (next: DiffLayout) => void;
}

/**
 * The shared diff-viewer composition: layout toggle + body layout class +
 * diff panel. Every diff surface (desktop diff tab, conflict modal, mobile
 * detail) renders through this instead of reassembling DiffLayoutToggle and
 * DiffPanel — and never rebuilds its own "apply layout class + re-render
 * toggle" dance.
 */
export function renderDiffViewer(container: HTMLElement, options: DiffViewerOptions): void {
    const body = container.createDiv({ cls: `scv-diff-tab-body scv-diff-layout-${options.layout}` });
    renderDiffPanel(body, options.remote, options.local);

    const toggleHost = options.toggleHost;
    if (!toggleHost) return;

    const renderToggle = (layout: DiffLayout): void => {
        toggleHost.empty();
        renderDiffLayoutToggle(toggleHost, layout, next => {
            applyLayoutClass(body, next);
            options.onLayoutChange?.(next);
            renderToggle(next);
        });
    };
    renderToggle(options.layout);
}

function applyLayoutClass(body: HTMLElement, layout: DiffLayout): void {
    body.removeClass('scv-diff-layout-split');
    body.removeClass('scv-diff-layout-unified');
    body.addClass(`scv-diff-layout-${layout}`);
}