import ignore, { Ignore } from 'ignore';
import { App } from 'obsidian';
import { GitServiceInterface } from '../services/git-service-interface';
import { logger } from '../utils/logger';

export class GitignoreManager {
    private readonly app: App;
    private readonly gitService: GitServiceInterface;
    private readonly branch: string;
    
    private readonly rootPath: string;
    private readonly vaultFolder: string;
    
    // Maps directory path (empty string for root) to Ignore instance
    private readonly ignoreMap: Map<string, Ignore> = new Map();

    constructor(app: App, gitService: GitServiceInterface, branch: string, rootPath: string, vaultFolder: string = '') {
        this.app = app;
        this.gitService = gitService;
        this.branch = branch;
        this.rootPath = rootPath.replace(/^\/|\/$/g, '');
        this.vaultFolder = vaultFolder.replace(/^\/|\/$/g, '');
    }

    private getNormalizedPath(path: string): string {
        if (!this.vaultFolder) return path;
        const folderPath = this.vaultFolder + '/';
        if (path.startsWith(folderPath)) {
            return path.substring(folderPath.length);
        }
        if (path === this.vaultFolder) return '';
        return path;
    }

    /**
     * Discovers and parses .gitignore files from the local filesystem and remote repository.
     * Local files take priority; remote supplements anything not found locally.
     */
    async loadGitignores(): Promise<void> {
        this.ignoreMap.clear();

        // 1. Collect all potential gitignore paths
        const gitignorePaths = new Set<string>();

        // a. Repo root
        gitignorePaths.add('.gitignore');

        // b. All parent directories of rootPath
        if (this.rootPath) {
            const parts = this.rootPath.split('/');
            let current = '';
            for (const part of parts) {
                if (current) current += '/';
                current += part;
                gitignorePaths.add(current + '/.gitignore');
            }
        }

        // c. Scan local vault for .gitignore files (vault-relative → repo-relative)
        await this.scanLocalGitignores(gitignorePaths);

        // d. Supplement with remote repo's gitignore listing (filtered to rootPath)
        try {
            const remotePaths = await this.gitService.getRepoGitignores(this.branch);
            for (const p of remotePaths) gitignorePaths.add(p);
        } catch (e) {
            logger.warn('Failed to fetch repo gitignores', e);
        }

        // 2. Load content and build ignore instances
        for (const fullGitignorePath of gitignorePaths) {
            const dirPath = fullGitignorePath === '.gitignore'
                ? ''
                : fullGitignorePath.slice(0, -(('.gitignore'.length) + 1));
            const content = await this.getGitignoreContent(fullGitignorePath);
            if (content) {
                this.ignoreMap.set(dirPath, ignore().add(content));
            }
        }
    }

    private async scanLocalGitignores(out: Set<string>): Promise<void> {
        // Only scan within vaultFolder
        await this.scanDir(this.vaultFolder, out);
    }

    private async scanDir(vaultDir: string, out: Set<string>): Promise<void> {
        try {
            const listing = await this.app.vault.adapter.list(vaultDir || '');
            for (const filePath of listing.files) {
                if (filePath === '.gitignore' || filePath.endsWith('/.gitignore')) {
                    const normalized = this.getNormalizedPath(filePath);
                    const repoPath = this.rootPath ? `${this.rootPath}/${normalized}` : normalized;
                    out.add(repoPath);
                }
            }
            for (const subFolder of listing.folders) {
                await this.scanDir(subFolder, out);
            }
        } catch { /* adapter.list may be unavailable in some environments */ }
    }

    private getVaultPath(normalizedPath: string): string {
        if (!this.vaultFolder) return normalizedPath;
        if (!normalizedPath) return this.vaultFolder;
        return this.vaultFolder + '/' + normalizedPath;
    }

    private async getGitignoreContent(fullGitignorePath: string): Promise<string | undefined> {
        let content: string | undefined;

        // Determine local path relative to vault root
        let normalized: string | null;
        if (!this.rootPath) {
            normalized = fullGitignorePath;
        } else if (fullGitignorePath === this.rootPath + '/.gitignore' || fullGitignorePath.startsWith(this.rootPath + '/')) {
            normalized = fullGitignorePath.substring(this.rootPath.length + 1);
        } else if (fullGitignorePath === '.gitignore') {
            // Repo root gitignore might not be in the vault sync area
            normalized = null;
        } else {
            normalized = null;
        }

        const localPath = normalized !== null ? this.getVaultPath(normalized) : null;

        // Try local first if it's within the vault
        if (localPath) {
            try {
                if (await this.app.vault.adapter.exists(localPath)) {
                    content = await this.app.vault.adapter.read(localPath);
                }
            } catch (e) {
                logger.warn(`Failed to read local ${localPath}`, e);
            }
        }

        // Fallback to remote (use absolute path starting with / to bypass rootPath)
        if (content === undefined) {
            try {
                const remoteFile = await this.gitService.getFile('/' + fullGitignorePath, this.branch);
                if (remoteFile?.content) {
                    content = remoteFile.content as string;
                }
            } catch {
                // It's okay if some gitignores fail to fetch
            }
        }
        return content;
    }

    /**
     * Checks if a given file path should be ignored based on loaded .gitignore rules.
     */
    isIgnored(filePath: string): boolean {
        const fullPath = this.rootPath ? `${this.rootPath}/${filePath}` : filePath;

        for (const [dirPath, ig] of this.ignoreMap.entries()) {
            if (dirPath === '') {
                if (ig.ignores(fullPath)) return true;
                continue;
            }

            const prefix = dirPath + '/';
            if (fullPath.startsWith(prefix)) {
                const relativePath = fullPath.substring(prefix.length);
                if (ig.ignores(relativePath)) return true;
            }
        }
        return false;
    }
}
