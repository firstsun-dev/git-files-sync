import ignore, { Ignore } from 'ignore';
import { App } from 'obsidian';
import { GitServiceInterface } from '../services/git-service-interface';

export class GitignoreManager {
    private readonly app: App;
    private readonly gitService: GitServiceInterface;
    private readonly branch: string;
    
    private readonly rootPath: string;
    
    // Maps directory path (empty string for root) to Ignore instance
    private readonly ignoreMap: Map<string, Ignore> = new Map();

    constructor(app: App, gitService: GitServiceInterface, branch: string, rootPath: string) {
        this.app = app;
        this.gitService = gitService;
        this.branch = branch;
        this.rootPath = rootPath.replace(/^\/|\/$/g, '');
    }

    /**
     * Discovers and parses .gitignore files from the local filesystem and remote repository.
     */
    async loadGitignores(): Promise<void> {
        this.ignoreMap.clear();

        // 1. Fetch all gitignore paths from the entire repo tree
        let gitignorePaths: string[] = [];
        try {
            gitignorePaths = await this.gitService.getRepoGitignores(this.branch);
        } catch (e) {
            console.warn('Failed to fetch repo gitignores', e);
            // Fallback to at least checking the root
            gitignorePaths = ['.gitignore'];
        }

        // 2. Fetch and parse each .gitignore
        for (const fullGitignorePath of gitignorePaths) {
            const dirPath = fullGitignorePath === '.gitignore' ? '' : fullGitignorePath.slice(0, -('.gitignore'.length + 1));
            const content = await this.getGitignoreContent(fullGitignorePath);

            if (content) {
                const ig = ignore().add(content);
                this.ignoreMap.set(dirPath, ig);
            }
        }
    }

    private async getGitignoreContent(fullGitignorePath: string): Promise<string | undefined> {
        let content: string | undefined;

        // Determine local path relative to vault root
        let localPath: string | null = null;
        if (!this.rootPath) {
            localPath = fullGitignorePath;
        } else if (fullGitignorePath === this.rootPath + '/.gitignore' || fullGitignorePath.startsWith(this.rootPath + '/')) {
            localPath = fullGitignorePath.substring(this.rootPath.length + 1);
        }

        // Try local first if it's within the vault
        if (localPath) {
            try {
                if (await this.app.vault.adapter.exists(localPath)) {
                    content = await this.app.vault.adapter.read(localPath);
                }
            } catch (e) {
                console.warn(`Failed to read local ${localPath}`, e);
            }
        }

        // Fallback to remote (use absolute path starting with / to bypass rootPath)
        if (content === undefined) {
            try {
                const remoteFile = await this.gitService.getFile('/' + fullGitignorePath, this.branch);
                if (remoteFile?.content) {
                    content = remoteFile.content;
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
