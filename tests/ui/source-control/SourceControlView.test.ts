import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { SourceControlView, type SourceControlViewCallbacks } from '../../../src/ui/source-control/SourceControlView';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { RefreshState } from '../../../src/logic/source-control/RefreshState';
import { PushSelectionStore } from '../../../src/logic/source-control/PushSelectionStore';
import { SourceControlViewModel } from '../../../src/logic/source-control/SourceControlViewModel';
import { toChangeId, type SyncChange } from '../../../src/logic/source-control/types';
import { setupObsidianDOM, createContainer } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

function buildView(changes: SyncChange[], callbacks: Partial<SourceControlViewCallbacks> = {}) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const selection = new PushSelectionStore();
    const operations = new OperationState();
    const refreshState = new RefreshState();
    const refreshSource = vi.fn().mockResolvedValue(undefined);
    const viewModel = new SourceControlViewModel(repository, selection, operations, refreshSource, refreshState);
    const onPush = callbacks.onPush ?? vi.fn();
    const onRefresh = callbacks.onRefresh ?? vi.fn();
    const view = new SourceControlView(viewModel, selection, { onPush, onRefresh, ...callbacks }, () => ({
        serviceName: 'GitHub',
        branch: 'main',
        vaultFolder: '',
        lastSyncTime: 0,
    }));
    return { view, selection, operations, refreshState, refreshSource, onPush, onRefresh };
}

describe('SourceControlView', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = createContainer();
    });

    describe('filter switching', () => {
        it('renders "All" as a single flat tree (no section breakdown) and excludes synced', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'remote-only' },
                { id: toChangeId('c-3'), path: 'c.md', kind: 'conflict' },
                { id: toChangeId('c-4'), path: 'd.md', kind: 'synced' },
            ]);
            view.render(container);

            // No section grouping under All — every filter renders one flat tree.
            expect(container.querySelectorAll('.scv-section')).toHaveLength(0);
            // Active-filter header reads "ALL".
            expect(container.querySelector('.scv-active-filter-title')?.textContent).toBe('ALL');
            expect(container.querySelector('.scv-active-filter-count')?.textContent).toBe('3');
            // Actionable items only: synced is absent from All.
            const kinds = Array.from(container.querySelectorAll('.scv-change-item')).map(el => el.getAttribute('class'));
            expect(kinds.some(c => c?.includes('scv-kind-synced'))).toBe(false);
            expect(container.querySelectorAll('.scv-change-item')).toHaveLength(3);
        });

        it('does not render a SYNCED section under the All filter (status-grouping fix)', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'd.md', kind: 'synced' },
            ]);
            view.render(container);

            const sectionTitles = Array.from(container.querySelectorAll('.scv-section-title')).map(el => el.textContent);
            expect(sectionTitles).not.toContain('SYNCED');
            expect(container.querySelectorAll('.scv-section')).toHaveLength(0);
        });

        it('shows a flat tree (no sections) once a specific filter is selected', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'conflict' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'local-only' },
            ]);
            view.render(container);

            (container.querySelector('.scv-filter-option[data-filter="conflicts"]') as HTMLButtonElement).click();

            expect(container.querySelectorAll('.scv-section')).toHaveLength(0);
            expect(container.querySelectorAll('.scv-change-item')).toHaveLength(1);
            expect(view.getFilter()).toBe('conflicts');
        });

        it('shows the empty state when the active filter has no items', () => {
            const { view } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);

            (container.querySelector('.scv-filter-option[data-filter="conflicts"]') as HTMLButtonElement).click();

            expect(container.querySelector('.scv-empty')).not.toBeNull();
        });
    });

    describe('synced surfacing removed', () => {
        it('never renders a synced chip or a Show synced toggle', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'd.md', kind: 'synced' },
            ]);
            view.render(container);

            expect(container.querySelector('.scv-filter-option[data-filter="synced"]')).toBeNull();
            expect(container.querySelector('.scv-filter-show-synced-checkbox')).toBeNull();
        });

        it('excludes synced rows from every filter view', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'd.md', kind: 'synced' },
            ]);
            view.render(container);

            expect(container.querySelectorAll('.scv-change-item')).toHaveLength(1);
            expect(container.querySelector('.scv-kind-synced')).toBeNull();
        });
    });

    describe('selection', () => {
        it('moves a change into "ready to push" and updates the push button count', () => {
            const { view, selection } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);

            const checkbox = container.querySelector('.scv-change-select') as HTMLInputElement;
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));

            expect(selection.isIncluded(toChangeId('c-1'))).toBe(true);
            const pushLabel = container.querySelector('.scv-push-btn-label')?.textContent ?? '';
            expect(pushLabel).toContain('1');
        });

        it('deselecting removes the change from PushSelectionStore', () => {
            const { view, selection } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            selection.includeForPush(toChangeId('c-1'));
            view.render(container);

            const checkbox = container.querySelector('.scv-change-select') as HTMLInputElement;
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change'));

            expect(selection.isIncluded(toChangeId('c-1'))).toBe(false);
        });

        it('renders the "SELECTED FOR SYNC" section only when at least one actionable change is selected', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'synced' },
            ]);

            view.render(container);
            expect(container.querySelector('.scv-selected-section')).toBeNull();

            selection.includeForPush(toChangeId('c-1'));
            view.render(container);
            const section = container.querySelector('.scv-selected-section');
            expect(section).not.toBeNull();
            expect(section?.querySelector('.scv-selected-section-title')?.textContent).toBe('SELECTED FOR SYNC');
            expect(section?.querySelector('.scv-selected-section-count')?.textContent).toBe('1');
        });

        it('lists the selected change as a real row inside the Selected section, unselecting on checkbox clear', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'notes/a.md', kind: 'local-only' },
            ]);
            selection.includeForPush(toChangeId('c-1'));
            view.render(container);

            const section = container.querySelector('.scv-selected-section') as HTMLElement;
            const row = section.querySelector('.scv-change-item') as HTMLElement;
            expect(row?.getAttribute('data-change-id')).toBe('c-1');
            expect(row?.querySelector('.scv-change-name-text')?.textContent).toBe('a.md');
            expect(row?.classList.contains('is-selected')).toBe(true);

            const checkbox = row.querySelector('.scv-change-select') as HTMLInputElement;
            expect(checkbox.checked).toBe(true);
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change'));

            expect(selection.isIncluded(toChangeId('c-1'))).toBe(false);
            expect(container.querySelector('.scv-selected-section')).toBeNull();
        });

        it('clears all selected changes at once via the Clear button in the section header', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
                { id: toChangeId('c-3'), path: 'c.md', kind: 'remote-only' },
            ]);
            selection.includeForPush(toChangeId('c-1'));
            selection.includeForPush(toChangeId('c-2'));
            selection.includeForPush(toChangeId('c-3'));
            view.render(container);

            const clearBtn = container.querySelector('.scv-selected-section-clear') as HTMLButtonElement;
            expect(clearBtn).not.toBeNull();
            clearBtn.click();

            expect(selection.isIncluded(toChangeId('c-1'))).toBe(false);
            expect(selection.isIncluded(toChangeId('c-2'))).toBe(false);
            expect(selection.isIncluded(toChangeId('c-3'))).toBe(false);
            expect(container.querySelector('.scv-selected-section')).toBeNull();
        });

        it('excludes synced changes from the SELECTED FOR SYNC count even when selected', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'synced' },
            ]);
            selection.includeForPush(toChangeId('c-1'));
            selection.includeForPush(toChangeId('c-2'));
            view.render(container);

            expect(container.querySelector('.scv-selected-section-count')?.textContent).toBe('1');
        });
    });

    describe('push action', () => {
        it('calls onPush with every selected ChangeId, without touching the Git provider itself', () => {
            const onPush = vi.fn();
            const { view, selection } = buildView(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
                ],
                { onPush },
            );
            selection.includeForPush(toChangeId('c-1'));
            selection.includeForPush(toChangeId('c-2'));
            view.render(container);

            (container.querySelector('.scv-push-btn') as HTMLButtonElement).click();

            expect(onPush).toHaveBeenCalledWith([toChangeId('c-1'), toChangeId('c-2')]);
        });

        it('disables the push button when nothing is selected', () => {
            const { view } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);

            expect((container.querySelector('.scv-push-btn') as HTMLButtonElement).disabled).toBe(true);
        });
    });

    describe('operation status', () => {
        it('renders the running indicator for a change with an in-flight operation', () => {
            const { view, operations } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            operations.start(toChangeId('c-1'));
            view.render(container);

            const indicator = container.querySelector('.scv-op-indicator');
            expect(indicator?.classList.contains('scv-op-running')).toBe(true);
        });

        it('renders a text label alongside the operation indicator', () => {
            const { view, operations } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            operations.start(toChangeId('c-1'));
            view.render(container);

            expect(container.querySelector('.scv-op-indicator .scv-op-label')?.textContent).toBe('Syncing');
        });

        it('shows no indicator once the operation is idle again', () => {
            const { view, operations } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            operations.start(toChangeId('c-1'));
            operations.reset(toChangeId('c-1'));
            view.render(container);

            expect(container.querySelector('.scv-op-indicator')).toBeNull();
        });
    });

    describe('refresh', () => {
        it('renders the refresh button in the idle state by default', () => {
            const { view } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);

            const btn = container.querySelector('.scv-refresh-btn');
            expect(btn).not.toBeNull();
            expect(btn?.classList.contains('is-idle')).toBe(true);
        });

        it('renders the "Refreshing…" label while loading', () => {
            const { view, refreshState } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);
            refreshState.start();
            view.render(container);

            const btn = container.querySelector('.scv-refresh-btn');
            expect(btn?.classList.contains('is-loading')).toBe(true);
            expect(btn?.querySelector('.scv-refresh-btn-label')?.textContent).toBe('Refreshing…');
            expect((btn as HTMLButtonElement).disabled).toBe(true);
        });

        it('renders the "Refresh failed" label in the failed state', () => {
            const { view, refreshState } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);
            refreshState.fail();
            view.render(container);

            const btn = container.querySelector('.scv-refresh-btn');
            expect(btn?.classList.contains('is-failed')).toBe(true);
            expect(btn?.querySelector('.scv-refresh-btn-label')?.textContent).toBe('Refresh failed');
        });

        it('calls onRefresh when the refresh button is clicked', () => {
            const onRefresh = vi.fn();
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                { onRefresh },
            );
            view.render(container);

            (container.querySelector('.scv-refresh-btn') as HTMLButtonElement).click();

            expect(onRefresh).toHaveBeenCalledTimes(1);
        });

        it('does not call onRefresh while a refresh is already loading', () => {
            const onRefresh = vi.fn();
            const { view, refreshState } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                { onRefresh },
            );
            view.render(container);
            refreshState.start();
            view.render(container);

            (container.querySelector('.scv-refresh-btn') as HTMLButtonElement).click();

            expect(onRefresh).not.toHaveBeenCalled();
        });
    });

    describe('diff selection', () => {
        // Desktop has no inline diff pane -- clicking a change only notifies
        // onOpenDiff, and the host (SourceControlItemView) opens a main-area
        // tab. Only the mobile full-screen detail view still loads/renders
        // diff content inside SourceControlView itself.
        afterEach(() => { Platform.isMobile = false; });

        it('loads and renders diff content in the mobile detail view for the clicked change', async () => {
            Platform.isMobile = true;
            const loadDiffContent = vi.fn().mockResolvedValue({ remote: 'remote text', local: 'local text' });
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                { loadDiffContent },
            );
            view.render(container);

            (container.querySelector('.scv-change-item') as HTMLElement).click();
            await Promise.resolve();
            await Promise.resolve();

            expect(loadDiffContent).toHaveBeenCalledWith(expect.objectContaining({ id: toChangeId('c-1') }));
            expect(container.querySelector('.scv-detail-diff')).not.toBeNull();
            // Reuses the existing diff panel renderer (Phase 3 spec: don't rewrite diff UI), which uses its own 'ssv-' class prefix.
            expect(container.querySelector('.ssv-diff-split')).not.toBeNull();
        });

        it('does not render an inline diff pane on desktop -- only notifies onOpenDiff', () => {
            const { view } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }]);
            view.render(container);

            (container.querySelector('.scv-change-item') as HTMLElement).click();

            expect(container.querySelector('.scv-diff')).toBeNull();
            expect(container.querySelector('.scv-detail')).toBeNull();
        });

        it('notifies onOpenDiff with the selected item', () => {
            const onOpenDiff = vi.fn();
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                { onOpenDiff },
            );
            view.render(container);

            (container.querySelector('.scv-change-item') as HTMLElement).click();

            expect(onOpenDiff).toHaveBeenCalledWith(expect.objectContaining({ id: toChangeId('c-1'), path: 'a.md' }));
        });

        describe('mobile diff layout toggle', () => {
            it('defaults to the unified (single-column) layout, with the split diff hidden', async () => {
                Platform.isMobile = true;
                const loadDiffContent = vi.fn().mockResolvedValue({ remote: 'remote text', local: 'local text' });
                const { view } = buildView(
                    [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                    { loadDiffContent },
                );
                view.render(container);
                (container.querySelector('.scv-change-item') as HTMLElement).click();
                await Promise.resolve();
                await Promise.resolve();

                const diffContainer = container.querySelector('.scv-detail-diff');
                expect(diffContainer?.classList.contains('scv-diff-layout-unified')).toBe(true);
            });

            it('switches to the split layout when the toggle button is clicked, never showing both at once', async () => {
                Platform.isMobile = true;
                const loadDiffContent = vi.fn().mockResolvedValue({ remote: 'remote text', local: 'local text' });
                const { view } = buildView(
                    [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                    { loadDiffContent },
                );
                view.render(container);
                (container.querySelector('.scv-change-item') as HTMLElement).click();
                await Promise.resolve();
                await Promise.resolve();

                (container.querySelector('.scv-diff-layout-toggle') as HTMLButtonElement).click();
                await Promise.resolve();
                await Promise.resolve();

                const diffContainer = container.querySelector('.scv-detail-diff');
                expect(diffContainer?.classList.contains('scv-diff-layout-split')).toBe(true);
                expect(diffContainer?.classList.contains('scv-diff-layout-unified')).toBe(false);
            });
        });
    });

    describe('rename stability', () => {
        it('keeps the selected ChangeId set after a rename changes the path', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'old.md', kind: 'local-modified' },
            ]);
            view.render(container);
            (container.querySelector('.scv-change-item') as HTMLElement).click();
            expect(view.getSelectedChangeId()).toBe(toChangeId('c-1'));

            // Simulate a rename being reflected in a fresh ViewModel snapshot for the same ChangeId.
            const { view: renamedView } = buildView([
                { id: toChangeId('c-1'), path: 'new.md', previousPath: 'old.md', kind: 'moved' },
            ]);
            renamedView.render(container);
            (container.querySelector('.scv-change-item') as HTMLElement).click();

            expect(renamedView.getSelectedChangeId()).toBe(toChangeId('c-1'));
            expect(container.querySelector('.scv-change-rename-from')?.textContent).toBe('old.md');
        });
    });

    describe('diff stat caching', () => {
        async function flush(): Promise<void> {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        }

        it('eager-loads local-only stats on render and shows them in the row', async () => {
            const loadDiffStat = vi.fn().mockResolvedValue({ additions: 5, deletions: 0 });
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                { loadDiffStat },
            );
            view.render(container);
            await flush();

            expect(loadDiffStat).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local-only' }));
            expect(container.querySelector('.scv-diff-stat')?.textContent).toBe('+5');
        });

        it('does not re-fetch a stat that is already cached on rerender', async () => {
            const loadDiffStat = vi.fn().mockResolvedValue({ additions: 2, deletions: 0 });
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                { loadDiffStat },
            );
            view.render(container);
            await flush();
            expect(loadDiffStat).toHaveBeenCalledTimes(1);

            view.render(container);
            await flush();
            // Eager load skips items already in the cache, so no second fetch.
            expect(loadDiffStat).toHaveBeenCalledTimes(1);
        });

        it('clears the diff stat cache on refresh so stats re-fetch', async () => {
            const loadDiffStat = vi.fn().mockResolvedValue({ additions: 5, deletions: 0 });
            const onRefresh = vi.fn();
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                { loadDiffStat, onRefresh },
            );
            view.render(container);
            await flush();
            expect(loadDiffStat).toHaveBeenCalledTimes(1);

            (container.querySelector('.scv-refresh-btn') as HTMLButtonElement).click();
            expect(onRefresh).toHaveBeenCalledTimes(1);
            // The refresh handler clears the cache; a subsequent render re-eager-loads.
            view.render(container);
            await flush();
            expect(loadDiffStat).toHaveBeenCalledTimes(2);
        });

        it('lazily loads a two-sided change stat on open and caches it', async () => {
            const loadDiffStat = vi.fn().mockResolvedValue({ additions: 1, deletions: 4 });
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                { loadDiffStat },
            );
            view.render(container);
            await flush();
            // Two-sided changes are not eager-loaded.
            expect(loadDiffStat).not.toHaveBeenCalled();
            expect(container.querySelector('.scv-diff-stat')).toBeNull();

            (container.querySelector('.scv-change-item') as HTMLElement).click();
            await flush();

            expect(loadDiffStat).toHaveBeenCalledTimes(1);
            expect(container.querySelector('.scv-diff-stat')?.textContent).toBe('+1 -4');
        });
    });

    describe('mobile layout', () => {
        afterEach(() => { Platform.isMobile = false; });

        it('renders a filter dropdown instead of chips on mobile', () => {
            Platform.isMobile = true;
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'remote-only' },
            ]);
            view.render(container);

            expect(container.querySelector('.scv-filter-dropdown')).not.toBeNull();
            expect(container.querySelectorAll('.scv-filter-option')).toHaveLength(0);
        });

        it('hides the header push button and shows a sticky bottom sync bar on mobile when there is a selection', () => {
            Platform.isMobile = true;
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
            ]);
            selection.includeForPush(toChangeId('c-1'));
            view.render(container);

            expect(container.querySelector('.scv-push-btn')).toBeNull();
            expect(container.querySelector('.scv-mobile-sync-bar')).not.toBeNull();
            expect(container.querySelector('.scv-mobile-sync-count')?.textContent).toBe('1');
        });

        it('omits the mobile bottom sync bar when nothing is selected for push', () => {
            Platform.isMobile = true;
            const { view } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);

            expect(container.querySelector('.scv-mobile-sync-bar')).toBeNull();
        });

        it('triggers onPush from the mobile bottom sync bar button', () => {
            Platform.isMobile = true;
            const onPush = vi.fn();
            const { view, selection } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                { onPush },
            );
            selection.includeForPush(toChangeId('c-1'));
            view.render(container);

            (container.querySelector('.scv-mobile-sync-btn') as HTMLButtonElement).click();

            expect(onPush).toHaveBeenCalledWith([toChangeId('c-1')]);
        });
    });
});
