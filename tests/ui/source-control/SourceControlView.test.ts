import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { SourceControlView, type SourceControlViewCallbacks } from '../../../src/ui/source-control/SourceControlView';
import { ChangeRepository } from '../../../src/logic/source-control/ChangeRepository';
import { OperationState } from '../../../src/logic/source-control/OperationState';
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
    const viewModel = new SourceControlViewModel(repository, selection, operations);
    const onPush = callbacks.onPush ?? vi.fn();
    const view = new SourceControlView(viewModel, selection, { onPush, ...callbacks });
    return { view, selection, operations, onPush };
}

describe('SourceControlView', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = createContainer();
    });

    describe('filter switching', () => {
        it('groups changes into their sections under the "all" filter', () => {
            const { view } = buildView([
                { id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' },
                { id: toChangeId('c-2'), path: 'b.md', kind: 'remote-only' },
                { id: toChangeId('c-3'), path: 'c.md', kind: 'conflict' },
                { id: toChangeId('c-4'), path: 'd.md', kind: 'synced' },
            ]);
            view.render(container);

            const sectionTitles = Array.from(container.querySelectorAll('.scv-section-title')).map(el => el.textContent);
            expect(sectionTitles).toEqual(['CHANGES', 'REMOTE CHANGES', 'CONFLICTS', 'SYNCED']);
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

        it('shows no indicator once the operation is idle again', () => {
            const { view, operations } = buildView([{ id: toChangeId('c-1'), path: 'a.md', kind: 'local-only' }]);
            operations.start(toChangeId('c-1'));
            operations.reset(toChangeId('c-1'));
            view.render(container);

            expect(container.querySelector('.scv-op-indicator')).toBeNull();
        });
    });

    describe('diff selection', () => {
        it('loads and renders diff content for the clicked change', async () => {
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
            // Reuses the existing diff panel renderer (Phase 3 spec: don't rewrite diff UI), which uses its own 'ssv-' class prefix.
            expect(container.querySelector('.ssv-diff-split')).not.toBeNull();
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
});
