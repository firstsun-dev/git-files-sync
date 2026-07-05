import { GitServiceInterface, GitTreeEntry } from './git-service-interface';
import { BaseGitService, ConnectionTestResult, GitFile, GitHubContentResponse, GitHubTreeResponse, GIT_SYMLINK_MODE } from './git-service-base';
import { logger } from '../utils/logger';

export class GiteaService extends BaseGitService implements GitServiceInterface {
    private baseUrl: string = '';
    private owner: string = '';
    private repo: string = '';

    updateConfig(baseUrl: string, token: string, owner: string, repo: string, rootPath: string = '') {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.token = token;
        this.owner = owner;
        this.repo = repo;
        this.rootPath = rootPath;
    }

    protected addAuthHeader(headers: Record<string, string>): void {
        headers['Authorization'] = `token ${this.token}`;
    }

    private getApiUrl(path: string): string {
        const fullPath = this.getFullPath(path);
        return `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/contents/${fullPath}`;
    }

    async getFile(path: string, branch: string): Promise<GitFile> {
        try {
            const url = `${this.getApiUrl(path)}?ref=${branch}`;
            const response = await this.safeRequest(url, 'GET');
            const data = this.parseJson<GitHubContentResponse>(response);

            return {
                content: this.decodeContent(data.content, path),
                sha: data.sha
            };
        } catch (e) {
            return this.handleFileNotFound(e);
        }
    }

    async pushFile(path: string, content: string | ArrayBuffer, branch: string, message: string, sha?: string): Promise<{ path: string, sha?: string }> {
        const url = this.getApiUrl(path);
        const body: { message: string; content: string; branch: string; sha?: string } = {
            message,
            content: this.encodeContent(content),
            branch,
        };
        // Only send sha when updating an existing file; a blank sha is rejected.
        if (sha) body.sha = sha;

        const method = sha ? 'PUT' : 'POST';
        const response = await this.safeRequest(url, method, body);
        const data = this.parseJson<{ content: { path: string, sha: string } }>(response);
        return { path: data.content.path, sha: data.content.sha };
    }

    async listFilesDetailed(branch: string, useFilter = true): Promise<GitTreeEntry[]> {
        // Resolve branch name to commit SHA first for compatibility with all Gitea versions,
        // since the git/trees endpoint requires a SHA (not a ref name) on older instances.
        const branchUrl = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/branches/${branch}`;
        let commitSha: string;
        try {
            const branchResponse = await this.safeRequest(branchUrl, 'GET');
            commitSha = this.parseJson<{ commit: { id: string } }>(branchResponse).commit.id;
        } catch (e) {
            throw this.branchNotFoundError(e, branch);
        }

        const treeUrl = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/git/trees/${commitSha}?recursive=1`;
        const treeResponse = await this.safeRequest(treeUrl, 'GET');
        const treeData = this.parseJson<GitHubTreeResponse>(treeResponse);

        if (treeData.truncated) {
            logger.warn('Gitea tree result is truncated. Some files might not be shown.');
        }

        const entries = treeData.tree
            .filter(item => item.type === 'blob')
            .map(item => ({ path: item.path, symlink: item.mode === GIT_SYMLINK_MODE }));

        if (!useFilter) return entries;

        return entries.filter(e => {
            if (!this.rootPath) return true;
            const cleanRoot = this.rootPath.endsWith('/') ? this.rootPath : `${this.rootPath}/`;
            return e.path === this.rootPath || e.path.startsWith(cleanRoot);
        });
    }

    async deleteFile(path: string, branch: string, message: string): Promise<void> {
        const file = await this.getFile(path, branch);
        const url = this.getApiUrl(path);
        const body = {
            message,
            sha: file.sha,
            branch
        };

        await this.safeRequest(url, 'DELETE', body);
    }

    async testConnection(branch: string): Promise<ConnectionTestResult> {
        try {
            const url = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}`;
            await this.safeRequest(url, 'GET');
        } catch (e) {
            return { repoOk: false, branchOk: false, error: e instanceof Error ? e.message : String(e) };
        }

        try {
            const branchUrl = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/branches/${branch}`;
            await this.safeRequest(branchUrl, 'GET', undefined, undefined, true);
            return { repoOk: true, branchOk: true };
        } catch {
            return { repoOk: true, branchOk: false };
        }
    }
}
