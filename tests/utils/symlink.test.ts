import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App, FileSystemAdapter, Platform } from 'obsidian';
import { canUseRealSymlinks, readLocalSymlinkTarget, createLocalSymlink } from '../../src/utils/symlink';

vi.mock('obsidian');

interface FakeFs {
    lstatSync: ReturnType<typeof vi.fn>;
    statSync: ReturnType<typeof vi.fn>;
    readlinkSync: ReturnType<typeof vi.fn>;
    existsSync: ReturnType<typeof vi.fn>;
    mkdirSync: ReturnType<typeof vi.fn>;
    rmSync: ReturnType<typeof vi.fn>;
    symlinkSync: ReturnType<typeof vi.fn>;
}

describe('symlink utils', () => {
    let app: App;
    let fakeFs: FakeFs;
    const fakePath = {
        join: (...parts: string[]) => parts.join('/'),
        dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
        isAbsolute: (p: string) => p.startsWith('/'),
    };

    beforeEach(() => {
        Platform.isDesktopApp = true;

        app = new App();
        app.vault.adapter = new FileSystemAdapter();

        fakeFs = {
            lstatSync: vi.fn().mockReturnValue({ isSymbolicLink: () => false }),
            statSync: vi.fn().mockReturnValue({ isDirectory: () => false }),
            readlinkSync: vi.fn().mockReturnValue(''),
            existsSync: vi.fn().mockReturnValue(false),
            mkdirSync: vi.fn(),
            rmSync: vi.fn(),
            symlinkSync: vi.fn(),
        };

        (window as unknown as { require: (id: string) => unknown }).require = (id: string) =>
            id === 'fs' ? fakeFs : fakePath;
    });

    afterEach(() => {
        delete (window as unknown as { require?: unknown }).require;
    });

    describe('canUseRealSymlinks', () => {
        it('is true on desktop with a FileSystemAdapter', () => {
            expect(canUseRealSymlinks(app)).toBe(true);
        });

        it('is false when not a desktop app', () => {
            Platform.isDesktopApp = false;
            expect(canUseRealSymlinks(app)).toBe(false);
        });

        it('is false when the adapter is not a FileSystemAdapter', () => {
            app.vault.adapter = {} as FileSystemAdapter;
            expect(canUseRealSymlinks(app)).toBe(false);
        });
    });

    describe('readLocalSymlinkTarget', () => {
        it('returns the raw target for a symlink', () => {
            fakeFs.lstatSync.mockReturnValue({ isSymbolicLink: () => true });
            fakeFs.readlinkSync.mockReturnValue('../target');

            expect(readLocalSymlinkTarget(app, 'skills/blog-master')).toBe('../target');
        });

        it('returns null for a non-symlink path', () => {
            fakeFs.lstatSync.mockReturnValue({ isSymbolicLink: () => false });
            expect(readLocalSymlinkTarget(app, 'notes/plain.md')).toBeNull();
        });

        it('returns null when real symlinks are unavailable', () => {
            Platform.isDesktopApp = false;
            expect(readLocalSymlinkTarget(app, 'skills/blog-master')).toBeNull();
        });
    });

    describe('createLocalSymlink', () => {
        it('creates a "dir" symlink when the target resolves to a directory', () => {
            fakeFs.statSync.mockReturnValue({ isDirectory: () => true });

            const result = createLocalSymlink(app, 'skills/blog-master', '../blog/src');

            expect(result).toBe(true);
            expect(fakeFs.symlinkSync).toHaveBeenCalledWith('../blog/src', expect.any(String), 'dir');
        });

        it('creates a "file" symlink when the target resolves to a file', () => {
            fakeFs.statSync.mockReturnValue({ isDirectory: () => false });

            createLocalSymlink(app, 'notes/link.md', '../shared/note.md');

            expect(fakeFs.symlinkSync).toHaveBeenCalledWith('../shared/note.md', expect.any(String), 'file');
        });

        it('falls back to "file" when the target cannot be stat-ed (dangling link)', () => {
            fakeFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

            createLocalSymlink(app, 'notes/link.md', '../missing.md');

            expect(fakeFs.symlinkSync).toHaveBeenCalledWith('../missing.md', expect.any(String), 'file');
        });

        it('removes an existing file or stale link before creating the new one', () => {
            fakeFs.existsSync.mockReturnValue(true);

            createLocalSymlink(app, 'notes/link.md', '../shared/note.md');

            expect(fakeFs.rmSync).toHaveBeenCalledWith(expect.any(String), { force: true });
            expect(fakeFs.symlinkSync).toHaveBeenCalled();
        });

        it('returns false when real symlinks are unavailable', () => {
            Platform.isDesktopApp = false;
            expect(createLocalSymlink(app, 'notes/link.md', '../shared/note.md')).toBe(false);
            expect(fakeFs.symlinkSync).not.toHaveBeenCalled();
        });
    });
});
