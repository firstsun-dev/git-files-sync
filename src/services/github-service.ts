import { requestUrl, RequestUrlResponse, RequestUrlParam } from 'obsidian';
import { GitServiceInterface } from './git-service-interface';

interface GitHubFileResponse {
    content: string;
    sha: string;
    path: string;
}

interface ObsidianErrorResponse {
    headers: Record<string, string>;
    json?: unknown;
    text?: string;
}

interface ObsidianResponseError {
    status: number;
    response?: ObsidianErrorResponse;
}

export class GitHubService implements GitServiceInterface {
    private token: string;
    private owner: string;
    private repo: string;
    private rootPath: string;

    constructor(token: string, owner: string, repo: string, rootPath: string = '') {
        this.updateConfig(token, owner, repo, rootPath);
    }

    updateConfig(token: string, owner: string, repo: string, rootPath: string = '') {
        this.token = token;
        this.owner = owner;
        this.repo = repo;
        this.rootPath = rootPath.replace(/^\/|\/$/g, '');
    }

    private getApiUrl(path: string): string {
        const isAbsolute = path.startsWith('/');
        const cleanPath = path.replace(/^\//, '');
        const fullPath = (this.rootPath && !isAbsolute) ? `${this.rootPath}/${cleanPath}` : cleanPath;
        return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${fullPath}`;
    }

    private async safeRequest(params: RequestUrlParam): Promise<RequestUrlResponse> {
        try {
            return await requestUrl(params);
        } catch (e) {
            if (typeof e === 'object' && e !== null && 'status' in e) {
                const error = e as ObsidianResponseError;
                const status = error.status || 0;
                const responseData = error.response;
                const text = responseData?.text || (responseData?.json ? JSON.stringify(responseData.json) : '');

                if (status) {
                    return {
                        status,
                        headers: responseData?.headers || {},
                        arrayBuffer: new ArrayBuffer(0),
                        json: responseData?.json || {},
                        text: text
                    };
                }
            }
            throw e;
        }
    }

    async getFile(path: string, branch: string): Promise<{ content: string; sha: string }> {
        const url = `${this.getApiUrl(path)}?ref=${branch}`;
        const response = await this.safeRequest({
            url,
            method: 'GET',
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (response.status === 404) {
            return { content: '', sha: '' };
        }

        if (response.status !== 200) {
            const errorBody = response.text || JSON.stringify(response.json);
            throw new Error(`Failed to fetch file: ${response.status} from ${url}. Response: ${errorBody}`);
        }

        const data = (response.json as unknown) as GitHubFileResponse;
        const content = atob(data.content);
        let decodedContent = '';
        try {
            decodedContent = decodeURIComponent(content.split('').map(c => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
        } catch {
            decodedContent = content;
        }

        return {
            content: decodedContent,
            sha: data.sha
        };
    }

    async pushFile(path: string, content: string, branch: string, commitMessage: string, existingSha?: string): Promise<string> {
        const url = this.getApiUrl(path);

        const sha = existingSha !== undefined ? existingSha : (await this.getFile(path, branch)).sha;

        const body: Record<string, unknown> = {
            message: commitMessage,
            content: btoa(encodeURIComponent(content).replace(/%([0-9A-F]{2})/g, (_match, p1: string) => {
                return String.fromCharCode(parseInt(p1, 16));
            })),
            branch
        };

        if (sha) {
            body.sha = sha;
        }

        const response = await this.safeRequest({
            url,
            method: 'PUT',
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (response.status !== 200 && response.status !== 201) {
            const errorBody = response.text || JSON.stringify(response.json);
            throw new Error(`Failed to push file: ${response.status} PUT ${url}. Response: ${errorBody}`);
        }

        return ((response.json as { content: GitHubFileResponse }).content).path;
    }

    async testConnection(): Promise<void> {
        if (!this.token) throw new Error('Token is missing');
        if (!this.owner) throw new Error('Owner is missing');
        if (!this.repo) throw new Error('Repository is missing');

        const url = `https://api.github.com/repos/${this.owner}/${this.repo}`;

        try {
            const response = await this.safeRequest({
                url,
                method: 'GET',
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.status !== 200) {
                const errorBody = response.text || JSON.stringify(response.json);
                throw new Error(`Failed to connect: ${response.status} ${url}. Response: ${errorBody}`);
            }
        } catch (e) {
            if (e instanceof Error) {
                // Provide more helpful error messages for common issues
                if (e.message.includes('NAME') || e.message.includes('resolve')) {
                    throw new Error(`DNS resolution failed. Please check your network connection or try restarting Obsidian. Original error: ${e.message}`);
                }
                if (e.message.includes('CERT') || e.message.includes('certificate')) {
                    throw new Error(`SSL certificate error. This may be caused by network security settings. Original error: ${e.message}`);
                }
            }
            throw e;
        }
    }

    async listFiles(branch: string, _path: string = ''): Promise<string[]> {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees/${branch}?recursive=1`;

        const response = await this.safeRequest({
            url,
            method: 'GET',
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (response.status !== 200) {
            const errorBody = response.text || JSON.stringify(response.json);
            throw new Error(`Failed to list files: ${response.status} ${url}. Response: ${errorBody}`);
        }

        interface TreeItem {
            path: string;
            type: string;
        }

        interface TreeResponse {
            tree: TreeItem[];
        }

        const data = response.json as TreeResponse;
        const allFiles = data.tree
            .filter(item => item.type === 'blob')
            .map(item => item.path);

        // Filter by rootPath if set
        if (this.rootPath) {
            const prefix = this.rootPath + '/';
            return allFiles
                .filter(file => file.startsWith(prefix))
                .map(file => file.substring(prefix.length));
        }

        return allFiles;
    }

    async deleteFile(path: string, branch: string, commitMessage: string): Promise<void> {
        const url = this.getApiUrl(path);

        // Get current file SHA
        const fileInfo = await this.getFile(path, branch);
        if (!fileInfo.sha) {
            throw new Error(`File not found: ${path}`);
        }

        const response = await this.safeRequest({
            url,
            method: 'DELETE',
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: commitMessage,
                sha: fileInfo.sha,
                branch
            })
        });

        if (response.status !== 200 && response.status !== 204) {
            const errorBody = response.text || JSON.stringify(response.json);
            throw new Error(`Failed to delete file: ${response.status} DELETE ${url}. Response: ${errorBody}`);
        }
    }

    async getRepoGitignores(branch: string): Promise<string[]> {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees/${branch}?recursive=1`;
        const response = await this.safeRequest({
            url,
            method: 'GET',
            headers: {
                'Authorization': `token ${this.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (response.status !== 200) {
            return [];
        }

        interface TreeItem {
            path: string;
            type: string;
        }

        interface TreeResponse {
            tree: TreeItem[];
        }

        const data = response.json as TreeResponse;
        return data.tree
            .filter(item => item.type === 'blob' && item.path.endsWith('.gitignore'))
            .map(item => item.path);
    }
}
