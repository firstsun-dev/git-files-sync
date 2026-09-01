import { requestUrl, RequestUrlResponse } from 'obsidian';
import { logger } from '../utils/logger';
import { ConnectionTestResult, GitTreeEntry } from './git-service-interface';
import { isBinaryPath } from '../utils/path';

export interface GitFile {
    content: string | ArrayBuffer;
    sha: string;
    revision?: string;
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
    sha?: string;
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
    /** GitLab's tree API calls the blob SHA "id", not "sha". */
    id?: string;
}

/** Max files per single batch-commit call. Guards against oversized request
 * bodies / provider payload limits when a vault has thousands of files. */
export const MAX_BATCH_PUSH_SIZE = 200;

/** How many blob-creation requests to have in flight at once when building a
 * batch commit. Creating each file's blob is an independent request with no
 * ordering dependency, so running them one-at-a-time (as opposed to the final
 * tree/commit/ref sequence, which genuinely is sequential) just adds N
 * round trips of pure latency. A moderate cap keeps this fast without
 * bursting past a provider's abuse-detection/secondary rate limits. */
export const BLOB_CREATE_CONCURRENCY = 8;

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

        return isBinaryPath(path) ? bytes.buffer : new TextDecoder().decode(bytes);
    }

    /**
     * Fetches a blob by SHA from a GitHub-shaped git data API (GitHub and Gitea
     * both expose `GET .../git/blobs/{sha}` returning base64 `content`).
     */
    protected async fetchGitHubStyleBlob(url: string, path: string): Promise<GitFile> {
        const response = await this.safeRequest(url, 'GET');
        const data = this.parseJson<{ content: string; encoding: string; sha: string }>(response);
        return { content: this.decodeContent(data.content, path), sha: data.sha };
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

    /**
     * The base URL for a GitHub-shaped Git Data API (e.g.
     * `https://api.github.com/repos/{owner}/{repo}` or
     * `{baseUrl}/api/v1/repos/{owner}/{repo}` for Gitea). Only meaningful for
     * providers that implement pushBatch/pushSymlink via this API shape.
     */
    protected getGitDataApiBase(): string {
        throw new Error('getGitDataApiBase is not implemented for this provider');
    }

    /**
     * Resolves a branch to its latest commit sha via GitHub's
     * `git/ref/heads/{branch}` endpoint. Gitea's older versions require a
     * different branch-resolution endpoint, so it provides its own override
     * rather than using this helper.
     *
     * Sent with `Cache-Control: no-cache` because GitHub returns API responses
     * as `private, max-age=60`: without it Electron's HTTP cache can answer this
     * read with the pre-commit oid for up to a minute after a write, which then
     * gets used as a base commit for the next one.
     */
    protected async getLatestCommitSha(branch: string): Promise<string> {
        const base = this.getGitDataApiBase();
        const refResp = await this.safeRequest(`${base}/git/ref/heads/${branch}`, 'GET', undefined, { 'Cache-Control': 'no-cache' });
        return this.parseJson<{ object: { sha: string } }>(refResp).object.sha;
    }

    /**
     * Resolves a branch to its latest commit sha and that commit's base tree
     * sha. Only needed by the REST Git Data API flow (pushSymlink, and
     * Gitea's pushBatch/deleteBatch which lack a GraphQL alternative).
     */
    protected async resolveGitHubStyleBaseTree(branch: string): Promise<{ latestCommitSha: string; baseTreeSha: string }> {
        const latestCommitSha = await this.getLatestCommitSha(branch);
        const base = this.getGitDataApiBase();
        const commitResp = await this.safeRequest(`${base}/git/commits/${latestCommitSha}`, 'GET');
        const baseTreeSha = this.parseJson<{ tree: { sha: string } }>(commitResp).tree.sha;

        return { latestCommitSha, baseTreeSha };
    }

    /**
     * Commits N tree items (already-created blobs) in one shot: builds a new
     * tree on top of baseTreeSha, commits it, and moves the branch ref to point
     * at the new commit. Shared by GitHub/Gitea's pushSymlink and pushBatch.
     */
    protected async commitGitHubStyleTree(
        base: string,
        branch: string,
        baseTreeSha: string,
        latestCommitSha: string,
        // A null sha removes that path from the resulting tree — how a batch
        // delete is expressed at the tree level (mode/type are still required
        // fields on the entry but are otherwise irrelevant for a deletion).
        treeItems: Array<{ path: string; mode: string; type: 'blob'; sha: string | null }>,
        message: string
    ): Promise<string> {
        const treeResp = await this.safeRequest(`${base}/git/trees`, 'POST', { base_tree: baseTreeSha, tree: treeItems });
        const newTreeSha = this.parseJson<{ sha: string }>(treeResp).sha;

        const newCommitResp = await this.safeRequest(`${base}/git/commits`, 'POST', {
            message,
            tree: newTreeSha,
            parents: [latestCommitSha],
        });
        const newCommitSha = this.parseJson<{ sha: string }>(newCommitResp).sha;

        await this.safeRequest(`${base}/git/refs/heads/${branch}`, 'PATCH', { sha: newCommitSha });

        return newCommitSha;
    }

    /**
     * Runs `fn` over `items` with at most `concurrency` calls in flight at
     * once, preserving result order. Used to parallelize independent
     * per-file requests (e.g. blob creation) that would otherwise pay N
     * round trips of latency running one at a time.
     */
    protected async mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
        const results = new Array<R>(items.length);
        let nextIndex = 0;
        const worker = async (): Promise<void> => {
            while (nextIndex < items.length) {
                const i = nextIndex++;
                results[i] = await fn(items[i] as T, i);
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
        return results;
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
    abstract pushFile(path: string, content: string | ArrayBuffer, branch: string, message: string, sha?: string, revision?: string): Promise<{ path: string, sha?: string }>;
    abstract listFilesDetailed(branch: string, useFilter?: boolean): Promise<GitTreeEntry[]>;
    abstract deleteFile(path: string, branch: string, message: string): Promise<void>;
    abstract testConnection(branch: string): Promise<ConnectionTestResult>;
}
