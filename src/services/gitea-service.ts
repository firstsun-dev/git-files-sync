import { GitServiceInterface, GitTreeEntry, BatchPushItem, BatchPushResult, BatchMoveItem } from './git-service-interface';
import { BaseGitService, ConnectionTestResult, GitFile, GitHubContentResponse, GitHubTreeResponse, GIT_SYMLINK_MODE, BLOB_CREATE_CONCURRENCY } from './git-service-base';

export class GiteaService extends BaseGitService implements GitServiceInterface {
    private baseUrl: string = '';
    private owner: string = '';
    private repo: string = '';

    updateConfig(baseUrl: string, token: string, owner: string, repo: string, rootPath: string = '') {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
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
        return `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/contents/${encodedPath}`;
    }

    protected getGitDataApiBase(): string {
        return `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}`;
    }

    // Gitea's git/commits/{sha} endpoint needs a resolved commit sha, not a
    // branch ref name, and older Gitea versions don't expose GitHub's
    // git/ref/heads/{branch} endpoint at all — resolve via /branches/{branch}
    // instead, same as listFilesDetailed already does.
    private async resolveBaseTree(branch: string): Promise<{ latestCommitSha: string; baseTreeSha: string }> {
        const branchUrl = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/branches/${branch}`;
        const branchResp = await this.safeRequest(branchUrl, 'GET');
        const latestCommitSha = this.parseJson<{ commit: { id: string } }>(branchResp).commit.id;

        const commitResp = await this.safeRequest(`${this.getGitDataApiBase()}/git/commits/${latestCommitSha}`, 'GET');
        const baseTreeSha = this.parseJson<{ tree: { sha: string } }>(commitResp).tree.sha;

        return { latestCommitSha, baseTreeSha };
    }

    async getFile(path: string, branch: string): Promise<GitFile> {
        try {
            const url = `${this.getApiUrl(path)}?ref=${branch}`;
            const response = await this.safeRequest(url, 'GET');
            const data = this.parseJson<GitHubContentResponse>(response);

            return {
                content: this.decodeContent(data.content, path),
                sha: data.sha
            };
        } catch (e) {
            return this.handleFileNotFound(e);
        }
    }

    async pushFile(path: string, content: string | ArrayBuffer, branch: string, message: string, sha?: string, _revision?: string): Promise<{ path: string, sha?: string }> {
        const url = this.getApiUrl(path);
        const body: { message: string; content: string; branch: string; sha?: string } = {
            message,
            content: this.encodeContent(content),
            branch,
        };
        // Only send sha when updating an existing file; a blank sha is rejected.
        if (sha) body.sha = sha;

        const method = sha ? 'PUT' : 'POST';
        const response = await this.safeRequest(url, method, body);
        const data = this.parseJson<{ content: { path: string, sha: string } }>(response);
        return { path: data.content.path, sha: data.content.sha };
    }

    async pushBatch(items: BatchPushItem[], branch: string, message: string): Promise<BatchPushResult[]> {
        if (items.length === 0) return [];
        const base = this.getGitDataApiBase();
        const { latestCommitSha, baseTreeSha } = await this.resolveBaseTree(branch);

        const blobShas = await this.mapWithConcurrency(items, BLOB_CREATE_CONCURRENCY, async item => {
            const blobResp = await this.safeRequest(`${base}/git/blobs`, 'POST', {
                content: this.encodeContent(item.content),
                encoding: 'base64',
            });
            return this.parseJson<{ sha: string }>(blobResp).sha;
        });

        const treeItems = items.map((item, i) => ({
            path: this.getFullPath(item.path),
            mode: '100644',
            type: 'blob' as const,
            sha: blobShas[i] as string,
        }));

        await this.commitGitHubStyleTree(base, branch, baseTreeSha, latestCommitSha, treeItems, message);

        return items.map((item, i) => ({ path: item.path, sha: blobShas[i] }));
    }

    /**
     * A real `git mv`: additions get a new blob entry, moves get both a new
     * blob entry at the new path and a `sha: null` entry removing the old
     * one, all in the same tree/commit — same building block deleteBatch uses
     * for its null-sha removals.
     */
    async commitBatch(additions: BatchPushItem[], moves: BatchMoveItem[], branch: string, message: string): Promise<BatchPushResult[]> {
        if (additions.length === 0 && moves.length === 0) return [];
        const base = this.getGitDataApiBase();
        const { latestCommitSha, baseTreeSha } = await this.resolveBaseTree(branch);

        const additionBlobShas = await this.mapWithConcurrency(additions, BLOB_CREATE_CONCURRENCY, async item => {
            const blobResp = await this.safeRequest(`${base}/git/blobs`, 'POST', {
                content: this.encodeContent(item.content),
                encoding: 'base64',
            });
            return this.parseJson<{ sha: string }>(blobResp).sha;
        });
        const moveBlobShas = await this.mapWithConcurrency(moves, BLOB_CREATE_CONCURRENCY, async item => {
            const blobResp = await this.safeRequest(`${base}/git/blobs`, 'POST', {
                content: this.encodeContent(item.content),
                encoding: 'base64',
            });
            return this.parseJson<{ sha: string }>(blobResp).sha;
        });

        const treeItems = [
            ...additions.map((item, i) => ({ path: this.getFullPath(item.path), mode: '100644', type: 'blob' as const, sha: additionBlobShas[i] as string })),
            ...moves.map((item, i) => ({ path: this.getFullPath(item.newPath), mode: '100644', type: 'blob' as const, sha: moveBlobShas[i] as string })),
            ...moves.map(item => ({ path: this.getFullPath(item.oldPath), mode: '100644', type: 'blob' as const, sha: null })),
        ];

        await this.commitGitHubStyleTree(base, branch, baseTreeSha, latestCommitSha, treeItems, message);

        return [
            ...additions.map((item, i) => ({ path: item.path, sha: additionBlobShas[i] })),
            ...moves.map((item, i) => ({ path: item.newPath, sha: moveBlobShas[i] })),
        ];
    }

    async listFilesDetailed(branch: string, useFilter = true): Promise<GitTreeEntry[]> {
        // Resolve branch name to commit SHA first for compatibility with all Gitea versions,
        // since the git/trees endpoint requires a SHA (not a ref name) on older instances.
        const branchUrl = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/branches/${branch}`;
        let commitSha: string;
        try {
            const branchResponse = await this.safeRequest(branchUrl, 'GET');
            commitSha = this.parseJson<{ commit: { id: string } }>(branchResponse).commit.id;
        } catch (e) {
            throw this.branchNotFoundError(e, branch);
        }

        const treeUrl = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/git/trees/${commitSha}?recursive=1`;
        const treeResponse = await this.safeRequest(treeUrl, 'GET');
        const treeData = this.parseJson<GitHubTreeResponse>(treeResponse);

        if (treeData.truncated) throw new Error(`Gitea tree for branch "${branch}" is truncated; sync stopped to avoid treating an incomplete remote tree as a snapshot.`);

        const entries = treeData.tree
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
        return this.fetchGitHubStyleBlob(`${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/git/blobs/${sha}`, path);
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
        const base = this.getGitDataApiBase();
        const { latestCommitSha, baseTreeSha } = await this.resolveBaseTree(branch);

        const treeItems = paths.map(path => ({
            path: this.getFullPath(path),
            mode: '100644',
            type: 'blob' as const,
            sha: null,
        }));

        await this.commitGitHubStyleTree(base, branch, baseTreeSha, latestCommitSha, treeItems, message);
    }

    async testConnection(branch: string): Promise<ConnectionTestResult> {
        try {
            const url = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}`;
            await this.safeRequest(url, 'GET');
        } catch (e) {
            return { repoOk: false, branchOk: false, error: e instanceof Error ? e.message : String(e) };
        }

        try {
            const branchUrl = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/branches/${branch}`;
            await this.safeRequest(branchUrl, 'GET', undefined, undefined, true);
            return { repoOk: true, branchOk: true };
        } catch {
            return { repoOk: true, branchOk: false };
        }
    }
}
