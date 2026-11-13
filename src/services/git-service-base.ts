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

const MAX_REQUEST_ATTEMPTS = 3;
const MAX_RETRY_BUDGET_MS = 60_000;
const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 10_000;

type RequestUrlOptions = Parameters<typeof requestUrl>[0];

type RequestOutcome =
    | { kind: 'success'; response: RequestUrlResponse }
    | { kind: 'http-error'; response: RequestUrlResponse }
    | { kind: 'network-error'; error: unknown };

interface RequestContext {
    options: RequestUrlOptions;
    method: string;
    target: string;
    safeToRetryNetworkFailure: boolean;
    startedAt: number;
    silent: boolean;
}

export abstract class BaseGitService {
    protected token: string = '';
    protected rootPath: string = '';

    /**
     * Safely wraps requestUrl to handle potential throws from Obsidian and provide better error messages.
     */
    protected async safeRequest(url: string, method: string, body?: unknown, extraHeaders?: Record<string, string>, silent = false): Promise<RequestUrlResponse> {
        const requestMethod = method.toUpperCase();
        const headers: Record<string, string> = {
            ...extraHeaders,
            'Content-Type': 'application/json',
        };
        this.addAuthHeader(headers);

        return this.requestWithRetries({
            options: {
                url,
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                throw: false,
            },
            method: requestMethod,
            target: this.requestTarget(url),
            safeToRetryNetworkFailure: ['GET', 'HEAD', 'OPTIONS'].includes(requestMethod),
            startedAt: Date.now(),
            silent,
        });
    }

    private async requestWithRetries(context: RequestContext): Promise<RequestUrlResponse> {
        for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
            const outcome = await this.requestOnce(context.options);
            if (outcome.kind === 'success') return outcome.response;

            const delayMs = this.retryDelayFor(outcome, context.safeToRetryNetworkFailure, attempt);
            if (delayMs === undefined) throw this.createRequestError(outcome, context);
            if (!this.canRetry(attempt, context.startedAt, delayMs)) {
                throw this.createRetryExhaustionError(outcome, context, attempt, delayMs);
            }

            this.logRetry(outcome, context, attempt, delayMs);
            await this.wait(delayMs);
        }

        throw new Error(`Git Service request retry budget exhausted: ${context.method} ${context.target}`);
    }

    private async requestOnce(options: RequestUrlOptions): Promise<RequestOutcome> {
        try {
            const response = await requestUrl(options);
            return response.status >= 400
                ? { kind: 'http-error', response }
                : { kind: 'success', response };
        } catch (error) {
            return { kind: 'network-error', error };
        }
    }

    private retryDelayFor(outcome: RequestOutcome, safeToRetryNetworkFailure: boolean, attempt: number): number | undefined {
        if (outcome.kind === 'http-error') {
            const isRateLimited = outcome.response.status === 429;
            const isTransientReadFailure = safeToRetryNetworkFailure && [502, 503, 504].includes(outcome.response.status);
            // A returned 429 confirms rate-limit rejection; unlike a transport
            // failure, it is safe to replay even when the method mutates state.
            return isRateLimited || isTransientReadFailure
                ? this.retryDelayMs(outcome.response.headers, attempt)
                : undefined;
        }

        if (outcome.kind !== 'network-error' || !safeToRetryNetworkFailure) return undefined;
        if (this.looksLikeJsonParseOfHtmlError(outcome.error) || !this.isTransientNetworkError(outcome.error)) return undefined;
        return this.retryDelayMs(undefined, attempt);
    }

    private canRetry(attempt: number, startedAt: number, delayMs: number): boolean {
        return attempt < MAX_REQUEST_ATTEMPTS && this.withinRetryBudget(startedAt, delayMs);
    }

    private logRetry(outcome: RequestOutcome, context: RequestContext, attempt: number, delayMs: number): void {
        if (context.silent) return;
        const reason = outcome.kind === 'http-error'
            ? `Git service HTTP ${outcome.response.status}`
            : 'Temporary network failure';
        logger.warn(`${reason}; retry ${attempt + 1}/${MAX_REQUEST_ATTEMPTS} in ${this.formatDelay(delayMs)}: ${context.method} ${context.target}`);
    }

    private createRequestError(outcome: RequestOutcome, context: RequestContext): Error {
        if (outcome.kind === 'http-error') return this.createHttpError(outcome.response, context);
        if (outcome.kind === 'network-error') return this.createNetworkError(outcome.error, context);
        return new Error('Git Service request returned an unexpected outcome');
    }

    private createHttpError(response: RequestUrlResponse, context: RequestContext): Error {
        const errorMsg = this.safeErrorMessage(this.parseErrorResponse(response));
        if (!context.silent) {
            if (response.status === 404) logger.debug(`Git Service 404 (not found): ${context.target}`);
            else logger.error(`Git Service Request Failed (${response.status}): ${context.target}`, errorMsg);
        }
        return new Error(`Git Service Error (${response.status}): ${errorMsg}`);
    }

    private createNetworkError(error: unknown, context: RequestContext): Error {
        if (this.isMutationMethod(context.method)) {
            const message = `Git Service mutation outcome is unknown for ${context.method} ${context.target}; the request was not retried to avoid duplicate changes. Refresh remote state before retrying. Cause: ${this.safeErrorMessage(error)}`;
            if (!context.silent) logger.error('Git Service mutation outcome is unknown:', message);
            return new Error(message);
        }

        if (this.looksLikeJsonParseOfHtmlError(error)) {
            return new Error(
                'Expected a JSON response from the Git server but received an HTML page ' +
                '(likely a login, SSO redirect, or proxy/error page). ' +
                'Please check the server URL, your access token, and any network proxy or firewall.'
            );
        }

        const message = this.safeErrorMessage(error);
        if (!context.silent) logger.error('Git Service Request Failed:', message);
        return error instanceof Error && error.message === message
            ? error
            : new Error(`Network error or unexpected failure: ${message}`);
    }

    private createRetryExhaustionError(outcome: RequestOutcome, context: RequestContext, attempt: number, delayMs: number): Error {
        const reason = this.retryStopReason(outcome, attempt, delayMs);
        if (outcome.kind === 'http-error') {
            const message = `Git Service Error (${outcome.response.status}): ${this.safeErrorMessage(this.parseErrorResponse(outcome.response))}; ${reason}.`;
            if (!context.silent) logger.error('Git Service retry stopped:', message);
            return new Error(message);
        }
        if (outcome.kind !== 'network-error') return new Error('Git Service retry stopped unexpectedly');

        const message = `Git Service network error (${context.method} ${context.target}) after ${attempt} attempt(s): ${this.safeErrorMessage(outcome.error)}; ${reason}.`;
        if (!context.silent) logger.error('Git Service retry stopped:', message);
        return new Error(message);
    }

    private retryStopReason(outcome: RequestOutcome, attempt: number, delayMs: number): string {
        if (attempt >= MAX_REQUEST_ATTEMPTS) return `automatic retries stopped after ${attempt} attempts`;
        const wait = this.formatDelay(delayMs);
        if (outcome.kind === 'http-error') {
            return `the server requested a ${wait} wait, beyond the ${this.formatDelay(MAX_RETRY_BUDGET_MS)} retry budget`;
        }
        return `the ${wait} backoff would exceed the ${this.formatDelay(MAX_RETRY_BUDGET_MS)} retry budget`;
    }

    private retryDelayMs(headers: Record<string, string> | undefined, failedAttempt: number): number {
        const retryAfter = this.getHeader(headers, 'retry-after');
        if (retryAfter !== undefined) {
            const delay = this.parseRetryAfter(retryAfter);
            if (delay !== undefined) return delay;
        }

        const resetTime = this.getHeader(headers, 'ratelimit-resettime');
        if (resetTime !== undefined) {
            const delay = this.parseRetryAfter(resetTime);
            if (delay !== undefined) return delay;
        }

        for (const header of ['ratelimit-reset', 'x-ratelimit-reset']) {
            const reset = this.getHeader(headers, header);
            if (reset === undefined) continue;
            const resetAtSeconds = Number(reset);
            if (Number.isFinite(resetAtSeconds)) return Math.max(0, resetAtSeconds * 1000 - Date.now());
        }

        const exponentialDelay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** (failedAttempt - 1), MAX_RETRY_DELAY_MS);
        // eslint-disable-next-line sonarjs/pseudo-random -- jitter is not security-sensitive.
        return Math.round(exponentialDelay * (0.5 + Math.random()));
    }

    private getHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
        const normalizedName = name.toLowerCase();
        for (const [header, value] of Object.entries(headers ?? {})) {
            if (header.toLowerCase() === normalizedName) return value.trim();
        }
        return undefined;
    }

    private parseRetryAfter(value: string): number | undefined {
        const seconds = Number(value);
        if (value.trim() !== '' && Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

        const retryAt = Date.parse(value);
        return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - Date.now());
    }

    private withinRetryBudget(startedAt: number, delayMs: number): boolean {
        return delayMs <= MAX_RETRY_BUDGET_MS && Date.now() - startedAt + delayMs <= MAX_RETRY_BUDGET_MS;
    }

    private wait(delayMs: number): Promise<void> {
        return new Promise(resolve => window.setTimeout(resolve, delayMs));
    }

    private formatDelay(delayMs: number): string {
        return `${Math.ceil(delayMs / 1000)}s`;
    }

    private requestTarget(url: string): string {
        try {
            const parsed = new URL(url);
            return `${parsed.origin}${parsed.pathname}`;
        } catch {
            return '[invalid request URL]';
        }
    }

    private safeErrorMessage(error: unknown): string {
        const message = this.errorMessage(error);
        return this.token ? message.split(this.token).join('[redacted]') : message;
    }

    private errorMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;
        if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
            return error.message;
        }
        return 'Unknown error';
    }

    private errorCause(error: unknown): unknown {
        if (error instanceof Error) return (error as Error & { cause?: unknown }).cause;
        if (typeof error === 'object' && error !== null && 'cause' in error) return error.cause;
        return undefined;
    }

    private errorCode(error: unknown): string {
        if (typeof error !== 'object' || error === null || !('code' in error)) return '';
        const code = error.code;
        return typeof code === 'string' || typeof code === 'number' ? `${code}` : '';
    }

    private isMutationMethod(method: string): boolean {
        return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    }

    private isTransientNetworkError(error: unknown): boolean {
        const parts: string[] = [];
        let current: unknown = error;
        for (let depth = 0; depth < 3 && current !== undefined && current !== null; depth += 1) {
            parts.push(this.safeErrorMessage(current), this.errorCode(current));
            current = this.errorCause(current);
        }
        return /fetch failed|failed to fetch|network|eai_again|enotfound|etimedout|timed? out|econnreset|econnrefused|ehostunreach|socket hang up|connection reset/i.test(parts.join(' '));
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
