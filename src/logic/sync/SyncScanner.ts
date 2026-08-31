import { TFile, type App } from 'obsidian';
import type { GitLabFilesPushSettings } from '../../settings';
import { logger } from '../../utils/logger';
import { isBinaryPath } from '../../utils/path';
import { getNormalizedVaultPath } from './vault-folder-scope';

export interface ScannedFileInfo {
    path: string;
    name: string;
    isString: boolean;
}

/** Reads local snapshots and owns vault/repository/tree path mapping. */
export class SyncScanner {
    constructor(
        private readonly app: App,
        private readonly settings: GitLabFilesPushSettings,
    ) {}

    fileInfo(fileOrPath: TFile | string): ScannedFileInfo {
        const isString = typeof fileOrPath === 'string';
        const path = isString ? fileOrPath : fileOrPath.path;
        const name = isString ? path.split('/').pop() || path : fileOrPath.name;
        return { path, name, isString };
    }

    toRepoPath(path: string): string {
        return getNormalizedVaultPath(path, this.settings.vaultFolder);
    }

    toTreePath(repoPath: string): string {
        if (repoPath.startsWith('/')) return repoPath.slice(1);
        const rootPath = this.settings.rootPath;
        if (!rootPath) return repoPath;
        const cleanRoot = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
        return repoPath.startsWith(cleanRoot) ? repoPath : cleanRoot + repoPath;
    }

    pathExists(path: string): Promise<boolean> {
        return this.app.vault.adapter.exists(path);
    }

    indexedFileExists(path: string): boolean {
        return this.app.vault.getFileByPath(path) !== null;
    }

    async readContent(fileOrPath: TFile | string): Promise<string | ArrayBuffer> {
        const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
        const binary = isBinaryPath(path);
        if (typeof fileOrPath === 'string') {
            return binary
                ? this.app.vault.adapter.readBinary(path)
                : this.app.vault.adapter.read(path);
        }

        try {
            return binary
                ? await this.app.vault.readBinary(fileOrPath)
                : await this.app.vault.read(fileOrPath);
        } catch (error) {
            logger.warn(`vault.read failed for ${path}; falling back to adapter`, error);
            return binary
                ? this.app.vault.adapter.readBinary(path)
                : this.app.vault.adapter.read(path);
        }
    }
}
