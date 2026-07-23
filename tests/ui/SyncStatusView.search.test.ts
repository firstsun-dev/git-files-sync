import { describe, it, expect, vi, beforeAll } from 'vitest';
import { SyncStatusView } from '../../src/ui/SyncStatusView';
import { WorkspaceLeaf } from 'obsidian';
import type GitLabFilesPush from '../../src/main';
import { setupObsidianDOM } from './setup-dom';
import type { FileStatus, FilterValue } from '../../src/ui/types';

function makeView(statuses: FileStatus[]): SyncStatusView {
    const plugin = {
        settings: { branch: 'main', vaultFolder: '', rootPath: '' },
        gitService: {},
        getNormalizedPath: (p: string) => p,
    } as unknown as GitLabFilesPush;
    const leaf = {
        app: {
            workspace: { getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn() }) },
            vault: {
                getFileByPath: vi.fn().mockReturnValue(null),
                adapter: { exists: vi.fn().mockResolvedValue(false) },
            },
        },
    } as unknown as WorkspaceLeaf;

    const view = new SyncStatusView(leaf, plugin);
    const map = (view as unknown as { fileStatuses: Map<string, FileStatus> }).fileStatuses;
    for (const s of statuses) map.set(s.path, s);
    return view;
}

type Internals = {
    searchQuery: string;
    statusFilter: FilterValue;
    selectedFiles: Set<string>;
    searchedStatuses(): FileStatus[];
    visibleStatuses(): FileStatus[];
};

const internals = (view: SyncStatusView): Internals => view as unknown as Internals;

const SAMPLE: FileStatus[] = [
    { path: 'Notes/Projects/alpha.md', status: 'modified' },
    { path: 'Notes/Projects/beta.md',  status: 'unsynced' },
    { path: 'Notes/daily.md',          status: 'synced' },
    { path: 'Archive/PROJECT-old.md',  status: 'remote-only' },
    { path: 'readme.md',               status: 'synced' },
];

describe('SyncStatusView search filter', () => {
    beforeAll(() => { setupObsidianDOM(); });

    it('returns everything when the query is empty', () => {
        const view = makeView(SAMPLE);
        expect(internals(view).searchedStatuses()).toHaveLength(SAMPLE.length);
    });

    it('matches a case-insensitive substring of the path', () => {
        const view = makeView(SAMPLE);
        internals(view).searchQuery = 'project';

        expect(internals(view).searchedStatuses().map(s => s.path)).toEqual([
            'Notes/Projects/alpha.md',
            'Notes/Projects/beta.md',
            'Archive/PROJECT-old.md',
        ]);
    });

    // Matching the full path rather than the basename is what makes a folder
    // prefix usable as a folder filter.
    it('treats a folder prefix as a folder filter', () => {
        const view = makeView(SAMPLE);
        internals(view).searchQuery = 'Notes/Projects/';

        expect(internals(view).searchedStatuses().map(s => s.path)).toEqual([
            'Notes/Projects/alpha.md',
            'Notes/Projects/beta.md',
        ]);
    });

    it('does not match on a subsequence the way fuzzy matching would', () => {
        const view = makeView(SAMPLE);
        internals(view).searchQuery = 'npa';

        expect(internals(view).searchedStatuses()).toEqual([]);
    });

    it('applies the search and the status tab together', () => {
        const view = makeView(SAMPLE);
        internals(view).searchQuery = 'project';
        internals(view).statusFilter = 'unsynced';

        expect(internals(view).visibleStatuses().map(s => s.path)).toEqual(['Notes/Projects/beta.md']);
    });

    it('narrows visible rows to the search even on the all tab', () => {
        const view = makeView(SAMPLE);
        internals(view).statusFilter = 'all';
        internals(view).searchQuery = 'readme';

        expect(internals(view).visibleStatuses().map(s => s.path)).toEqual(['readme.md']);
    });
});

describe('SyncStatusView search box wiring', () => {
    beforeAll(() => { setupObsidianDOM(); });

    async function openWithSearch(statuses: FileStatus[]): Promise<{
        view: SyncStatusView;
        input: HTMLInputElement;
        root: HTMLElement;
    }> {
        const view = makeView(statuses);
        await view.onOpen();
        const root = view.containerEl.children[1] as HTMLElement;
        const input = root.querySelector('.ssv-search-input') as HTMLInputElement;
        return { view, input, root };
    }

    function type(input: HTMLInputElement, value: string): void {
        input.value = value;
        input.dispatchEvent(new Event('input'));
    }

    it('keeps the focused search input alive across a re-render', async () => {
        const { view, input, root } = await openWithSearch(SAMPLE);
        expect(input).toBeTruthy();

        document.body.appendChild(view.containerEl);
        input.focus();
        expect(document.activeElement).toBe(input);

        // renderView() rebuilds the body on every interaction; the input lives
        // in the header precisely so it is not destroyed and does not lose
        // focus after a single character.
        (view as unknown as { renderView(): void }).renderView();

        expect(root.querySelector('.ssv-search-input')).toBe(input);
        expect(document.activeElement).toBe(input);
    });

    it('applies the typed query to the visible rows after the debounce', async () => {
        vi.useFakeTimers();
        try {
            const { view, input } = await openWithSearch(SAMPLE);
            type(input, 'daily');

            expect(internals(view).searchQuery).toBe('');
            vi.advanceTimersByTime(200);

            expect(internals(view).searchQuery).toBe('daily');
            expect(internals(view).visibleStatuses().map(s => s.path)).toEqual(['Notes/daily.md']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('clears the selection when the query changes', async () => {
        vi.useFakeTimers();
        try {
            const { view, input } = await openWithSearch(SAMPLE);
            internals(view).selectedFiles.add('Notes/daily.md');
            internals(view).selectedFiles.add('readme.md');

            type(input, 'project');
            vi.advanceTimersByTime(200);

            // Selection can't outlive a change to what's on screen, or the
            // action bar would count files the user can no longer see.
            expect(internals(view).selectedFiles.size).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('resets the filter on Escape', async () => {
        vi.useFakeTimers();
        try {
            const { view, input } = await openWithSearch(SAMPLE);
            type(input, 'project');
            vi.advanceTimersByTime(200);
            expect(internals(view).searchQuery).toBe('project');

            input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

            expect(input.value).toBe('');
            expect(internals(view).searchQuery).toBe('');
        } finally {
            vi.useRealTimers();
        }
    });

    it('shows the clear button only while a query is active', async () => {
        vi.useFakeTimers();
        try {
            const { input, root } = await openWithSearch(SAMPLE);
            const row = root.querySelector('.ssv-search') as HTMLElement;
            expect(row.classList.contains('has-query')).toBe(false);

            type(input, 'project');
            vi.advanceTimersByTime(200);

            expect(row.classList.contains('has-query')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
