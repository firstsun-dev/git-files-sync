import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderFileItem, statusMeta, type FileItemCallbacks } from '../../src/ui/components/FileListItem';
import type { FileStatus } from '../../src/ui/types';
import { TFile, Platform } from 'obsidian';
import { setupObsidianDOM, createContainer } from './setup-dom';

beforeAll(() => { setupObsidianDOM(); });

const mockFile = Object.assign(new TFile(), { path: 'docs/test.md' });

function makeFileStatus(status: FileStatus['status'], overrides?: Partial<FileStatus>): FileStatus {
    return { path: 'docs/test.md', status, ...overrides };
}

describe('statusMeta', () => {
    it.each([
        ['synced',      'check',      'Synced',     'status-synced'],
        ['modified',    'pencil',     'Changed',    'status-modified'],
        ['unsynced',    'arrow-up',   'Local only', 'status-unsynced'],
        ['remote-only', 'arrow-down', 'Remote',     'status-remote'],
        ['checking',    'refresh-cw', 'Checking',   'status-checking'],
    ] as const)('%s: returns correct icon, label, and fileCls', (status, icon, label, fileCls) => {
        const meta = statusMeta(status);
        expect(meta.icon).toBe(icon);
        expect(meta.label).toBe(label);
        expect(meta.fileCls).toBe(fileCls);
    });

    it('returns distinct CSS classes for each status', () => {
        const statuses = ['synced', 'modified', 'unsynced', 'remote-only', 'checking'] as const;
        const badgeCls = statuses.map(s => statusMeta(s).badgeCls);
        expect(new Set(badgeCls).size).toBe(statuses.length);
    });
});

describe('renderFileItem', () => {
    let container: HTMLElement;
    let callbacks: FileItemCallbacks;

    beforeEach(() => {
        container = createContainer();
        callbacks = {
            onSelect: vi.fn(),
            onPush:   vi.fn(),
            onPull:   vi.fn(),
            onDelete: vi.fn(),
            onExpandDiff: vi.fn().mockResolvedValue(undefined),
            onOpen:   vi.fn().mockReturnValue(true),
            canOpen:  vi.fn().mockReturnValue(true),
            onOpenDiffPane: vi.fn(),
            onRevertMove: vi.fn(),
        };
    });

    it('renders file path', () => {
        renderFileItem(container, makeFileStatus('synced'), false, callbacks);
        expect(container.querySelector('.ssv-file-path')?.textContent).toBe('docs/test.md');
    });

    it('renders status badge with correct label', () => {
        renderFileItem(container, makeFileStatus('modified'), false, callbacks);
        expect(container.querySelector('.ssv-status-badge')?.textContent).toBe('Changed');
    });

    it('checkbox reflects isSelected=true', () => {
        renderFileItem(container, makeFileStatus('synced'), true, callbacks);
        expect((container.querySelector('.ssv-file-checkbox') as HTMLInputElement).checked).toBe(true);
    });

    it('checkbox reflects isSelected=false', () => {
        renderFileItem(container, makeFileStatus('synced'), false, callbacks);
        expect((container.querySelector('.ssv-file-checkbox') as HTMLInputElement).checked).toBe(false);
    });

    it('calls onSelect(path, true) when checkbox checked', () => {
        renderFileItem(container, makeFileStatus('synced'), false, callbacks);
        const cb = container.querySelector('.ssv-file-checkbox') as HTMLInputElement;
        cb.checked = true;
        cb.dispatchEvent(new Event('change'));
        expect(callbacks.onSelect).toHaveBeenCalledWith('docs/test.md', true);
    });

    it('calls onSelect(path, false) when checkbox unchecked', () => {
        renderFileItem(container, makeFileStatus('synced'), true, callbacks);
        const cb = container.querySelector('.ssv-file-checkbox') as HTMLInputElement;
        cb.checked = false;
        cb.dispatchEvent(new Event('change'));
        expect(callbacks.onSelect).toHaveBeenCalledWith('docs/test.md', false);
    });

    describe('synced file', () => {
        it('renders no action buttons', () => {
            renderFileItem(container, makeFileStatus('synced'), false, callbacks);
            expect(container.querySelector('.ssv-file-actions')).toBeNull();
        });
    });

    describe('checking file', () => {
        it('renders no action buttons', () => {
            renderFileItem(container, makeFileStatus('checking'), false, callbacks);
            expect(container.querySelector('.ssv-file-actions')).toBeNull();
        });
    });

    describe('modified file', () => {
        it('renders push and pull buttons when file exists', () => {
            const fs = makeFileStatus('modified', { file: mockFile });
            renderFileItem(container, fs, false, callbacks);
            expect(container.querySelector('.ssv-action-btn.push')).not.toBeNull();
            expect(container.querySelector('.ssv-action-btn.pull')).not.toBeNull();
        });

        it('calls onPush with fileStatus when push clicked', () => {
            const fs = makeFileStatus('modified', { file: mockFile });
            renderFileItem(container, fs, false, callbacks);
            (container.querySelector('.ssv-action-btn.push') as HTMLButtonElement).click();
            expect(callbacks.onPush).toHaveBeenCalledWith(fs);
        });

        it('calls onPull with fileStatus when pull clicked', () => {
            const fs = makeFileStatus('modified', { file: mockFile });
            renderFileItem(container, fs, false, callbacks);
            (container.querySelector('.ssv-action-btn.pull') as HTMLButtonElement).click();
            expect(callbacks.onPull).toHaveBeenCalledWith(fs);
        });

        it('renders a diff button for any modified file, even without preloaded content', () => {
            const fs = makeFileStatus('modified', { file: mockFile });
            renderFileItem(container, fs, false, callbacks);
            expect(container.querySelector('.ssv-action-btn.diff')).not.toBeNull();
        });
    });

    describe('moved file with content changes', () => {
        it('renders a diff button so the moved file can be compared with its old remote path', () => {
            const fs = makeFileStatus('moved', {
                file: mockFile,
                movedFrom: 'docs/old-name.md',
                remoteSha: 'old-content-sha',
            });

            renderFileItem(container, fs, false, callbacks);

            expect(container.querySelector('.ssv-action-btn.diff')).not.toBeNull();
        });
    });

    // The inline panel is stuck at sidebar width, so desktop sends the diff to
    // its own pane instead and never renders the inline one.
    describe('modified file: desktop diff pane', () => {
        it('asks for a diff pane instead of expanding inline', () => {
            const fs = makeFileStatus('modified', { localContent: 'b', remoteContent: 'a' });
            renderFileItem(container, fs, false, callbacks);
            (container.querySelector('.ssv-action-btn.diff') as HTMLButtonElement).click();
            expect(callbacks.onOpenDiffPane).toHaveBeenCalledWith(fs);
        });

        it('renders no inline diff panel', () => {
            const fs = makeFileStatus('modified', { localContent: 'b', remoteContent: 'a' });
            renderFileItem(container, fs, false, callbacks);
            expect(container.querySelector('.ssv-diff')).toBeNull();
        });
    });

    describe('modified file: mobile inline diff', () => {
        beforeEach(() => { Platform.isMobile = true; });
        afterEach(() => { Platform.isMobile = false; });

        it('does not ask for a diff pane', () => {
            const fs = makeFileStatus('modified', { localContent: 'b', remoteContent: 'a' });
            renderFileItem(container, fs, false, callbacks);
            (container.querySelector('.ssv-action-btn.diff') as HTMLButtonElement).click();
            expect(callbacks.onOpenDiffPane).not.toHaveBeenCalled();
        });

        it('diff panel is not visible before toggle', () => {
            const fs = makeFileStatus('modified', { localContent: 'b', remoteContent: 'a' });
            renderFileItem(container, fs, false, callbacks);
            expect(container.querySelector('.ssv-diff')?.classList.contains('visible')).toBe(false);
        });

        it('diff panel becomes visible on first click', () => {
            const fs = makeFileStatus('modified', { localContent: 'b', remoteContent: 'a' });
            renderFileItem(container, fs, false, callbacks);
            (container.querySelector('.ssv-action-btn.diff') as HTMLButtonElement).click();
            expect(container.querySelector('.ssv-diff')?.classList.contains('visible')).toBe(true);
        });

        it('diff panel hides on second click', () => {
            const fs = makeFileStatus('modified', { localContent: 'b', remoteContent: 'a' });
            renderFileItem(container, fs, false, callbacks);
            const btn = container.querySelector('.ssv-action-btn.diff') as HTMLButtonElement;
            btn.click();
            btn.click();
            expect(container.querySelector('.ssv-diff')?.classList.contains('visible')).toBe(false);
        });

        it('diff button label toggles between " Diff" and " Hide"', () => {
            const fs = makeFileStatus('modified', { localContent: 'b', remoteContent: 'a' });
            renderFileItem(container, fs, false, callbacks);
            const btn = container.querySelector('.ssv-action-btn.diff') as HTMLButtonElement;
            const label = btn.querySelector('.ssv-btn-label') as HTMLElement;
            expect(label.textContent).toBe(' Diff');
            btn.click();
            expect(label.textContent).toBe(' Hide');
            btn.click();
            expect(label.textContent).toBe(' Diff');
        });

        it('renders preloaded diff content immediately without fetching', () => {
            const fs = makeFileStatus('modified', { localContent: 'b', remoteContent: 'a' });
            renderFileItem(container, fs, false, callbacks);
            (container.querySelector('.ssv-action-btn.diff') as HTMLButtonElement).click();
            expect(container.querySelector('.ssv-diff-grid')).not.toBeNull();
            expect(callbacks.onExpandDiff).not.toHaveBeenCalled();
        });

        it('shows a loading placeholder and fetches content on demand when not preloaded', () => {
            const fs = makeFileStatus('modified', { file: mockFile, remoteSha: 'abc123' });
            renderFileItem(container, fs, false, callbacks);
            (container.querySelector('.ssv-action-btn.diff') as HTMLButtonElement).click();
            expect(callbacks.onExpandDiff).toHaveBeenCalledWith(fs);
        });

        it('shows a symlink message instead of a text diff for symlink entries', async () => {
            const fs = makeFileStatus('modified', { file: mockFile, remoteSha: 'abc123', isSymlink: true });
            renderFileItem(container, fs, false, callbacks);
            (container.querySelector('.ssv-action-btn.diff') as HTMLButtonElement).click();
            expect(container.querySelector('.ssv-diff-binary')?.textContent).toBe('Symlink target changed');
            expect(callbacks.onExpandDiff).not.toHaveBeenCalled();
        });
    });

    describe('unsynced file', () => {
        it('renders push button when file exists', () => {
            const fs = makeFileStatus('unsynced', { file: mockFile });
            renderFileItem(container, fs, false, callbacks);
            expect(container.querySelector('.ssv-action-btn.push')).not.toBeNull();
        });

        it('renders delete button when file exists', () => {
            const fs = makeFileStatus('unsynced', { file: mockFile });
            renderFileItem(container, fs, false, callbacks);
            expect(container.querySelector('.ssv-action-btn.danger')).not.toBeNull();
        });

        it('does not render pull button', () => {
            const fs = makeFileStatus('unsynced', { file: mockFile });
            renderFileItem(container, fs, false, callbacks);
            expect(container.querySelector('.ssv-action-btn.pull')).toBeNull();
        });

        it('calls onDelete with fileStatus when delete clicked', () => {
            const fs = makeFileStatus('unsynced', { file: mockFile });
            renderFileItem(container, fs, false, callbacks);
            (container.querySelector('.ssv-action-btn.danger') as HTMLButtonElement).click();
            expect(callbacks.onDelete).toHaveBeenCalledWith(fs);
        });
    });

    describe('remote-only file', () => {
        it('renders pull button', () => {
            const fs = makeFileStatus('remote-only');
            renderFileItem(container, fs, false, callbacks);
            expect(container.querySelector('.ssv-action-btn.pull')).not.toBeNull();
        });

        it('does not render push button', () => {
            const fs = makeFileStatus('remote-only');
            renderFileItem(container, fs, false, callbacks);
            expect(container.querySelector('.ssv-action-btn.push')).toBeNull();
        });

        it('calls onPull with fileStatus when pull clicked', () => {
            const fs = makeFileStatus('remote-only');
            renderFileItem(container, fs, false, callbacks);
            (container.querySelector('.ssv-action-btn.pull') as HTMLButtonElement).click();
            expect(callbacks.onPull).toHaveBeenCalledWith(fs);
        });
    });
});
