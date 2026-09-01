import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { SourceControlView, type SourceControlViewCallbacks } from '../../../src/ui/source-control/SourceControlView';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { RefreshState } from '../../../src/logic/source-control/RefreshState';
import { SyncSelectionStore } from '../../../src/logic/source-control/SyncSelectionStore';
import { SourceControlViewModel, type SourceControlItem } from '../../../src/logic/source-control/SourceControlViewModel';
import { toChangeId, type SyncChange } from '../../../src/logic/source-control/types';
import { setupObsidianDOM, createContainer } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

function buildView(changes: SyncChange[], callbacks: Partial<SourceControlViewCallbacks> = {}) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const selection = new SyncSelectionStore();
    const operations = new OperationState();
    const refreshState = new RefreshState();
    const refreshSource = vi.fn().mockResolvedValue(undefined);
    const viewModel = new SourceControlViewModel(repository, selection, operations, refreshSource, refreshState);
    const onSync = callbacks.onSync ?? vi.fn();
    const onRefresh = callbacks.onRefresh ?? vi.fn();
    const view = new SourceControlView(viewModel, { onSync, onRefresh, ...callbacks }, () => ({
        serviceName: 'GitHub',
        branch: 'main',
        vaultFolder: '',
        lastSyncTime: 0,
        lastCheckedAt: 0,
    }));
    return { view, selection, operations, refreshState, refreshSource, onSync, onRefresh };
}

/** Same as buildView, but also exposes the ChangeRepository so tests can mutate the change set mid-flight. */
function buildViewWithRepository(changes: SyncChange[], callbacks: Partial<SourceControlViewCallbacks> = {}) {
    const repository = new ChangeRepository();
    repository.replace(changes);
    const selection = new SyncSelectionStore();
    const operations = new OperationState();
    const refreshState = new RefreshState();
    const refreshSource = vi.fn().mockResolvedValue(undefined);
    const viewModel = new SourceControlViewModel(repository, selection, operations, refreshSource, refreshState);
    const onSync = callbacks.onSync ?? vi.fn();
    const onRefresh = callbacks.onRefresh ?? vi.fn();
    const view = new SourceControlView(viewModel, { onSync, onRefresh, ...callbacks }, () => ({
        serviceName: 'GitHub',
        branch: 'main',
        vaultFolder: '',
        lastSyncTime: 0,
        lastCheckedAt: 0,
    }));
    return { view, repository, selection, operations, refreshState, refreshSource, onSync, onRefresh };
}

describe('SourceControlView', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = createContainer();
    });

    describe('filter switching', () => {
        it('defaults to "Needs Sync" as a single flat tree (actionable only, synced excluded)', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'remote-only' },
                { id: toChangeId('c-3'), path: 'c.md', kind: 'conflict' },
                { id: toChangeId('c-4'), path: 'd.md', kind: 'synced' },
            ]);
            view.render(container);

            // No section grouping — every filter renders one flat tree.
            expect(container.querySelectorAll('.scv-section')).toHaveLength(0);
            // The repository region carries a single role label "Repository
            // Changes" (the active filter is shown by the chips above), with
            // the actionable row count.
            expect(container.querySelector('.scv-repository-title')?.textContent).toBe('Repository Changes');
            expect(container.querySelector('.scv-repository-count')?.textContent).toBe('3');
            // Actionable items only: synced is absent from Needs Sync.
            expect(container.querySelector('.scv-kind-synced')).toBeNull();
            expect(container.querySelectorAll('.scv-change-item')).toHaveLength(3);
        });

        it('the "All" chip composes actionable + synced rows into one tree', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'd.md', kind: 'synced' },
            ]);
            view.render(container);

            (container.querySelector('.scv-filter-option[data-filter="all"]') as HTMLButtonElement).click();

            expect(container.querySelector('.scv-repository-title')?.textContent).toBe('Repository Changes');
            expect(container.querySelector('.scv-repository-count')?.textContent).toBe('2');
            expect(container.querySelectorAll('.scv-change-item')).toHaveLength(2);
            expect(container.querySelector('.scv-kind-synced')).not.toBeNull();
        });

        it('does not render section grouping under any filter', () => {
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

            (container.querySelector('.scv-filter-option[data-filter="conflict"]') as HTMLButtonElement).click();

            expect(container.querySelectorAll('.scv-section')).toHaveLength(0);
            expect(container.querySelectorAll('.scv-change-item')).toHaveLength(1);
            expect(view.getFilter()).toBe('conflicts');
        });

        it('shows the empty state when the active filter has no items', () => {
            const { view } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);

            (container.querySelector('.scv-filter-option[data-filter="conflict"]') as HTMLButtonElement).click();

            expect(container.querySelector('.scv-empty')).not.toBeNull();
        });
    });

    describe('synced surfacing', () => {
        it('renders a Synced chip', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'd.md', kind: 'synced' },
            ]);
            view.render(container);

            expect(container.querySelector('.scv-filter-option[data-filter="synced"]')).not.toBeNull();
        });

        it('excludes synced rows from the default Needs Sync view', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'd.md', kind: 'synced' },
            ]);
            view.render(container);

            expect(container.querySelectorAll('.scv-change-item')).toHaveLength(1);
            expect(container.querySelector('.scv-kind-synced')).toBeNull();
        });

        it('shows only synced rows under the Synced chip', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'd.md', kind: 'synced' },
            ]);
            view.render(container);

            (container.querySelector('.scv-filter-option[data-filter="synced"]') as HTMLButtonElement).click();

            expect(container.querySelectorAll('.scv-change-item')).toHaveLength(1);
            expect(container.querySelector('.scv-kind-synced')).not.toBeNull();
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

        it('keeps the Changes tree scroll position after toggling a checkbox triggers a rerender', () => {
            const changes: SyncChange[] = Array.from({ length: 30 }, (_, index) => ({
                id: toChangeId(`c-${index}`),
                path: `note-${index}.md`,
                kind: 'local-only' as const,
            }));
            const { view } = buildView(changes);
            view.render(container);

            const tree = container.querySelector('.scv-changes-tree') as HTMLElement;
            tree.scrollTop = 120;

            const checkbox = container.querySelector('.scv-change-select') as HTMLInputElement;
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));

            const rerenderedTree = container.querySelector('.scv-changes-tree') as HTMLElement;
            expect(rerenderedTree.scrollTop).toBe(120);
        });

        it('deselecting removes the change from SyncSelectionStore', () => {
            const { view, selection } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            const checkbox = container.querySelector('.scv-change-select') as HTMLInputElement;
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change'));

            expect(selection.isIncluded(toChangeId('c-1'))).toBe(false);
        });

        it('renders the "Checked Changes" section only when at least one actionable change is selected', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'synced' },
            ]);

            view.render(container);
            expect(container.querySelector('.scv-selected-section')).toBeNull();

            selection.selectForSync(toChangeId('c-1'));
            view.render(container);
            const section = container.querySelector('.scv-selected-section');
            expect(section).not.toBeNull();
            expect(section?.querySelector('.scv-selected-section-title')?.textContent).toBe('Sync Queue');
            expect(section?.querySelector('.scv-selected-section-subtitle')?.textContent).toBe('1 files selected');
        });

        it('moves the selected change into Checked Changes (with a checked checkbox) and out of the lower tree', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'notes/a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'notes/b.md', kind: 'local-only' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            // The checked row lives in the Checked Changes section...
            const section = container.querySelector('.scv-selected-section') as HTMLElement;
            const queueRow = section.querySelector('.scv-change-item') as HTMLElement;
            expect(queueRow?.getAttribute('data-change-id')).toBe('c-1');
            expect(queueRow?.querySelector('.scv-change-name-text')?.textContent).toBe('a.md');
            expect(queueRow?.querySelector('.scv-badge')?.textContent).toBe('A');
            const queueCheckbox = queueRow?.querySelector('.scv-change-select') as HTMLInputElement;
            expect(queueCheckbox.checked).toBe(true);

            // ...and is NOT duplicated in the lower tree, which only keeps the
            // remaining unchecked change.
            const treeRows = container.querySelectorAll('.scv-body > .scv-change-item, .scv-tree-children .scv-change-item');
            const treeIds = Array.from(treeRows).map(el => el.getAttribute('data-change-id'));
            expect(treeIds).not.toContain('c-1');
            expect(treeIds).toContain('c-2');
        });

        it('unchecks a row in Checked Changes to move it back down into the tree', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'notes/a.md', kind: 'local-only' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            const queueCheckbox = container.querySelector('.scv-selected-section .scv-change-select') as HTMLInputElement;
            expect(queueCheckbox.checked).toBe(true);
            queueCheckbox.checked = false;
            queueCheckbox.dispatchEvent(new Event('change'));

            expect(selection.isIncluded(toChangeId('c-1'))).toBe(false);
            // The Checked Changes section is gone; the change is back in the tree.
            expect(container.querySelector('.scv-selected-section')).toBeNull();
            expect(container.querySelector('.scv-change-item[data-change-id="c-1"]')).not.toBeNull();
        });

        it('clears all selected changes at once via the Clear button in the section header', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
                { id: toChangeId('c-3'), path: 'c.md', kind: 'remote-only' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            selection.selectForSync(toChangeId('c-2'));
            selection.selectForSync(toChangeId('c-3'));
            view.render(container);

            const clearBtn = container.querySelector('.scv-selected-section-clear') as HTMLButtonElement;
            expect(clearBtn).not.toBeNull();
            clearBtn.click();

            expect(selection.isIncluded(toChangeId('c-1'))).toBe(false);
            expect(selection.isIncluded(toChangeId('c-2'))).toBe(false);
            expect(selection.isIncluded(toChangeId('c-3'))).toBe(false);
            expect(container.querySelector('.scv-selected-section')).toBeNull();
        });

        it('excludes synced changes from the Sync Queue count even when selected', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'synced' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            selection.selectForSync(toChangeId('c-2'));
            view.render(container);

            // Only the actionable local-only change makes it into the queue;
            // the synced selection is dropped from the queue's count.
            expect(container.querySelector('.scv-selected-section-subtitle')?.textContent).toBe('1 files selected');
        });
    });

    describe('collapsible sections', () => {
        it('collapses the Checked Changes section when its header is clicked, hiding its rows', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            const header = container.querySelector('.scv-selected-section-header') as HTMLElement;
            expect(header.getAttribute('aria-expanded')).toBe('true');
            expect(container.querySelector('.scv-selected-section .scv-change-item')).not.toBeNull();

            header.click();

            expect(container.querySelector('.scv-selected-section-header')?.getAttribute('aria-expanded')).toBe('false');
            expect(container.querySelector('.scv-selected-section .scv-change-item')).toBeNull();
            // The selection is unchanged — collapsing is presentation only.
            expect(selection.isIncluded(toChangeId('c-1'))).toBe(true);
        });

        it('collapses the Repository Changes tree when its header is clicked, hiding the tree', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
            ]);
            view.render(container);

            const header = container.querySelector('.scv-repository-header') as HTMLElement;
            expect(header.getAttribute('aria-expanded')).toBe('true');
            expect(container.querySelectorAll('.scv-change-item').length).toBeGreaterThan(0);

            header.click();

            expect(container.querySelector('.scv-repository-header')?.getAttribute('aria-expanded')).toBe('false');
            expect(container.querySelector('.scv-change-item')).toBeNull();
        });

        it('switching the view toggle to List does not collapse the region (toggle clicks stop propagation)', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
            ]);
            view.render(container);

            const listBtn = container.querySelector('.scv-view-toggle-btn[data-view="list"]') as HTMLButtonElement;
            listBtn.click();

            // Region stays expanded and now renders the flat list variant.
            expect(container.querySelector('.scv-repository-header')?.getAttribute('aria-expanded')).toBe('true');
            expect(container.querySelector('.scv-change-list')).not.toBeNull();
            expect(container.querySelector('.scv-view-toggle-btn[data-view="list"]')?.classList.contains('is-active')).toBe(true);
            expect(container.querySelector('.scv-view-toggle-btn[data-view="tree"]')?.classList.contains('is-active')).toBe(false);
        });
    });

    describe('view mode (Tree/List)', () => {
        it('defaults to the Tree view (folder nesting, no path suffix)', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'blog/en/a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'blog/en/b.md', kind: 'local-only' },
            ]);
            view.render(container);

            expect(container.querySelector('.scv-tree-folder')).not.toBeNull();
            expect(container.querySelector('.scv-change-list')).toBeNull();
            expect(container.querySelector('.scv-change-path')).toBeNull();
            expect(container.querySelector('.scv-view-toggle-btn[data-view="tree"]')?.classList.contains('is-active')).toBe(true);
        });

        it('List view renders a flat list with the folder path as a suffix, no folder rows', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'blog/en/a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'archive/b.md', kind: 'local-only' },
            ]);
            view.render(container);

            (container.querySelector('.scv-view-toggle-btn[data-view="list"]') as HTMLButtonElement).click();

            expect(container.querySelector('.scv-change-list')).not.toBeNull();
            expect(container.querySelector('.scv-tree-folder')).toBeNull();
            // Each row carries its folder path suffix for disambiguation.
            const paths = Array.from(container.querySelectorAll('.scv-change-item-list .scv-change-path')).map(el => el.textContent);
            expect(paths).toEqual(expect.arrayContaining(['blog/en', 'archive']));
        });

        it('persists the view mode across rerenders', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
            ]);
            view.render(container);
            (container.querySelector('.scv-view-toggle-btn[data-view="list"]') as HTMLButtonElement).click();

            view.render(container);

            expect(container.querySelector('.scv-change-list')).not.toBeNull();
        });

        it('omits the path suffix for root-level files in List view', () => {
            const { view } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);
            (container.querySelector('.scv-view-toggle-btn[data-view="list"]') as HTMLButtonElement).click();

            expect(container.querySelector('.scv-change-item-list')).not.toBeNull();
            expect(container.querySelector('.scv-change-path')).toBeNull();
        });
    });

    describe('push action', () => {
        it('calls onSync with every selected ChangeId, without touching the Git provider itself', () => {
            const onSync = vi.fn();
            const { view, selection } = buildView(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
                ],
                { onSync },
            );
            selection.selectForSync(toChangeId('c-1'));
            selection.selectForSync(toChangeId('c-2'));
            view.render(container);

            (container.querySelector('.scv-push-btn') as HTMLButtonElement).click();

            expect(onSync).toHaveBeenCalledWith([{ changeId: toChangeId('c-1'), action: undefined }, { changeId: toChangeId('c-2'), action: undefined }]);
        });

        it('disables the push button when nothing is selected', () => {
            const { view } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);

            expect((container.querySelector('.scv-push-btn') as HTMLButtonElement).disabled).toBe(true);
        });
    });

    describe('sync routing (one intent for the whole queue)', () => {
        it('hands a mixed Sync Queue to onSync as one call with every selected id, regardless of kind', () => {
            const onSync = vi.fn();
            const { view, selection } = buildView(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'remote-only' },
                ],
                { onSync },
            );
            selection.selectForSync(toChangeId('c-1'));
            selection.selectForSync(toChangeId('c-2'));
            view.render(container);

            (container.querySelector('.scv-push-btn') as HTMLButtonElement).click();

            expect(onSync).toHaveBeenCalledOnce();
            expect(onSync).toHaveBeenCalledWith([{ changeId: toChangeId('c-1'), action: undefined }, { changeId: toChangeId('c-2'), action: undefined }]);
        });

        it('hands a download-only Sync Queue to onSync too', () => {
            const onSync = vi.fn();
            const { view, selection } = buildView(
                [{ id: toChangeId('c-1'), path: 'remote.md', kind: 'remote-only' }],
                { onSync },
            );
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            (container.querySelector('.scv-push-btn') as HTMLButtonElement).click();

            expect(onSync).toHaveBeenCalledWith([{ changeId: toChangeId('c-1'), action: undefined }]);
        });

        it('hands a local-deleted change in the Sync Queue to onSync, not a separate delete callback', () => {
            const onSync = vi.fn();
            const { view, selection } = buildView(
                [{ id: toChangeId('c-1'), path: 'gone.md', kind: 'local-deleted' }],
                { onSync },
            );
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            (container.querySelector('.scv-push-btn') as HTMLButtonElement).click();

            expect(onSync).toHaveBeenCalledWith([{ changeId: toChangeId('c-1'), action: undefined }]);
        });

        it('shows Upload / Download group labels in the Sync Queue when the queue is mixed', () => {
            const { view, selection } = buildView(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'remote-only' },
                ],
            );
            selection.selectForSync(toChangeId('c-1'));
            selection.selectForSync(toChangeId('c-2'));
            view.render(container);

            const labels = Array.from(container.querySelectorAll('.scv-queue-group-label')).map(el => el.textContent);
            expect(labels).toEqual(['Upload', 'Download']);
        });

        it('omits group labels when the Sync Queue is a single operation', () => {
            const { view, selection } = buildView(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
                ],
            );
            selection.selectForSync(toChangeId('c-1'));
            selection.selectForSync(toChangeId('c-2'));
            view.render(container);

            expect(container.querySelector('.scv-queue-group-label')).toBeNull();
        });

        it('groups by the resolved action, not the kind default, when the user overrides it', () => {
            const { view, selection } = buildView(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
                ],
            );
            selection.selectForSync(toChangeId('c-1'));
            selection.selectForSync(toChangeId('c-2'));
            // Both default to push; overriding one to pull should move it into
            // Download despite sharing the same change kind as the other.
            selection.setActionOverride(toChangeId('c-2'), 'pull');
            view.render(container);

            const labels = Array.from(container.querySelectorAll('.scv-queue-group-label')).map(el => el.textContent);
            expect(labels).toEqual(['Upload', 'Download']);
        });
    });

    describe('queue row action control', () => {
        // Menu popovers append to document.body (outside `container`), so
        // each test's menu must be cleared before the next opens one.
        afterEach(() => { document.querySelectorAll('.menu').forEach(el => el.remove()); });

        it('renders the action control on a Sync Queue row but not on a Repository Changes row', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            const queueSection = container.querySelector('.scv-selected-section') as HTMLElement;
            const treeSection = container.querySelector('.scv-changes-tree') as HTMLElement;
            expect(queueSection.querySelector('.scv-change-action')).toBeTruthy();
            expect(treeSection.querySelector('.scv-change-action')).toBeNull();
        });

        it('opening the menu offers only the actions legal for the row\'s kind, checking the resolved one', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            const btn = container.querySelector('.scv-selected-section .scv-change-action') as HTMLButtonElement;
            btn.click();

            const items = Array.from(document.querySelectorAll('.menu .menu-item'));
            expect(items.map(el => el.getAttribute('data-title'))).toEqual(
                expect.arrayContaining(['Push local', 'Use remote', 'View diff', 'Remove from Sync Queue']),
            );
            const pushItem = items.find(el => el.getAttribute('data-title') === 'Push local');
            expect(pushItem?.getAttribute('data-checked')).toBe('true');
            // delete-remote isn't legal for local-modified, so it must not appear.
            expect(items.some(el => el.getAttribute('data-title') === 'Delete remote')).toBe(false);
        });

        it('choosing "Use remote" from the menu sets an override that survives to the queue grouping', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            (container.querySelector('.scv-selected-section .scv-change-action') as HTMLButtonElement).click();
            const useRemote = Array.from(document.querySelectorAll('.menu .menu-item'))
                .find(el => el.getAttribute('data-title') === 'Use remote') as HTMLElement;
            useRemote.click();

            expect(selection.getActionOverride(toChangeId('c-1'))).toBe('pull');
        });

        it('choosing "Remove from Sync Queue" deselects the row', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            (container.querySelector('.scv-selected-section .scv-change-action') as HTMLButtonElement).click();
            const remove = Array.from(document.querySelectorAll('.menu .menu-item'))
                .find(el => el.getAttribute('data-title') === 'Remove from Sync Queue') as HTMLElement;
            remove.click();

            expect(selection.isIncluded(toChangeId('c-1'))).toBe(false);
        });

        it('choosing "View diff" from the menu opens the diff instead of changing the action', () => {
            const onOpenDiff = vi.fn();
            const { view, selection } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                { onOpenDiff },
            );
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            (container.querySelector('.scv-selected-section .scv-change-action') as HTMLButtonElement).click();
            const viewDiff = Array.from(document.querySelectorAll('.menu .menu-item'))
                .find(el => el.getAttribute('data-title') === 'View diff') as HTMLElement;
            viewDiff.click();

            expect(onOpenDiff).toHaveBeenCalledWith(expect.objectContaining({ id: toChangeId('c-1') }));
        });

        it('does not render a plain Download button on a Sync Queue row (the action control supersedes it)', () => {
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'remote.md', kind: 'remote-only' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            const queueSection = container.querySelector('.scv-selected-section') as HTMLElement;
            expect(queueSection.querySelector('.scv-change-download')).toBeNull();
            expect(queueSection.querySelector('.scv-change-action')).toBeTruthy();
        });
    });

    describe('inline download action', () => {
        it('renders a Download button on a remote-only tree row and routes it to onPull', () => {
            const onPull = vi.fn();
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'remote.md', kind: 'remote-only' }],
                { onPull },
            );
            view.render(container);

            const btn = container.querySelector('.scv-changes-tree .scv-change-download') as HTMLButtonElement;
            expect(btn).toBeTruthy();
            btn.click();

            expect(onPull).toHaveBeenCalledWith([toChangeId('c-1')]);
        });

        it('does not render a Download button on a local-only row', () => {
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'local.md', kind: 'local-only' }],
                { onPull: vi.fn() },
            );
            view.render(container);

            expect(container.querySelector('.scv-change-download')).toBeNull();
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
        afterEach(() => { Platform.isMobile = false; Platform.isPhone = false; });

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

        it('renders no diff panel before the async load resolves, and exactly one once it does', async () => {
            Platform.isMobile = true;
            let resolveLoad: (value: { remote: string; local: string }) => void = () => {};
            const loadDiffContent = vi.fn().mockReturnValue(new Promise(resolve => { resolveLoad = resolve; }));
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                { loadDiffContent },
            );
            view.render(container);

            (container.querySelector('.scv-change-item') as HTMLElement).click();
            await Promise.resolve();

            expect(container.querySelector('.ssv-diff-split')).toBeNull();
            expect(container.querySelector('.ssv-diff-unified')).toBeNull();

            resolveLoad({ remote: 'remote text', local: 'local text' });
            await Promise.resolve();
            await Promise.resolve();

            expect(container.querySelectorAll('.ssv-diff-split')).toHaveLength(1);
            expect(container.querySelectorAll('.ssv-diff-unified')).toHaveLength(1);
            expect(container.querySelectorAll('.ssv-diff-hd')).toHaveLength(2);
        });

        it('does not let a stale async result render into a reopened detail view', async () => {
            Platform.isMobile = true;
            let resolveFirst: (value: { remote: string; local: string }) => void = () => {};
            const loadDiffContent = vi.fn()
                .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
                .mockResolvedValueOnce({ remote: 'second remote', local: 'second local' });
            const { view } = buildView(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
                ],
                { loadDiffContent },
            );
            view.render(container);

            (container.querySelectorAll('.scv-change-item')[0] as HTMLElement).click();
            await Promise.resolve();
            (container.querySelector('.scv-detail-back') as HTMLElement).click();
            (container.querySelectorAll('.scv-change-item')[1] as HTMLElement).click();
            await Promise.resolve();
            await Promise.resolve();

            resolveFirst({ remote: 'first remote', local: 'first local' });
            await Promise.resolve();
            await Promise.resolve();

            expect(container.textContent).not.toContain('first remote');
            expect(container.textContent).toContain('second remote');
            expect(container.querySelectorAll('.ssv-diff-split')).toHaveLength(1);
        });

        it('forces unified with no toggle on a phone regardless of session split preference', async () => {
            Platform.isMobile = true;
            Platform.isPhone = true;
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
            expect(container.querySelector('.scv-diff-layout-toggle')).toBeNull();

            Platform.isPhone = false;
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

        function statLoader(stat = { additions: 5, deletions: 0 }) {
            return vi.fn(
                (_item: SourceControlItem) => Promise.resolve({ status: 'ready' as const, stat }),
            );
        }

        it('background-loads local-only stats on render and shows them in the row', async () => {
            const loadDiffStat = statLoader();
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                { loadDiffStat },
            );
            view.render(container);
            await flush();

            expect(loadDiffStat).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local-only' }));
            expect(container.querySelector('.scv-diff-stat')?.textContent).toBe('+5');
        });

        it('background-loads two-sided (M) repository rows so they show +N/-N without being opened', async () => {
            const loadDiffStat = statLoader({ additions: 3, deletions: 2 });
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                { loadDiffStat },
            );
            view.render(container);
            await flush();

            expect(loadDiffStat).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local-modified' }));
            expect(container.querySelector('.scv-diff-stat')?.textContent).toBe('+3 -2');
        });

        it('does not re-fetch a stat that is already cached on rerender', async () => {
            const loadDiffStat = statLoader({ additions: 2, deletions: 0 });
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                { loadDiffStat },
            );
            view.render(container);
            await flush();
            expect(loadDiffStat).toHaveBeenCalledTimes(1);

            view.render(container);
            await flush();
            // The load pass skips items already in the cache, so no second fetch.
            expect(loadDiffStat).toHaveBeenCalledTimes(1);
        });

        it('a pending result is not cached, so the row retries on the next render pass', async () => {
            const stat = { additions: 4, deletions: 0 };
            const loadDiffStat = vi
                .fn()
                .mockResolvedValueOnce({ status: 'pending' })
                .mockResolvedValueOnce({ status: 'ready', stat });
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                { loadDiffStat },
            );
            view.render(container);
            await flush();
            expect(loadDiffStat).toHaveBeenCalledTimes(1);
            expect(container.querySelector('.scv-diff-stat')).toBeNull();

            view.render(container);
            await flush();
            expect(loadDiffStat).toHaveBeenCalledTimes(2);
            expect(container.querySelector('.scv-diff-stat')?.textContent).toBe('+4');
        });

        it('clears the diff stat cache on refresh so stats re-fetch', async () => {
            const loadDiffStat = statLoader();
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
            // The refresh handler clears the cache; a subsequent render re-loads.
            view.render(container);
            await flush();
            expect(loadDiffStat).toHaveBeenCalledTimes(2);
        });

        it('lazily loads a two-sided change stat on open and caches it', async () => {
            const loadDiffStat = statLoader({ additions: 1, deletions: 4 });
            const { view } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                { loadDiffStat },
            );
            view.render(container);
            await flush();
            expect(loadDiffStat).toHaveBeenCalledTimes(1);

            (container.querySelector('.scv-change-item') as HTMLElement).click();
            await flush();

            // Already background-loaded: opening the row does not re-fetch.
            expect(loadDiffStat).toHaveBeenCalledTimes(1);
            expect(container.querySelector('.scv-diff-stat')?.textContent).toBe('+1 -4');
        });

        it('eager-loads stats for selected changes of any kind so the Selected queue previews them', async () => {
            const loadDiffStat = statLoader({ additions: 2, deletions: 1 });
            const { view, selection } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-modified' }],
                { loadDiffStat },
            );
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);
            await flush();

            expect(loadDiffStat).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local-modified' }));
            expect(container.querySelector('.scv-selected-section .scv-change-item .scv-diff-stat')?.textContent).toBe('+2 -1');
        });

        it('invalidateDiffStat drops one row so only it re-fetches', async () => {
            const loadDiffStat = statLoader({ additions: 1, deletions: 0 });
            const { view } = buildView(
                [
                    { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                    { id: toChangeId('c-2'), path: 'b.md', kind: 'local-only' },
                ],
                { loadDiffStat },
            );
            view.render(container);
            await flush();
            expect(loadDiffStat).toHaveBeenCalledTimes(2);

            view.invalidateDiffStat(toChangeId('c-1'));
            view.render(container);
            await flush();

            expect(loadDiffStat).toHaveBeenCalledTimes(3);
            expect(loadDiffStat).toHaveBeenLastCalledWith(expect.objectContaining({ id: toChangeId('c-1') }));
        });
    });

    describe('mobile layout', () => {
        afterEach(() => { Platform.isMobile = false; });

        describe('Back navigation scroll restoration', () => {
            function manyModified(count: number): SyncChange[] {
                return Array.from({ length: count }, (_, index) => ({
                    id: toChangeId(`c-${index}`),
                    path: `notes/note-${index}.md`,
                    kind: 'local-modified' as const,
                }));
            }

            async function flush(): Promise<void> {
                await Promise.resolve();
                await Promise.resolve();
                await Promise.resolve();
            }

            function row(container: HTMLElement, index: number): HTMLElement {
                return container.querySelector(`.scv-change-item[data-change-id="c-${index}"]`) as HTMLElement;
            }

            it('logged regression: opening a diff and pressing Back restores the repository scroll position', async () => {
                Platform.isMobile = true;
                const { view } = buildView(manyModified(50), {
                    loadDiffContent: vi.fn().mockResolvedValue({ remote: 'remote text', local: 'local text' }),
                });
                view.render(container);

                const tree = container.querySelector('.scv-changes-tree') as HTMLElement;
                tree.scrollTop = 900;

                row(container, 35).click();
                expect(container.querySelector('.scv-detail')).not.toBeNull();

                (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();

                const restored = container.querySelector('.scv-changes-tree') as HTMLElement;
                expect(restored).not.toBeNull();
                expect(restored.scrollTop).toBe(900);
            });

            it('Tree mode preserves position across open diff → Back', async () => {
                Platform.isMobile = true;
                const { view } = buildView(manyModified(50), {
                    loadDiffContent: vi.fn().mockResolvedValue({ remote: 'r', local: 'l' }),
                });
                view.render(container);
                (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 400;

                row(container, 10).click();
                (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();

                expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(400);
            });

            it('List mode preserves position across open diff → Back', async () => {
                Platform.isMobile = true;
                const { view } = buildView(manyModified(50), {
                    loadDiffContent: vi.fn().mockResolvedValue({ remote: 'r', local: 'l' }),
                });
                view.render(container);
                (container.querySelector('.scv-view-toggle-btn[data-view="list"]') as HTMLButtonElement).click();
                (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 600;

                row(container, 20).click();
                (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();

                expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(600);
                // The list layout itself is preserved after Back.
                expect(container.querySelector('.scv-change-list')).not.toBeNull();
            });

            it('Search preserves position across open diff → Back (search query and scroll both kept)', async () => {
                Platform.isMobile = true;
                const { view } = buildView(manyModified(50), {
                    loadDiffContent: vi.fn().mockResolvedValue({ remote: 'r', local: 'l' }),
                });
                view.render(container);
                // Only rows 10-19 match the folder search.
                const searchInput = container.querySelector('.scv-search-input') as HTMLInputElement;
                searchInput.value = 'note-1';
                searchInput.dispatchEvent(new Event('input'));
                await new Promise(resolve => window.setTimeout(resolve, 200));
                (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 250;

                row(container, 12).click();
                (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();

                expect(((container.querySelector('.scv-search-input') as HTMLInputElement).value)).toBe('note-1');
                expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(250);
            });

            it('re-anchors to the clicked row after Back, so later status/stat rerenders cannot scroll it away', async () => {
                Platform.isMobile = true;
                const { view } = buildView(manyModified(50), {
                    loadDiffContent: vi.fn().mockResolvedValue({ remote: 'r', local: 'l' }),
                });
                view.render(container);
                (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 900;
                const anchorTop = row(container, 35).getBoundingClientRect().top;

                row(container, 35).click();
                (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();

                // Pixel restore ran; the anchor re-check keeps row 35 at (or
                // near) the same viewport position.
                expect(Math.abs(row(container, 35).getBoundingClientRect().top - anchorTop)).toBeLessThanOrEqual(1);
            });

            it('an async diff-stat rerender after Back does not reset the scroll position', async () => {
                Platform.isMobile = true;
                const loadDiffStat = vi.fn().mockResolvedValue({ status: 'ready', stat: { additions: 7, deletions: 3 } });
                const { view } = buildView(manyModified(50), {
                    loadDiffContent: vi.fn().mockResolvedValue({ remote: 'r', local: 'l' }),
                    loadDiffStat,
                });
                view.render(container);
                (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 900;

                row(container, 35).click();
                await flush();
                (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();
                expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(900);

                // The background stat batch lands after Back and settles a rerender.
                await flush();
                expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(900);
            });

            // Ø(est) lifecycle matrix: every rerender class on the main list
            // must keep the user's pixels; only the Back transition may
            // restore the captured navigation scroll.
            describe('rerender classes never reset scroll (δ-zombie guard)', () => {
                it('stat rerender at scroll=900 keeps 900; then Back→900, scroll to 1400, stat rerender keeps 1400', async () => {
                    Platform.isMobile = true;
                    const loadDiffStat = vi.fn().mockResolvedValue({ status: 'ready', stat: { additions: 7, deletions: 3 } });
                    const { view } = buildView(manyModified(50), { loadDiffStat });
                    view.render(container);
                    (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 900;

                    await flush();
                    view.render(container);
                    expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(900);

                    // Back transition restores the navigation capture...
                    row(container, 35).click();
                    (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();
                    expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(900);

                    // ...then the USER scrolls further; later stat settles must not yank back to 900.
                    (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 1400;
                    await flush();
                    expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(1400);
                });

                it('checkbox rerender at scroll=900 keeps 900', async () => {
                    Platform.isMobile = true;
                    const changes = manyModified(50).map(change => ({ ...change, kind: 'local-only' as const }));
                    const { view, selection } = buildView(changes);
                    view.render(container);
                    (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 900;

                    const checkbox = container.querySelector('.scv-change-select') as HTMLInputElement;
                    checkbox.checked = true;
                    checkbox.dispatchEvent(new Event('change'));
                    expect(selection.isIncluded(toChangeId('c-0'))).toBe(true);

                    expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(900);
                });

                it('a filter/menu rerender at scroll=900 keeps 900', async () => {
                    Platform.isMobile = true;
                    const { view } = buildView(manyModified(50));
                    view.render(container);
                    (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 900;

                    view.render(container);
                    expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(900);
                });

                it('a re-anchor never runs outside the Back transition (anchor left at the Back render only)', async () => {
                    Platform.isMobile = true;
                    const loadDiffStat = vi.fn().mockResolvedValue({ status: 'ready', stat: { additions: 1, deletions: 0 } });
                    const { view } = buildView(manyModified(50), { loadDiffStat });
                    view.render(container);
                    (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 900;

                    row(container, 35).click();
                    (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();
                    // The anchor was consumed by this Back render.
                    expect(view.getSelectedChangeId()).toBeNull();

                    // Any later rerender must NOT scroll back to the anchor's position.
                    (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 1400;
                    view.render(container);
                    expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(1400);
                });

                it('a clicked row that disappeared while in detail gracefully keeps the pixel position on Back', async () => {
                    Platform.isMobile = true;
                    const { view, repository } = buildViewWithRepository(manyModified(50));
                    view.render(container);
                    (container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop = 900;

                    row(container, 35).click();
                    // The change drops out while the diff is open (e.g. synced from elsewhere).
                    repository.replace(manyModified(50).filter(change => change.id !== toChangeId('c-35')));
                    (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();

                    expect((container.querySelector('.scv-changes-tree') as HTMLElement).scrollTop).toBe(900);
                });
            });

            it('backs out of the detail view preserving other presentation state (view mode, filter, search)', async () => {
                Platform.isMobile = true;
                const { view } = buildView(manyModified(50), {
                    loadDiffContent: vi.fn().mockResolvedValue({ remote: 'r', local: 'l' }),
                });
                view.render(container);
                (container.querySelector('.scv-view-toggle-btn[data-view="list"]') as HTMLButtonElement).click();
                const searchInput = container.querySelector('.scv-search-input') as HTMLInputElement;
                searchInput.value = 'note-2';
                searchInput.dispatchEvent(new Event('input'));
                await new Promise(resolve => window.setTimeout(resolve, 200));

                row(container, 21).click();
                (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();

                expect(view.getSelectedChangeId()).toBeNull();
                expect(container.querySelector('.scv-change-list')).not.toBeNull();
                expect((container.querySelector('.scv-search-input') as HTMLInputElement).value).toBe('note-2');
            });
        });

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

        it('starts the Sync Queue expanded on mobile so queued rows are visible on first render', () => {
            Platform.isMobile = true;
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'local-only' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            // Expanded by default: header + rows + subtitle all render immediately.
            const header = container.querySelector('.scv-selected-section-header') as HTMLElement;
            expect(header).not.toBeNull();
            expect(header.getAttribute('aria-expanded')).toBe('true');
            expect(container.querySelector('.scv-selected-section .scv-change-item')).not.toBeNull();
            expect(container.querySelector('.scv-selected-section-subtitle')?.textContent).toBe('1 files selected');
        });

        it('collapses the queue when the mobile header is tapped, then expands it on a second tap', () => {
            Platform.isMobile = true;
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            const header = () => container.querySelector('.scv-selected-section-header') as HTMLElement;
            header().click();
            expect(header().getAttribute('aria-expanded')).toBe('false');
            expect(container.querySelector('.scv-selected-section .scv-change-item')).toBeNull();
            expect(container.querySelector('.scv-selected-section-subtitle')).toBeNull();

            header().click();
            expect(header().getAttribute('aria-expanded')).toBe('true');
            expect(container.querySelector('.scv-selected-section .scv-change-item')).not.toBeNull();
            expect(container.querySelector('.scv-selected-section-subtitle')).not.toBeNull();
        });

        it('a collapsed mobile queue renders no rows and background-loads no diff stats for them', async () => {
            Platform.isMobile = true;
            const loadDiffStat = vi.fn().mockResolvedValue({ status: 'unavailable' });
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
            ], { loadDiffStat });
            // The queue's stat is cached from the initial expanded render...
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);
            await Promise.resolve();
            view.invalidateDiffStat(toChangeId('c-1'));
            loadDiffStat.mockClear();

            // ...then collapsing the queue must not re-fetch it.
            (container.querySelector('.scv-selected-section-header') as HTMLElement).click();
            await Promise.resolve();

            const loadedIds = loadDiffStat.mock.calls.map(call => (call[0] as { id: string }).id);
            expect(loadedIds).not.toContain('c-1');

            // Expanding the queue loads its rows' stats.
            (container.querySelector('.scv-selected-section-header') as HTMLElement).click();
            await Promise.resolve();
            expect(loadDiffStat.mock.calls.map(call => (call[0] as { id: string }).id)).toContain('c-1');
        });

        it('preserves the mobile queue collapsed state across open diff → Back', () => {
            Platform.isMobile = true;
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'local-modified' },
            ], { loadDiffContent: vi.fn().mockResolvedValue({ remote: 'r', local: 'l' }) });
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            (container.querySelector('.scv-selected-section-header') as HTMLElement).click();
            expect(container.querySelector('.scv-selected-section-header')?.getAttribute('aria-expanded')).toBe('false');

            // Open a repository row's diff and come back; the queue stays collapsed.
            const repoRow = container.querySelector('.scv-changes-tree .scv-change-item[data-change-id="c-2"]') as HTMLElement;
            repoRow.click();
            expect(container.querySelector('.scv-detail')).not.toBeNull();
            (container.querySelector('.scv-detail-back') as HTMLButtonElement).click();

            expect(container.querySelector('.scv-selected-section-header')?.getAttribute('aria-expanded')).toBe('false');
            expect(container.querySelector('.scv-selected-section .scv-change-item')).toBeNull();
        });

        it('hides the header push button and shows a sticky bottom sync bar on mobile when there is a selection', () => {
            Platform.isMobile = true;
            const { view, selection } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
            ]);
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            expect(container.querySelector('.scv-push-btn')).toBeNull();
            expect(container.querySelector('.scv-mobile-sync-bar')).not.toBeNull();
            expect(container.querySelector('.scv-mobile-sync-label')?.textContent).toBe('1 files selected');
        });

        it('omits the mobile bottom sync bar when nothing is selected for push', () => {
            Platform.isMobile = true;
            const { view } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            view.render(container);

            expect(container.querySelector('.scv-mobile-sync-bar')).toBeNull();
        });

        it('triggers onSync from the mobile bottom sync bar button', () => {
            Platform.isMobile = true;
            const onSync = vi.fn();
            const { view, selection } = buildView(
                [{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }],
                { onSync },
            );
            selection.selectForSync(toChangeId('c-1'));
            view.render(container);

            (container.querySelector('.scv-mobile-sync-btn') as HTMLButtonElement).click();

            expect(onSync).toHaveBeenCalledWith([{ changeId: toChangeId('c-1'), action: undefined }]);
        });
    });

    describe('header info strip', () => {
        function buildViewWithInfo(lastCheckedAt: number) {
            const repository = new ChangeRepository();
            repository.replace([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            const refreshState = new RefreshState();
            const viewModel = new SourceControlViewModel(
                repository,
                new SyncSelectionStore(),
                new OperationState(),
                vi.fn().mockResolvedValue(undefined),
                refreshState,
            );
            const view = new SourceControlView(
                viewModel,
                { onSync: vi.fn(), onRefresh: vi.fn() },
                () => ({ serviceName: 'GitHub', branch: 'main', vaultFolder: '', lastSyncTime: 0, lastCheckedAt }),
            );
            return { view, refreshState };
        }

        it('omits the "Last checked" line before the first refresh (lastCheckedAt = 0)', () => {
            const { view } = buildViewWithInfo(0);
            view.render(container);

            const infoTimes = container.querySelectorAll('.scv-info-time');
            // Only the "Never synced" line is present; no "Last checked" line.
            expect(infoTimes).toHaveLength(1);
            expect(infoTimes[0]?.textContent).toBe('Never synced');
        });

        it('shows "Last checked: just now" when the last refresh was within a minute', () => {
            const { view } = buildViewWithInfo(Date.now());
            view.render(container);

            const infoTimes = container.querySelectorAll('.scv-info-time');
            expect(infoTimes).toHaveLength(2);
            expect(infoTimes[1]?.textContent).toBe('Last checked: just now');
        });

        it('shows "Last checked: <time>" when the last refresh was over a minute ago', () => {
            const { view } = buildViewWithInfo(Date.now() - 120_000);
            view.render(container);

            const infoTimes = container.querySelectorAll('.scv-info-time');
            expect(infoTimes).toHaveLength(2);
            expect(infoTimes[1]?.textContent).toContain('Last checked:');
            expect(infoTimes[1]?.textContent).not.toBe('Last checked: just now');
        });
    });
});
