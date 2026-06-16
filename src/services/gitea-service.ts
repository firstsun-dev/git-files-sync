import { GitServiceInterface } from './git-service-interface';
import { BaseGitService, GitFile, GitHubContentResponse, GitHubTreeResponse } from './git-service-base';
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
            const data = response.json as GitHubContentResponse;

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
        const body = {
            message,
            content: this.encodeContent(content),
            branch,
            sha
        };

        const method = sha ? 'PUT' : 'POST';
        const response = await this.safeRequest(url, method, body);
        const data = response.json as { content: { path: string, sha: string } };
        return { path: data.content.path, sha: data.content.sha };
    }

    async listFiles(branch: string, useFilter = true): Promise<string[]> {
        const url = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/git/trees/${branch}?recursive=1`;
        const response = await this.safeRequest(url, 'GET');
        const data = response.json as GitHubTreeResponse;

        if (data.truncated) {
            logger.warn('Gitea tree result is truncated. Some files might not be shown.');
        }

        const files = data.tree
            .filter(item => item.type === 'blob')
            .map(item => item.path);

        if (!useFilter) return files;

        return files.filter(p => {
            if (!this.rootPath) return true;
            const cleanRoot = this.rootPath.endsWith('/') ? this.rootPath : `${this.rootPath}/`;
            return p === this.rootPath || p.startsWith(cleanRoot);
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

    async testConnection(): Promise<boolean> {
        try {
            const url = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}`;
            await this.safeRequest(url, 'GET');
            return true;
        } catch {
            return false;
        }
    }
}
