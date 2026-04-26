import { requestUrl, RequestUrlResponse } from 'obsidian';

export interface GitFile {
    content: string;
    sha: string;
}

export interface GitHubContentResponse {
    content: string;
    sha: string;
    path: string;
}

export interface GitHubTreeItem {
    path: string;
    type: string;
}

export interface GitHubTreeResponse {
    tree: GitHubTreeItem[];
}

export interface GitLabFileResponse {
    content: string;
    blob_id: string;
    file_path: string;
    last_commit_id: string;
}

export interface GitLabTreeItem {
    path: string;
    type: string;
}

export abstract class BaseGitService {
    protected token: string = '';
    protected rootPath: string = '';

    /**
     * Safely wraps requestUrl to handle potential throws from Obsidian and provide better error messages.
     */
    protected async safeRequest(url: string, method: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<RequestUrlResponse> {
        try {
            const headers: Record<string, string> = {
                ...extraHeaders,
                'Content-Type': 'application/json',
            };
            this.addAuthHeader(headers);

            const options = {
                url,
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                throw: false
            };

            const response = await requestUrl(options);
            
            if (response.status >= 400) {
                const errorMsg = this.parseErrorResponse(response);
                throw new Error(`Git Service Error (${response.status}): ${errorMsg}`);
            }

            return response;
        } catch (error) {
            console.error('Git Service Request Failed:', error);
            if (error instanceof Error) throw error;
            throw new Error(`Network error or unexpected failure: ${String(error)}`);
        }
    }

    protected abstract addAuthHeader(headers: Record<string, string>): void;

    protected parseErrorResponse(response: RequestUrlResponse): string {
        try {
            const data = response.json as { message?: string; error?: string };
            return data.message || data.error || JSON.stringify(data);
        } catch {
            return response.text || 'Unknown error';
        }
    }

    protected getFullPath(path: string): string {
        if (!this.rootPath) return path;
        const cleanRoot = this.rootPath.endsWith('/') ? this.rootPath : `${this.rootPath}/`;
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        return cleanRoot + cleanPath;
    }

    protected encodeContent(content: string): string {
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

    protected decodeContent(base64: string): string {
        const binary = atob(base64.replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            const cp = binary.codePointAt(i);
            bytes[i] = cp !== undefined ? cp : 0;
        }
        return new TextDecoder().decode(bytes);
    }

    protected handleFileNotFound(e: unknown): GitFile {
        if (e instanceof Error && e.message.includes('404')) {
            return { content: '', sha: '' };
        }
        throw e;
    }

    async getRepoGitignores(branch: string): Promise<string[]> {
        const allFiles = await this.listFiles(branch);
        return allFiles.filter(p => p.endsWith('.gitignore'));
    }

    abstract getFile(path: string, branch: string): Promise<GitFile>;
    abstract pushFile(path: string, content: string, branch: string, message: string, sha?: string): Promise<string>;
    abstract listFiles(branch: string): Promise<string[]>;
    abstract deleteFile(path: string, branch: string, message: string): Promise<void>;
    abstract testConnection(): Promise<boolean>;
}
