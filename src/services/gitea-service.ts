import { GitServiceInterface, GitTreeEntry, BatchPushItem, BatchPushResult, BatchMoveItem } from './git-service-interface';
import { BaseGitService, ConnectionTestResult, GitFile, GitHubContentResponse, GitHubTreeResponse, GIT_SYMLINK_MODE } from './git-service-base';

/** One entry in a Gitea "change multiple files" request. */
interface GiteaChangeFileOperation {
    operation: 'create' | 'update' | 'delete';
    path: string;
    content?: string;
    from_path?: string;
}

interface GiteaFilesResponse {
    files: Array<{ path: string; sha: string } | null>;
}

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

    /**
     * Commits several file changes at once via Gitea's "change multiple
     * files" contents API. Gitea's Git Data API (git/blobs, git/trees,
     * git/commits POST, git/refs PATCH) — the GitHub-shaped flow GitHub's
     * commitGitHubStyleTree uses — is read-only in Gitea; there is no write
     * endpoint for it (confirmed against a real instance via its swagger
     * spec, not just the mocks the unit tests used). This is Gitea's actual
     * equivalent of a single atomic multi-file commit.
     */
    private async changeFiles(files: GiteaChangeFileOperation[], branch: string, message: string): Promise<GiteaFilesResponse> {
        const url = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/contents`;
        const response = await this.safeRequest(url, 'POST', { branch, message, files });
        return this.parseJson<GiteaFilesResponse>(response);
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

        // Gitea's 'create' operation 422s if the path already exists, and
        // 'update' 500s if it doesn't — unlike the old tree-based commit,
        // this contents API distinguishes them, so existedRemotely (already
        // needed by GitLab) now matters for Gitea too.
        const files: GiteaChangeFileOperation[] = items.map(item => ({
            operation: item.existedRemotely ? 'update' : 'create',
            path: this.getFullPath(item.path),
            content: this.encodeContent(item.content),
        }));

        const result = await this.changeFiles(files, branch, message);
        return items.map((item, i) => ({ path: item.path, sha: result.files[i]?.sha }));
    }

    /**
     * A real `git mv`: additions are created at their new path, moves are
     * expressed as an 'update' of the new path with `from_path` set to the
     * old one — both a content write and a rename in the same commit.
     */
    async commitBatch(additions: BatchPushItem[], moves: BatchMoveItem[], branch: string, message: string): Promise<BatchPushResult[]> {
        if (additions.length === 0 && moves.length === 0) return [];

        const files: GiteaChangeFileOperation[] = [
            ...additions.map((item): GiteaChangeFileOperation => ({
                // A "keep local" conflict resolution lands here as an addition
                // that already exists remotely (e.g. from planPushBatch merging
                // a resolved conflict into the ordinary push list); Gitea 422s
                // on 'create' for a path that already exists, so this must
                // respect existedRemotely exactly like pushBatch does above.
                operation: item.existedRemotely ? 'update' : 'create',
                path: this.getFullPath(item.path),
                content: this.encodeContent(item.content),
            })),
            ...moves.map((item): GiteaChangeFileOperation => ({
                operation: 'update',
                path: this.getFullPath(item.newPath),
                from_path: this.getFullPath(item.oldPath),
                content: this.encodeContent(item.content),
            })),
        ];

        const result = await this.changeFiles(files, branch, message);
        return [
            ...additions.map((item, i) => ({ path: item.path, sha: result.files[i]?.sha })),
            ...moves.map((item, i) => ({ path: item.newPath, sha: result.files[additions.length + i]?.sha })),
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
        const files: GiteaChangeFileOperation[] = paths.map(path => ({
            operation: 'delete',
            path: this.getFullPath(path),
        }));
        await this.changeFiles(files, branch, message);
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
