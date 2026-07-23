import { GitServiceInterface, GitTreeEntry, BatchPushItem, BatchPushResult } from './git-service-interface';
import { BaseGitService, ConnectionTestResult, GitFile, GitHubContentResponse, GitHubTreeResponse, GIT_SYMLINK_MODE, BLOB_CREATE_CONCURRENCY } from './git-service-base';
import { logger } from '../utils/logger';
import { PushTimingCollector, PushTimingHandler, PushTimingRecord } from './push-timing';

/**
 * Commits any mix of file additions/deletions in one request. Used instead of
 * the REST Git Data API's blob -> tree -> commit -> ref sequence for
 * pushBatch/deleteBatch: those need one HTTP round trip per blob to upload
 * content, while this mutation carries file content directly in the request
 * body, so an N-file batch is one call instead of N+~5.
 */
const CREATE_COMMIT_MUTATION = `
    mutation ($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) {
            commit { oid }
        }
    }
`;

/**
 * Reads a branch's head commit through GraphQL — the same backend
 * createCommitOnBranch validates `expectedHeadOid` against.
 */
const BRANCH_HEAD_QUERY = `
    query ($owner: String!, $name: String!, $qualifiedName: String!) {
        repository(owner: $owner, name: $name) {
            ref(qualifiedName: $qualifiedName) { target { oid } }
        }
    }
`;

/**
 * Messages GitHub uses for a createCommitOnBranch call whose `expectedHeadOid`
 * no longer matches the branch head. The wording differs by cause: a moved
 * branch reports "Expected branch to point to \"<oid>\" but it did not. Pull and
 * try again.", while a HEAD read that lags a just-completed write surfaces as
 * "path does not exist in tree <oid>" instead.
 */
const STALE_HEAD_ERROR = /expected branch to point to|pull and try again|does not exist in tree|head sha was modified|does not match|expectedHeadOid/i;

export class GitHubService extends BaseGitService implements GitServiceInterface {
    private owner: string = '';
    private repo: string = '';
    private pushTimingHandler?: PushTimingHandler;

    /** Enables local diagnostic records; the plugin itself never enables this. */
    setPushTimingHandler(handler?: PushTimingHandler): void {
        this.pushTimingHandler = handler;
    }

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
        const encodedPath = fullPath.split('/').map(encodeURIComponent).join('/');
        return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodedPath}`;
    }

    protected getGitDataApiBase(): string {
        return `https://api.github.com/repos/${this.owner}/${this.repo}`;
    }

    async getBranchHead(branch: string): Promise<string> {
        return this.getLatestCommitSha(branch);
    }

    async getFile(path: string, branch: string): Promise<GitFile> {
        try {
            const url = `${this.getApiUrl(path)}?ref=${branch}`;
            const response = await this.safeRequest(url, 'GET');
            const data = this.parseJson<GitHubContentResponse & { type?: string; target?: string }>(response);

            // An unresolved symlink is returned as type 'symlink' with the literal
            // target. (Links whose target is a normal in-repo file are followed by
            // the Contents API and come back as ordinary file content.)
            if (data.type === 'symlink') {
                return { content: '', sha: data.sha, isSymlink: true, symlinkTarget: data.target };
            }

            return {
                content: this.decodeContent(data.content, path),
                sha: data.sha
            };
        } catch (e) {
            return this.handleFileNotFound(e);
        }
    }

    async pushFile(path: string, content: string | ArrayBuffer, branch: string, message: string, _existingSha?: string): Promise<{ path: string, sha?: string }> {
        const [result] = await this.pushBatch([{ path, content }], branch, message);
        return result ?? { path };
    }

    async pushSymlink(path: string, target: string, branch: string, message: string): Promise<{ path: string, sha?: string }> {
        // The Contents API can only create regular (100644) files, so symlinks
        // (mode 120000) must be committed through the lower-level Git Data API:
        // blob -> tree (with the symlink mode) -> commit -> move the branch ref.
        const fullPath = this.getFullPath(path);
        const base = this.getGitDataApiBase();

        const { latestCommitSha, baseTreeSha } = await this.resolveGitHubStyleBaseTree(branch);

        const blobResp = await this.safeRequest(`${base}/git/blobs`, 'POST', { content: target, encoding: 'utf-8' });
        const blobSha = this.parseJson<{ sha: string }>(blobResp).sha;

        await this.commitGitHubStyleTree(
            base, branch, baseTreeSha, latestCommitSha,
            [{ path: fullPath, mode: GIT_SYMLINK_MODE, type: 'blob', sha: blobSha }],
            message
        );

        return { path: fullPath, sha: blobSha };
    }

    /**
     * Calls a GitHub GraphQL mutation. GraphQL reports mutation-level failures
     * (e.g. a stale expectedHeadOid) as a 200 response with an `errors` array
     * rather than an HTTP error status, so this checks for that on top of
     * safeRequest's status-code check.
     */
    private async githubGraphQL<T>(query: string, variables: Record<string, unknown>, timing?: PushTimingCollector): Promise<T> {
        const request = () => this.safeRequest('https://api.github.com/graphql', 'POST', { query, variables });
        const response = timing ? await timing.measureRequest(request) : await request();
        const parse = () => this.parseJson<{ data?: T; errors?: Array<{ message: string }> }>(response);
        const body = timing ? timing.measureParsing(parse) : parse();
        if (body.errors && body.errors.length > 0) {
            throw new Error(`GitHub GraphQL error: ${body.errors.map(e => e.message).join('; ')}`);
        }
        if (!body.data) {
            throw new Error('GitHub GraphQL response returned no data');
        }
        return body.data;
    }

    /**
     * Resolves the branch head for `expectedHeadOid` via GraphQL rather than the
     * REST git/ref read. GitHub serves REST responses with
     * `Cache-Control: private, max-age=60`, so after a commit the ref endpoint
     * can keep returning the previous oid for up to a minute — every retry would
     * then resend the same stale oid and fail identically. GraphQL is a POST
     * against the same backend the mutation validates against, so it is neither
     * cached nor a lagging replica. Falls back to the REST read when GraphQL
     * reports no such ref, so a missing branch still surfaces REST's 404.
     */
    private async getBranchHeadOid(branch: string): Promise<string> {
        const data = await this.githubGraphQL<{ repository?: { ref?: { target?: { oid?: string } | null } | null } | null }>(
            BRANCH_HEAD_QUERY,
            { owner: this.owner, name: this.repo, qualifiedName: `refs/heads/${branch}` },
        );
        return data.repository?.ref?.target?.oid ?? await this.getLatestCommitSha(branch);
    }

    /**
     * Runs createCommitOnBranch, re-reading the branch HEAD and retrying on a
     * stale-expectedHeadOid failure. The head can move under us between the read
     * and the mutation — another client (or another chunk of the same push)
     * committing to the same branch — and a HEAD read can also briefly lag a
     * just-completed write to it, e.g. a push immediately followed by a delete.
     * Either way a retry with a freshly re-read HEAD self-heals.
     */
    private async commitOnBranch(branch: string, message: string, fileChanges: Record<string, unknown>, timing?: PushTimingCollector): Promise<string> {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const getHead = () => this.getBranchHeadOid(branch);
            const expectedHeadOid = timing ? await timing.measureRequest(getHead) : await getHead();
            try {
                const data = await this.githubGraphQL<{ createCommitOnBranch: { commit: { oid: string } } }>(CREATE_COMMIT_MUTATION, {
                    input: {
                        branch: { repositoryNameWithOwner: `${this.owner}/${this.repo}`, branchName: branch },
                        message: { headline: message },
                        expectedHeadOid,
                        fileChanges,
                    },
                }, timing);
                return data.createCommitOnBranch.commit.oid;
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                if (!STALE_HEAD_ERROR.test(errorMessage)) throw e;
                if (attempt === maxAttempts) {
                    throw new Error(
                        `${errorMessage} — the remote branch "${branch}" kept moving during the push ` +
                        `(${maxAttempts} attempts). Pull, then push again.`
                    );
                }
                await new Promise(resolve => window.setTimeout(resolve, 500 * attempt));
            }
        }
        // Unreachable: the loop always returns or throws.
        throw new Error('commitOnBranch: exhausted retries without a result');
    }

    async pushBatch(items: BatchPushItem[], branch: string, message: string): Promise<BatchPushResult[]> {
        if (items.length === 0) return [];
        const timing = this.pushTimingHandler ? new PushTimingCollector() : undefined;
        const preparationStartedAt = performance.now();
        const preparedItems = items.map(item => ({ item, path: this.getFullPath(item.path) }));
        const rawBytes = items.reduce((total, item) => total + this.getByteLength(item.content), 0);
        const changePreparationMs = performance.now() - preparationStartedAt;
        const encodingStartedAt = performance.now();
        const additions = preparedItems.map(({ item, path }) => ({ path, contents: this.encodeContent(item.content) }));
        const encodedBytes = additions.reduce((total, addition) => total + this.getByteLength(addition.contents), 0);
        const encodingMs = performance.now() - encodingStartedAt;
        let failure: unknown;

        try {
            await this.commitOnBranch(branch, message, { additions }, timing);
            // The caller already marks committed paths as synced. Avoiding a
            // full recursive tree read saves a request and sidesteps GitHub's
            // briefly stale tree reads after a successful mutation.
            return items.map(item => ({ path: item.path }));
        } catch (error) {
            failure = error;
            throw error;
        } finally {
            this.emitPushTiming(timing, 'github-graphql', items.length, rawBytes, encodedBytes, changePreparationMs, encodingMs, failure);
        }
    }

    /**
     * Developer-only Git Data API control path for benchmark #61. Production
     * pushes continue to use GraphQL because this path requires one blob POST
     * per file. It is intentionally not part of GitServiceInterface.
     */
    async pushBatchViaGitDataApiForBenchmark(items: BatchPushItem[], branch: string, message: string): Promise<BatchPushResult[]> {
        if (items.length === 0) return [];

        const base = this.getGitDataApiBase();
        const { latestCommitSha, baseTreeSha } = await this.resolveGitHubStyleBaseTree(branch);
        const fullPaths = items.map(item => this.getFullPath(item.path));
        const blobShas = await this.mapWithConcurrency(items, BLOB_CREATE_CONCURRENCY, async item => {
            const response = await this.safeRequest(`${base}/git/blobs`, 'POST', {
                content: this.encodeContent(item.content),
                encoding: 'base64',
            });
            return this.parseJson<{ sha: string }>(response).sha;
        });

        await this.commitGitHubStyleTree(
            base, branch, baseTreeSha, latestCommitSha,
            fullPaths.map((path, index) => ({ path, mode: '100644', type: 'blob' as const, sha: blobShas[index] as string })),
            message
        );
        return items.map((item, index) => ({ path: item.path, sha: blobShas[index] }));
    }

    private getByteLength(content: string | ArrayBuffer): number {
        return typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content.byteLength;
    }

    private getErrorMessage(error: unknown): string | undefined {
        if (error === undefined) return undefined;
        return error instanceof Error ? error.message : 'Non-Error push failure';
    }

    private emitPushTiming(timing: PushTimingCollector | undefined, strategy: PushTimingRecord['strategy'], fileCount: number, rawBytes: number, encodedBytes: number, changePreparationMs: number, encodingMs: number, error?: unknown): void {
        if (!timing || !this.pushTimingHandler) return;
        const failure = this.getErrorMessage(error);
        this.pushTimingHandler(timing.createRecord(strategy, fileCount, rawBytes, encodedBytes, changePreparationMs, encodingMs, failure));
    }

    async listFilesDetailed(branch: string, useFilter = true): Promise<GitTreeEntry[]> {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees/${branch}?recursive=1`;
        let data: GitHubTreeResponse;
        try {
            const response = await this.safeRequest(url, 'GET');
            data = this.parseJson<GitHubTreeResponse>(response);
        } catch (e) {
            throw this.branchNotFoundError(e, branch);
        }

        if (data.truncated) {
            logger.warn('GitHub tree result is truncated. Some files might not be shown.');
        }

        const entries = data.tree
            .filter(item => item.type === 'blob')
            .map(item => ({ path: item.path, symlink: item.mode === GIT_SYMLINK_MODE, sha: item.sha }));

        if (!useFilter) return entries;

        return entries.filter(e => {
            if (!this.rootPath) return true;
            const cleanRoot = this.rootPath.endsWith('/') ? this.rootPath : `${this.rootPath}/`;
            return e.path === this.rootPath || e.path.startsWith(cleanRoot);
        });
    }

    async getBlob(sha: string, path: string): Promise<GitFile> {
        return this.fetchGitHubStyleBlob(`https://api.github.com/repos/${this.owner}/${this.repo}/git/blobs/${sha}`, path);
    }

    async deleteFile(path: string, branch: string, message: string): Promise<void> {
        const file = await this.getFile(path, branch);
        if (!file.sha) {
            throw new Error(`Cannot delete "${path}": file was not found on branch "${branch}".`);
        }
        const url = this.getApiUrl(path);
        const body = {
            message,
            sha: file.sha,
            branch
        };

        await this.safeRequest(url, 'DELETE', body);
    }

    async deleteBatch(paths: string[], branch: string, message: string): Promise<void> {
        if (paths.length === 0) return;

        await this.commitOnBranch(branch, message, {
            deletions: paths.map(path => ({ path: this.getFullPath(path) })),
        });
    }

    async testConnection(branch: string): Promise<ConnectionTestResult> {
        try {
            const url = `https://api.github.com/repos/${this.owner}/${this.repo}`;
            await this.safeRequest(url, 'GET');
        } catch (e) {
            return { repoOk: false, branchOk: false, error: e instanceof Error ? e.message : String(e) };
        }

        try {
            const branchUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/branches/${branch}`;
            await this.safeRequest(branchUrl, 'GET', undefined, undefined, true);
            return { repoOk: true, branchOk: true };
        } catch {
            return { repoOk: true, branchOk: false };
        }
    }

}
