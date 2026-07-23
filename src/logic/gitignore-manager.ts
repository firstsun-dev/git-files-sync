import ignore, { Ignore } from 'ignore';
import { App } from 'obsidian';
import { GitServiceInterface, GitTreeEntry } from '../services/git-service-interface';
import { logger } from '../utils/logger';
import { readLocalSymlinkTarget } from '../utils/symlink';

export class GitignoreManager {
    private readonly app: App;
    private readonly gitService: GitServiceInterface;
    private readonly branch: string;
    
    private readonly rootPath: string;
    private readonly vaultFolder: string;
    // User-defined local ignore patterns (settings.ignorePatterns), applied on top of
    // remote/local .gitignore rules. Matched against the same vault/rootPath-relative
    // path passed into isIgnored().
    private readonly localIgnore: Ignore | null;

    // Maps directory path (empty string for root) to Ignore instance
    private readonly ignoreMap: Map<string, Ignore> = new Map();

    constructor(app: App, gitService: GitServiceInterface, branch: string, rootPath: string, vaultFolder: string = '', ignorePatterns: string = '') {
        this.app = app;
        this.gitService = gitService;
        this.branch = branch;
        this.rootPath = rootPath.replace(/^\/|\/$/g, '');
        this.vaultFolder = vaultFolder.replace(/^\/|\/$/g, '');
        this.localIgnore = ignorePatterns.trim() ? ignore().add(ignorePatterns) : null;
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
     *
     * @param remoteTree Optional pre-fetched, unfiltered remote tree (e.g. from
     * `gitService.listFilesDetailed(branch, false)`). When supplied, it's scanned
     * directly for `.gitignore` paths instead of making another remote fetch via
     * `getRepoGitignores`. Falls back to that fetch when omitted, so this method
     * still works standalone (e.g. in tests).
     */
    async loadGitignores(remoteTree?: GitTreeEntry[]): Promise<void> {
        this.ignoreMap.clear();

        const gitignorePaths = await this.collectGitignorePaths(remoteTree);
        // Candidates include speculative paths (the repo root, every rootPath
        // ancestor) that often exist in neither place. A tree tells us which of
        // those the remote actually has, so the rest skip a request that would
        // only 404.
        const remotePaths = remoteTree ? new Set(remoteTree.map(e => e.path)) : undefined;

        // Load content and build ignore instances
        for (const fullGitignorePath of gitignorePaths) {
            const dirPath = fullGitignorePath === '.gitignore'
                ? ''
                : fullGitignorePath.slice(0, -(('.gitignore'.length) + 1));
            const content = await this.getGitignoreContent(fullGitignorePath, remotePaths);
            if (content) {
                this.ignoreMap.set(dirPath, ignore().add(content));
            }
        }
    }

    /** Collects every candidate .gitignore path: repo root, rootPath ancestors,
     * local vault scan, and the remote listing (from a pre-fetched tree when
     * supplied, else a dedicated remote fetch). */
    private async collectGitignorePaths(remoteTree?: GitTreeEntry[]): Promise<Set<string>> {
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
        await this.addRemoteGitignorePaths(gitignorePaths, remoteTree);

        return gitignorePaths;
    }

    /** Adds remote .gitignore paths to `out`: scanned directly from a
     * pre-fetched tree when supplied, else via a dedicated remote fetch. */
    private async addRemoteGitignorePaths(out: Set<string>, remoteTree?: GitTreeEntry[]): Promise<void> {
        if (remoteTree) {
            for (const entry of remoteTree) {
                if (entry.path.endsWith('.gitignore')) out.add(entry.path);
            }
            return;
        }
        try {
            const remotePaths = await this.gitService.getRepoGitignores(this.branch);
            for (const p of remotePaths) out.add(p);
        } catch (e) {
            logger.warn('Failed to fetch repo gitignores', e);
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
                // A folder that's actually a symlink (e.g. a shared folder linked in from
                // elsewhere) is a single git blob on the remote, not a real tree — walking
                // into it would scan an unrelated directory structure and produce bogus
                // .gitignore lookups against paths that don't exist in this repo.
                if (readLocalSymlinkTarget(this.app, subFolder) !== null) continue;
                await this.scanDir(subFolder, out);
            }
        } catch { /* adapter.list may be unavailable in some environments */ }
    }

    private getVaultPath(normalizedPath: string): string {
        if (!this.vaultFolder) return normalizedPath;
        if (!normalizedPath) return this.vaultFolder;
        return this.vaultFolder + '/' + normalizedPath;
    }

    private async getGitignoreContent(fullGitignorePath: string, remotePaths?: Set<string>): Promise<string | undefined> {
        const localPath = this.localGitignorePath(fullGitignorePath);
        const local = localPath ? await this.readLocalGitignore(localPath) : undefined;
        if (local !== undefined) return local;

        // A known tree already says whether the remote has this one; skip the
        // request for candidates it doesn't list rather than eating a 404.
        if (remotePaths && !remotePaths.has(fullGitignorePath)) return undefined;

        // Absolute path (leading /) bypasses rootPath.
        try {
            const remoteFile = await this.gitService.getFile('/' + fullGitignorePath, this.branch);
            return remoteFile?.content ? remoteFile.content as string : undefined;
        } catch {
            // It's okay if some gitignores fail to fetch
            return undefined;
        }
    }

    /** Vault path this .gitignore would live at, or null when it sits outside the synced area. */
    private localGitignorePath(fullGitignorePath: string): string | null {
        if (!this.rootPath) return this.getVaultPath(fullGitignorePath);
        if (fullGitignorePath === this.rootPath + '/.gitignore' || fullGitignorePath.startsWith(this.rootPath + '/')) {
            return this.getVaultPath(fullGitignorePath.substring(this.rootPath.length + 1));
        }
        // The repo root's .gitignore (and anything else above rootPath) is only
        // ever on the remote.
        return null;
    }

    private async readLocalGitignore(localPath: string): Promise<string | undefined> {
        try {
            if (await this.app.vault.adapter.exists(localPath)) {
                return await this.app.vault.adapter.read(localPath);
            }
        } catch (e) {
            logger.warn(`Failed to read local ${localPath}`, e);
        }
        return undefined;
    }

    /**
     * Checks if a given file path should be ignored based on loaded .gitignore rules.
     */
    isIgnored(filePath: string): boolean {
        if (this.localIgnore?.ignores(filePath)) return true;

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
