import { App, FileSystemAdapter, Platform } from 'obsidian';
import { logger } from './logger';

/**
 * Desktop-only helpers for real OS symbolic links.
 *
 * Obsidian exposes no symlink API, so on desktop (Electron) we reach for Node's
 * `fs` via the global CommonJS `require`. None of this is available on mobile,
 * so every entry point is guarded by `canUseRealSymlinks()` and callers must
 * fall back to content-based syncing when it returns false.
 */

// Minimal shapes of the Node APIs we use, so we don't statically import the
// builtins (they don't exist in the mobile bundle).
interface NodeFs {
    lstatSync(p: string): { isSymbolicLink(): boolean };
    statSync(p: string): { isDirectory(): boolean };
    readlinkSync(p: string): string;
    existsSync(p: string): boolean;
    mkdirSync(p: string, opts: { recursive: boolean }): void;
    rmSync(p: string, opts: { force: boolean }): void;
    symlinkSync(target: string, p: string, type?: string): void;
}

interface NodePath {
    join(...parts: string[]): string;
    dirname(p: string): string;
    isAbsolute(p: string): boolean;
}

type NodeRequire = (id: string) => unknown;

export function canUseRealSymlinks(app: App): boolean {
    return typeof Platform !== 'undefined' && Platform.isDesktopApp
        && typeof FileSystemAdapter === 'function' && app.vault.adapter instanceof FileSystemAdapter;
}

// Electron exposes a CommonJS `require` on the global object on desktop; it is
// absent on mobile. Resolving it dynamically avoids a static node import.
function nodeModules(): { fs: NodeFs; path: NodePath } | null {
    const req = (window as unknown as { require?: NodeRequire }).require;
    if (typeof req !== 'function') return null;
    try {
        return { fs: req('fs') as NodeFs, path: req('path') as NodePath };
    } catch {
        return null;
    }
}

function absolutePath(app: App, vaultPath: string, path: NodePath): string | null {
    const adapter = app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return null;
    return path.join(adapter.getBasePath(), vaultPath);
}

/**
 * Returns the raw target of a local symlink, or null if the path is not a
 * symlink (or real symlinks aren't supported on this platform).
 */
export function readLocalSymlinkTarget(app: App, vaultPath: string): string | null {
    if (!canUseRealSymlinks(app)) return null;
    const mods = nodeModules();
    if (!mods) return null;
    try {
        const abs = absolutePath(app, vaultPath, mods.path);
        if (!abs) return null;
        if (!mods.fs.lstatSync(abs).isSymbolicLink()) return null;
        return mods.fs.readlinkSync(abs);
    } catch (e) {
        logger.warn(`Failed to read local symlink ${vaultPath}`, e);
        return null;
    }
}

/**
 * Creates (or replaces) a real OS symlink at vaultPath pointing to target.
 * Returns true on success, false if it couldn't be created (caller should then
 * fall back to writing the target content as a normal file).
 */
export function createLocalSymlink(app: App, vaultPath: string, target: string): boolean {
    if (!canUseRealSymlinks(app)) return false;
    const mods = nodeModules();
    if (!mods) return false;
    try {
        const abs = absolutePath(app, vaultPath, mods.path);
        if (!abs) return false;
        mods.fs.mkdirSync(mods.path.dirname(abs), { recursive: true });
        // Replace whatever is there (a stale file or an outdated link). existsSync
        // follows links, so check lstat too in case of a dangling link.
        if (mods.fs.existsSync(abs) || isSymlink(mods.fs, abs)) {
            mods.fs.rmSync(abs, { force: true });
        }
        mods.fs.symlinkSync(target, abs, symlinkType(mods, abs, target));
        return true;
    } catch (e) {
        logger.warn(`Failed to create local symlink ${vaultPath} -> ${target}`, e);
        return false;
    }
}

function isSymlink(fs: NodeFs, abs: string): boolean {
    try {
        return fs.lstatSync(abs).isSymbolicLink();
    } catch {
        return false;
    }
}

// Node's `type` hint to symlinkSync is a no-op on POSIX but required on
// Windows: omitting it defaults to 'file', which produces a broken link
// whenever the target is actually a directory (as with a symlinked folder).
function symlinkType(mods: { fs: NodeFs; path: NodePath }, abs: string, target: string): 'file' | 'dir' {
    try {
        const resolvedTarget = mods.path.isAbsolute(target)
            ? target
            : mods.path.join(mods.path.dirname(abs), target);
        return mods.fs.statSync(resolvedTarget).isDirectory() ? 'dir' : 'file';
    } catch {
        return 'file';
    }
}
