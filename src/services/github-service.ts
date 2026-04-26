import { GitServiceInterface } from './git-service-interface';
import { BaseGitService, GitFile, GitHubContentResponse, GitHubTreeResponse } from './git-service-base';

export class GitHubService extends BaseGitService implements GitServiceInterface {
    private owner: string = '';
    private repo: string = '';

    updateConfig(token: string, owner: string, repo: string, rootPath: string = '') {
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
        return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${fullPath}`;
    }

    async getFile(path: string, branch: string): Promise<GitFile> {
        try {
            const url = `${this.getApiUrl(path)}?ref=${branch}`;
            const response = await this.safeRequest(url, 'GET');
            const data = response.json as GitHubContentResponse;
            
            return {
                content: this.decodeContent(data.content),
                sha: data.sha
            };
        } catch (e) {
            return this.handleFileNotFound(e);
        }
    }

    async pushFile(path: string, content: string, branch: string, message: string, sha?: string): Promise<string> {
        const url = this.getApiUrl(path);
        const body = {
            message,
            content: this.encodeContent(content),
            branch,
            sha
        };

        const response = await this.safeRequest(url, 'PUT', body);
        const data = response.json as { content: { path: string } };
        return data.content.path;
    }

    async listFiles(branch: string): Promise<string[]> {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees/${branch}?recursive=1`;
        const response = await this.safeRequest(url, 'GET');
        const data = response.json as GitHubTreeResponse;
        
        return data.tree
            .filter(item => item.type === 'blob')
            .map(item => item.path)
            .filter(p => !this.rootPath || p.startsWith(this.rootPath));
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
            const url = `https://api.github.com/repos/${this.owner}/${this.repo}`;
            await this.safeRequest(url, 'GET');
            return true;
        } catch {
            return false;
        }
    }

}
