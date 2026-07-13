import { requestUrl, RequestUrlResponse } from 'obsidian';
import { logger } from '../utils/logger';
import { GitTreeEntry } from './git-service-interface';

export interface GitFile {
    content: string | ArrayBuffer;
    sha: string;
    isSymlink?: boolean;
    symlinkTarget?: string;
}

// Git file mode for a symbolic link. Symlinks are stored as blobs whose content
// is the link target path, so they need special handling during sync.
export const GIT_SYMLINK_MODE = '120000';

export interface GitHubContentResponse {
    content: string;
    sha: string;
    path: string;
}

export interface GitHubTreeItem {
    path: string;
    type: string;
    mode?: string;
}

export interface GitHubTreeResponse {
    tree: GitHubTreeItem[];
    truncated: boolean;
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
    mode?: string;
}

export interface ConnectionTestResult {
    /** Whether the repository/project itself was reachable with the given credentials. */
    repoOk: boolean;
    /** Whether the configured branch was found. Only meaningful when repoOk is true. */
    branchOk: boolean;
    /** Populated when repoOk is false, describing the repo-level failure. */
    error?: string;
}

export abstract class BaseGitService {
    protected token: string = '';
    protected rootPath: string = '';

    /**
     * Safely wraps requestUrl to handle potential throws from Obsidian and provide better error messages.
     */
    protected async safeRequest(url: string, method: string, body?: unknown, extraHeaders?: Record<string, string>, silent = false): Promise<RequestUrlResponse> {
        let response: RequestUrlResponse;
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

            response = await requestUrl(options);
        } catch (error) {
            // Network-level failure (DNS, offline, TLS, etc.) — but some Obsidian
            // versions eagerly parse the response body as JSON inside requestUrl()
            // itself, before `throw: false` or our own status check ever run. If a
            // proxy/login page returns HTML instead of JSON, that eager parse
            // throws here as a raw "Unexpected token '<' ... is not valid JSON"
            // error rather than surfacing as a normal response we could inspect.
            if (!silent) logger.error('Git Service Request Failed:', error);
            if (this.looksLikeJsonParseOfHtmlError(error)) {
                throw new Error(
                    'Expected a JSON response from the Git server but received an HTML page ' +
                    '(likely a login, SSO redirect, or proxy/error page). ' +
                    'Please check the server URL, your access token, and any network proxy or firewall.'
                );
            }
            if (error instanceof Error) throw error;
            throw new Error(`Network error or unexpected failure: ${String(error)}`);
        }

        if (response.status >= 400) {
            const errorMsg = this.parseErrorResponse(response);
            // 404 is routinely an expected "does not exist" probe (getFile treats
            // it as an empty file, gitignore lookups ignore it). Log it at debug
            // level so it doesn't surface as a failure, but still throw so callers
            // can handle it. Other statuses are genuine errors.
            if (!silent) {
                if (response.status === 404) logger.debug(`Git Service 404 (not found): ${url}`);
                else logger.error(`Git Service Request Failed (${response.status}): ${url}`, errorMsg);
            }
            throw new Error(`Git Service Error (${response.status}): ${errorMsg}`);
        }

        return response;
    }

    protected abstract addAuthHeader(headers: Record<string, string>): void;

    /**
     * Detects V8's JSON.parse error for a response starting with '<' (an HTML
     * page), across its known message phrasings, e.g.:
     *   "Unexpected token '<', "<!DOCTYPE "... is not valid JSON"
     *   "Unexpected token < in JSON at position 0"
     */
    private looksLikeJsonParseOfHtmlError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        return /unexpected token/i.test(error.message) && /json/i.test(error.message) && error.message.includes('<');
    }

    /**
     * Safely parses a response body as JSON.
     *
     * Some servers/proxies return a 2xx (or redirect) response whose body is an
     * HTML page — a login screen, an SSO redirect, or a proxy/error page — rather
     * than JSON. Accessing `response.json` directly then throws a cryptic
     * "Unexpected token '<', \"<!DOCTYPE ...\" is not valid JSON" error. This helper
     * detects that case and throws a clear, actionable message instead.
     */
    protected parseJson<T>(response: RequestUrlResponse): T {
        const contentType = (response.headers?.['content-type'] ?? response.headers?.['Content-Type'] ?? '').toLowerCase();
        const bodyText = (response.text ?? '').trimStart();
        const looksLikeHtml = bodyText.startsWith('<') || contentType.includes('html');

        try {
            const data = response.json as T;
            if (data === undefined && looksLikeHtml) throw new Error('non-JSON response');
            return data;
        } catch (e) {
            if (looksLikeHtml) {
                throw new Error(
                    'Expected a JSON response from the Git server but received an HTML page ' +
                    '(likely a login, SSO redirect, or proxy/error page). ' +
                    'Please check the server URL, your access token, and any network proxy or firewall.'
                );
            }
            throw new Error(`Failed to parse the Git server response as JSON: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    protected parseErrorResponse(response: RequestUrlResponse): string {
        try {
            const data = response.json as { message?: string; error?: string };
            return data.message || data.error || JSON.stringify(data);
        } catch {
            const bodyText = (response.text ?? '').trim();
            const contentType = (response.headers?.['content-type'] ?? response.headers?.['Content-Type'] ?? '').toLowerCase();
            if (bodyText.startsWith('<') || contentType.includes('html')) {
                return 'Received an HTML page instead of a JSON error (likely a login, redirect, or proxy/error page). Check the server URL, access token, and network proxy.';
            }
            return bodyText || 'Unknown error';
        }
    }

    protected getFullPath(path: string): string {
        // Leading / = absolute repo path; skip rootPath prefix entirely
        if (path.startsWith('/')) return path.slice(1);
        if (!this.rootPath) return path;
        const cleanRoot = this.rootPath.endsWith('/') ? this.rootPath : `${this.rootPath}/`;
        // Already contains rootPath prefix (path came from listFiles or vault IS repo root)
        if (path.startsWith(cleanRoot)) return path;
        return cleanRoot + path;
    }

    protected isBinary(path: string): boolean {
        const ext = path.split('.').pop()?.toLowerCase();
        if (!ext) return false;
        const BINARY_EXTENSIONS = new Set([
            'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'pdf', 'zip', 'gz', '7z', 'rar',
            'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'avi', 'wmv', 'webp',
            'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub', 'exe', 'dll', 'so',
            'ttf', 'woff', 'woff2', 'eot', 'wasm', 'dmg', 'iso'
        ]);
        return BINARY_EXTENSIONS.has(ext);
    }

    protected encodeContent(content: string | ArrayBuffer): string {
        if (typeof content === 'string') {
            const bytes = new TextEncoder().encode(content);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                const byte = bytes[i];
                if (byte !== undefined) binary += String.fromCodePoint(byte);
            }
            return btoa(binary);
        } else {
            const bytes = new Uint8Array(content);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                const byte = bytes[i];
                if (byte !== undefined) binary += String.fromCodePoint(byte);
            }
            return btoa(binary);
        }
    }

    protected decodeContent(base64: string, path: string): string | ArrayBuffer {
        const binary = atob(base64.replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            const cp = binary.codePointAt(i);
            bytes[i] = cp !== undefined ? cp : 0;
        }

        return this.isBinary(path) ? bytes.buffer : new TextDecoder().decode(bytes);
    }

    protected handleFileNotFound(e: unknown): GitFile {
        if (e instanceof Error && e.message.includes('404')) {
            return { content: '', sha: '' };
        }
        throw e;
    }

    /**
     * Rethrows a branch-resolution failure (e.g. the "resolve branch to a commit"
     * request in listFilesDetailed) with a message that names the branch, since a
     * bare "404" gives no clue that the configured Branch setting is the problem.
     */
    protected branchNotFoundError(e: unknown, branch: string): Error {
        if (e instanceof Error && e.message.includes('404')) {
            return new Error(
                `Branch "${branch}" was not found in the repository. Check the Branch setting, ` +
                'or confirm the repository actually has a branch with this name (its default branch ' +
                'might be "master" instead of "main", or the repository may have no commits yet).'
            );
        }
        return e instanceof Error ? e : new Error(String(e));
    }

    async getRepoGitignores(branch: string): Promise<string[]> {
        try {
            const allFiles = await this.listFiles(branch, false); // Fetch ALL files to find gitignores
            return allFiles.filter(p => p.endsWith('.gitignore'));
        } catch {
            return [];
        }
    }

    async listFiles(branch: string, useFilter = true): Promise<string[]> {
        const entries = await this.listFilesDetailed(branch, useFilter);
        return entries.map(e => e.path);
    }

    abstract getFile(path: string, branch: string): Promise<GitFile>;
    abstract pushFile(path: string, content: string | ArrayBuffer, branch: string, message: string, sha?: string): Promise<{ path: string, sha?: string }>;
    abstract listFilesDetailed(branch: string, useFilter?: boolean): Promise<GitTreeEntry[]>;
    abstract deleteFile(path: string, branch: string, message: string): Promise<void>;
    abstract testConnection(branch: string): Promise<ConnectionTestResult>;
}
