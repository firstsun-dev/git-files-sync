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
        const fullPath = this.rootPath ? `${this.rootPath}/${path}` : path;
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
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Obsidian-GitLab-Files-Push'
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
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'Obsidian-GitLab-Files-Push'
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
        const response = await this.safeRequest({
            url,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Obsidian-GitLab-Files-Push'
            }
        });

        if (response.status !== 200) {
            const errorBody = response.text || JSON.stringify(response.json);
            throw new Error(`Failed to connect: ${response.status} ${url}. Response: ${errorBody}`);
        }
    }
}
