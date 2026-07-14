import { GitServiceInterface, GitTreeEntry, BatchPushItem, BatchPushResult } from './git-service-interface';
import { BaseGitService, ConnectionTestResult, GitFile, GitHubContentResponse, GitHubTreeResponse, GIT_SYMLINK_MODE } from './git-service-base';
import { logger } from '../utils/logger';

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
        const encodedPath = fullPath.split('/').map(encodeURIComponent).join('/');
        return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodedPath}`;
    }

    protected getGitDataApiBase(): string {
        return `https://api.github.com/repos/${this.owner}/${this.repo}`;
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

    async pushFile(path: string, content: string | ArrayBuffer, branch: string, message: string, sha?: string): Promise<{ path: string, sha?: string }> {
        const url = this.getApiUrl(path);
        const body: { message: string; content: string; branch: string; sha?: string } = {
            message,
            content: this.encodeContent(content),
            branch,
        };
        // GitHub's Contents API rejects a blank sha with HTTP 422. Only include
        // it when updating an existing file; a 404 lookup yields sha === '' for
        // new files, which must be created without a sha.
        if (sha) body.sha = sha;

        const response = await this.safeRequest(url, 'PUT', body);
        const data = this.parseJson<{ content: { path: string, sha: string } }>(response);
        return { path: data.content.path, sha: data.content.sha };
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
    private async githubGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
        const response = await this.safeRequest('https://api.github.com/graphql', 'POST', { query, variables });
        const body = this.parseJson<{ data?: T; errors?: Array<{ message: string }> }>(response);
        if (body.errors && body.errors.length > 0) {
            throw new Error(`GitHub GraphQL error: ${body.errors.map(e => e.message).join('; ')}`);
        }
        if (!body.data) {
            throw new Error('GitHub GraphQL response returned no data');
        }
        return body.data;
    }

    /**
     * Runs createCommitOnBranch, re-reading the branch HEAD and retrying on a
     * stale-expectedHeadOid failure. GitHub's git/ref/heads/{branch} read (used
     * to get expectedHeadOid) can briefly lag a just-completed write to the same
     * branch — e.g. a push immediately followed by a delete — so the oid it
     * returns may predate a file the caller is trying to add or remove, and
     * GitHub reports that as "path does not exist in tree <oid>" rather than as
     * an obvious staleness error. A short retry with a freshly re-read HEAD
     * self-heals once GitHub's read catches up.
     */
    private async commitOnBranch(branch: string, message: string, fileChanges: Record<string, unknown>): Promise<string> {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const expectedHeadOid = await this.getLatestCommitSha(branch);
            try {
                const data = await this.githubGraphQL<{ createCommitOnBranch: { commit: { oid: string } } }>(CREATE_COMMIT_MUTATION, {
                    input: {
                        branch: { repositoryNameWithOwner: `${this.owner}/${this.repo}`, branchName: branch },
                        message: { headline: message },
                        expectedHeadOid,
                        fileChanges,
                    },
                });
                return data.createCommitOnBranch.commit.oid;
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                const looksStale = /does not exist in tree|does not match|expectedHeadOid/i.test(errorMessage);
                if (!looksStale || attempt === maxAttempts) throw e;
                await new Promise(resolve => window.setTimeout(resolve, 500 * attempt));
            }
        }
        // Unreachable: the loop always returns or throws.
        throw new Error('commitOnBranch: exhausted retries without a result');
    }

    async pushBatch(items: BatchPushItem[], branch: string, message: string): Promise<BatchPushResult[]> {
        if (items.length === 0) return [];

        await this.commitOnBranch(branch, message, {
            additions: items.map(item => ({
                path: this.getFullPath(item.path),
                contents: this.encodeContent(item.content),
            })),
        });

        // createCommitOnBranch only returns the new commit's oid, not each
        // file's blob sha, so read them back with a follow-up tree fetch
        // (mirrors GitLab's pushBatch, which has the same limitation). That
        // fetch is exposed to the same eventual-consistency lag the retry
        // above works around, so a fresh tree can still be briefly missing an
        // entry that was just committed; retry it too rather than silently
        // returning an undefined sha for that file.
        const fullPaths = items.map(item => this.getFullPath(item.path));
        for (let attempt = 1; attempt <= 3; attempt++) {
            const freshTree = await this.listFilesDetailed(branch, false);
            const shaByPath = new Map(freshTree.map(e => [e.path, e.sha]));
            const results = items.map((item, i) => ({ path: item.path, sha: shaByPath.get(fullPaths[i] as string) }));
            if (results.every(r => r.sha) || attempt === 3) return results;
            await new Promise(resolve => window.setTimeout(resolve, 500 * attempt));
        }
        // Unreachable: the loop always returns on its last iteration.
        throw new Error('pushBatch: exhausted retries reading back blob shas');
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
