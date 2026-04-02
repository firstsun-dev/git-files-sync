import { requestUrl, RequestUrlResponse, RequestUrlParam } from 'obsidian';

interface GitLabFileResponse {
    content: string;
    blob_id: string;
    file_path: string;
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

export class GitLabService {
    private baseUrl: string;
    private token: string;
    private projectId: string;
    private rootPath: string;

    constructor(baseUrl: string, token: string, projectId: string, rootPath: string = '') {
        this.updateConfig(baseUrl, token, projectId, rootPath);
    }

    updateConfig(baseUrl: string, token: string, projectId: string, rootPath: string = '') {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.token = token;
        this.projectId = projectId;
        this.rootPath = rootPath.replace(/^\/|\/$/g, '');
    }

    private getApiUrl(path: string): string {
        const fullPath = this.rootPath ? `${this.rootPath}/${path}` : path;
        const encodedPath = encodeURIComponent(fullPath);
        const encodedProjectId = encodeURIComponent(this.projectId);
        return `${this.baseUrl}/api/v4/projects/${encodedProjectId}/repository/files/${encodedPath}`;
    }

    /**
     * Safely wraps requestUrl to handle potential throws from Obsidian and provide better error messages.
     */
    private async safeRequest(params: RequestUrlParam): Promise<RequestUrlResponse> {
        try {
            return await requestUrl(params);
        } catch (e) {
            // Obsidian's requestUrl might throw an error object that contains status/response
            if (typeof e === 'object' && e !== null && 'status' in e) {
                const error = e as ObsidianResponseError;
                const status = error.status || 0;
                const responseData = error.response;
                const text = responseData?.text || (responseData?.json ? JSON.stringify(responseData.json) : '');
                
                // Re-throw as a standardized response-like object if it looks like one
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
                'PRIVATE-TOKEN': this.token
            }
        });

        if (response.status === 404) {
            return { content: '', sha: '' };
        }

        if (response.status !== 200) {
            const errorBody = response.text || JSON.stringify(response.json);
            throw new Error(`Failed to fetch file: ${response.status} from ${url}. Response: ${errorBody}`);
        }

        const data = (response.json as unknown) as GitLabFileResponse;
        const content = atob(data.content);
        let decodedContent = '';
        try {
            decodedContent = decodeURIComponent(content.split('').map(c => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
        } catch {
            // Fallback to plain string if decodeURIComponent fails (e.g. for non-UTF8)
            decodedContent = content;
        }

        return {
            content: decodedContent,
            sha: data.blob_id
        };
    }

    async pushFile(path: string, content: string, branch: string, commitMessage: string, existingSha?: string): Promise<string> {
        const url = this.getApiUrl(path);

        const sha = existingSha !== undefined ? existingSha : (await this.getFile(path, branch)).sha;
        const method = sha ? 'PUT' : 'POST';

        const response = await this.safeRequest({
            url,
            method,
            headers: {
                'PRIVATE-TOKEN': this.token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                branch,
                commit_message: commitMessage,
                content: btoa(encodeURIComponent(content).replace(/%([0-9A-F]{2})/g, (_match, p1: string) => {
                    return String.fromCharCode(parseInt(p1, 16));
                })),
                encoding: 'base64'
            })
        });

        if (response.status !== 200 && response.status !== 201) {
            const errorBody = response.text || JSON.stringify(response.json);
            throw new Error(`Failed to push file: ${response.status} ${method} ${url}. Response: ${errorBody}`);
        }

        return ((response.json as unknown) as GitLabFileResponse).file_path;
    }

    async testConnection(): Promise<void> {
        if (!this.token) throw new Error('Token is missing');
        if (!this.projectId) throw new Error('Project ID is missing');

        const encodedProjectId = encodeURIComponent(this.projectId);
        const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}`;
        const response = await this.safeRequest({
            url,
            method: 'GET',
            headers: {
                'PRIVATE-TOKEN': this.token
            }
        });

        if (response.status !== 200) {
            const errorBody = response.text || JSON.stringify(response.json);
            throw new Error(`Failed to connect: ${response.status} ${url}. Response: ${errorBody}`);
        }
    }
}
