import { GitServiceInterface } from './git-service-interface';
import { BaseGitService, GitFile, GitLabFileResponse, GitLabTreeItem } from './git-service-base';

export class GitLabService extends BaseGitService implements GitServiceInterface {
    private baseUrl: string = 'https://gitlab.com';
    private projectId: string = '';

    updateConfig(baseUrl: string, token: string, projectId: string, rootPath: string = '') {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.token = token;
        this.projectId = projectId;
        this.rootPath = rootPath;
    }

    protected addAuthHeader(headers: Record<string, string>): void {
        headers['PRIVATE-TOKEN'] = this.token;
    }

    private getApiUrl(path: string): string {
        const fullPath = this.getFullPath(path);
        const encodedPath = encodeURIComponent(fullPath);
        const encodedProjectId = encodeURIComponent(this.projectId);
        return `${this.baseUrl}/api/v4/projects/${encodedProjectId}/repository/files/${encodedPath}`;
    }

    async getFile(path: string, branch: string): Promise<GitFile> {
        try {
            const url = `${this.getApiUrl(path)}?ref=${branch}`;
            const response = await this.safeRequest(url, 'GET');
            const data = response.json as GitLabFileResponse;
            
            return {
                content: this.decodeContent(data.content),
                sha: data.last_commit_id
            };
        } catch (e) {
            if (e instanceof Error && e.message.includes('404')) {
                return { content: '', sha: '' };
            }
            throw e;
        }
    }

    async pushFile(path: string, content: string, branch: string, message: string, sha?: string): Promise<string> {
        const url = this.getApiUrl(path);
        const body = {
            branch,
            content: this.encodeContent(content),
            encoding: 'base64',
            commit_message: message,
            last_commit_id: sha
        };

        const method = sha ? 'PUT' : 'POST';
        const response = await this.safeRequest(url, method, body);
        const data = response.json as GitLabFileResponse;
        return data.file_path;
    }

    async listFiles(branch: string): Promise<string[]> {
        const encodedProjectId = encodeURIComponent(this.projectId);
        const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/repository/tree?ref=${branch}&recursive=true&per_page=100`;
        const response = await this.safeRequest(url, 'GET');
        const data = response.json as GitLabTreeItem[];
        
        return data
            .filter(item => item.type === 'blob')
            .map(item => item.path)
            .filter(p => !this.rootPath || p.startsWith(this.rootPath));
    }

    async deleteFile(path: string, branch: string, message: string): Promise<void> {
        const url = this.getApiUrl(path);
        const body = {
            branch,
            commit_message: message
        };

        await this.safeRequest(url, 'DELETE', body);
    }

    async testConnection(): Promise<boolean> {
        try {
            const encodedProjectId = encodeURIComponent(this.projectId);
            const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}`;
            await this.safeRequest(url, 'GET');
            return true;
        } catch {
            return false;
        }
    }

    async getRepoGitignores(branch: string): Promise<string[]> {
        const allFiles = await this.listFiles(branch);
        return allFiles.filter(p => p.endsWith('.gitignore'));
    }

    private encodeContent(content: string): string {
        const bytes = new TextEncoder().encode(content);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            const byte = bytes[i];
            if (byte !== undefined) {
                binary += String.fromCodePoint(byte);
            }
        }
        return btoa(binary);
    }

    private decodeContent(base64: string): string {
        const binary = atob(base64.replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            const cp = binary.codePointAt(i);
            bytes[i] = cp !== undefined ? cp : 0;
        }
        return new TextDecoder().decode(bytes);
    }
}
