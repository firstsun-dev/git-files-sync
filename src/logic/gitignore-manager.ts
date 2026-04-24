import ignore, { Ignore } from 'ignore';
import { App } from 'obsidian';
import { GitServiceInterface } from '../services/git-service-interface';

export class GitignoreManager {
    private app: App;
    private gitService: GitServiceInterface;
    private branch: string;
    
    // Maps directory path (empty string for root) to Ignore instance
    private ignoreMap: Map<string, Ignore> = new Map();

    constructor(app: App, gitService: GitServiceInterface, branch: string) {
        this.app = app;
        this.gitService = gitService;
        this.branch = branch;
    }

    /**
     * Discovers and parses .gitignore files from the local filesystem and remote repository.
     * Uses remoteFiles as a hint for where .gitignore files exist in subdirectories.
     */
    async loadGitignores(remoteFiles: string[]): Promise<void> {
        this.ignoreMap.clear();

        // 1. Identify all unique directories that contain a .gitignore
        const gitignorePaths = new Set<string>();
        
        // Root gitignore
        gitignorePaths.add('.gitignore');

        // Check remote files for any .gitignore in subdirectories
        for (const remotePath of remoteFiles) {
            if (remotePath.endsWith('.gitignore')) {
                gitignorePaths.add(remotePath);
            }
        }

        // 2. Fetch and parse each .gitignore
        for (const gitignorePath of gitignorePaths) {
            const dirPath = gitignorePath === '.gitignore' ? '' : gitignorePath.slice(0, -('.gitignore'.length + 1));
            
            let content: string | undefined;

            // Try local first
            if (await this.app.vault.adapter.exists(gitignorePath)) {
                try {
                    content = await this.app.vault.adapter.read(gitignorePath);
                } catch (e) {
                    console.warn(`Failed to read local ${gitignorePath}`, e);
                }
            }

            // Fallback to remote
            if (content === undefined && remoteFiles.includes(gitignorePath)) {
                try {
                    const remoteFile = await this.gitService.getFile(gitignorePath, this.branch);
                    if (remoteFile && remoteFile.content) {
                        content = remoteFile.content;
                    }
                } catch (e) {
                    console.warn(`Failed to fetch remote ${gitignorePath}`, e);
                }
            }

            if (content) {
                const ig = ignore().add(content);
                this.ignoreMap.set(dirPath, ig);
            }
        }
    }

    /**
     * Checks if a given file path should be ignored based on loaded .gitignore rules.
     */
    isIgnored(filePath: string): boolean {
        // Iterate through all loaded .gitignore files.
        // A .gitignore file only applies to paths within its directory.
        for (const [dirPath, ig] of this.ignoreMap.entries()) {
            if (dirPath === '') {
                // Root .gitignore applies to everything
                if (ig.ignores(filePath)) {
                    return true;
                }
            } else {
                // Subdirectory .gitignore
                // Check if the file is inside this directory
                const prefix = dirPath + '/';
                if (filePath.startsWith(prefix)) {
                    // Extract the path relative to the directory containing .gitignore
                    const relativePath = filePath.substring(prefix.length);
                    if (ig.ignores(relativePath)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}
