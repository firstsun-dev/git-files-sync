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
    /**
     * Diff content. Omit both when the content isn't loaded yet (e.g. an
     * async fetch is in flight) — the viewer renders just the empty body,
     * and the caller fills it in later via the returned handle's
     * `setContent`. Passing only one of the two is not supported.
     */
    remote?: string;
    local?: string;
    layout: DiffLayout;
    /**
     * Where the split/unified toggle renders — typically the fixed header
     * region of the enclosing surface, so it stays reachable while a long
     * diff scrolls below. When omitted, no toggle is rendered and the viewer
     * shows the given layout statically. Also suppressed on phones (see
     * `renderDiffViewer` doc) regardless of this option.
     */
    toggleHost?: HTMLElement;
    /** State-sync callback so the owning surface can persist the layout across its own re-renders. */
    onLayoutChange?: (next: DiffLayout) => void;
}

/** Handle to the diff body a `renderDiffViewer` call created, for filling in content that wasn't ready yet at render time. */
export interface DiffViewerHandle {
    /** Replaces the body's content. Safe to call once the initial (possibly content-less) render has happened. */
    setContent(remote: string, local: string): void;
}

/**
 * The shared diff-viewer composition: layout toggle + body layout class +
 * diff panel. Every diff surface (desktop diff tab, conflict modal, mobile
 * detail) renders through this instead of reassembling DiffLayoutToggle and
 * DiffPanel — and never rebuilds its own "apply layout class + re-render
 * toggle" dance. This is also the single owner of the diff body element:
 * callers that load content asynchronously must go through the returned
 * handle's `setContent` rather than reaching into the DOM and calling
 * `renderDiffPanel` themselves, which would append a second copy alongside
 * whatever this function already rendered.
 *
 * Phones (`Platform.isPhone`) always render unified with no toggle — a
 * split view is unreadable at phone width, and offering a toggle that
 * produces two ~150px columns is worse than not offering it. Tablets and
 * desktop keep the caller's requested layout and toggle.
 */
export function renderDiffViewer(container: HTMLElement, options: DiffViewerOptions): DiffViewerHandle {
    const layout: DiffLayout = Platform.isPhone ? 'unified' : options.layout;
    const body = container.createDiv({ cls: `scv-diff-tab-body scv-diff-layout-${layout}` });
    if (options.remote !== undefined && options.local !== undefined) {
        renderDiffPanel(body, options.remote, options.local);
    }

    const toggleHost = options.toggleHost;
    if (toggleHost && !Platform.isPhone) {
        const renderToggle = (l: DiffLayout): void => {
            toggleHost.empty();
            renderDiffLayoutToggle(toggleHost, l, next => {
                applyLayoutClass(body, next);
                options.onLayoutChange?.(next);
                renderToggle(next);
            });
        };
        renderToggle(layout);
    }

    return {
        setContent(remote: string, local: string): void {
            body.empty();
            renderDiffPanel(body, remote, local);
        },
    };
}

function applyLayoutClass(body: HTMLElement, layout: DiffLayout): void {
    body.removeClass('scv-diff-layout-split');
    body.removeClass('scv-diff-layout-unified');
    body.addClass(`scv-diff-layout-${layout}`);
}