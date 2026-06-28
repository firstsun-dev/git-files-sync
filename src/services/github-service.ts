import { GitServiceInterface, GitTreeEntry } from './git-service-interface';
import { BaseGitService, GitFile, GitHubContentResponse, GitHubTreeResponse, GIT_SYMLINK_MODE } from './git-service-base';
import { logger } from '../utils/logger';

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
        return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${fullPath}`;
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
        const base = `https://api.github.com/repos/${this.owner}/${this.repo}`;

        const refResp = await this.safeRequest(`${base}/git/ref/heads/${branch}`, 'GET');
        const latestCommitSha = this.parseJson<{ object: { sha: string } }>(refResp).object.sha;

        const commitResp = await this.safeRequest(`${base}/git/commits/${latestCommitSha}`, 'GET');
        const baseTreeSha = this.parseJson<{ tree: { sha: string } }>(commitResp).tree.sha;

        const blobResp = await this.safeRequest(`${base}/git/blobs`, 'POST', { content: target, encoding: 'utf-8' });
        const blobSha = this.parseJson<{ sha: string }>(blobResp).sha;

        const treeResp = await this.safeRequest(`${base}/git/trees`, 'POST', {
            base_tree: baseTreeSha,
            tree: [{ path: fullPath, mode: GIT_SYMLINK_MODE, type: 'blob', sha: blobSha }],
        });
        const newTreeSha = this.parseJson<{ sha: string }>(treeResp).sha;

        const newCommitResp = await this.safeRequest(`${base}/git/commits`, 'POST', {
            message,
            tree: newTreeSha,
            parents: [latestCommitSha],
        });
        const newCommitSha = this.parseJson<{ sha: string }>(newCommitResp).sha;

        await this.safeRequest(`${base}/git/refs/heads/${branch}`, 'PATCH', { sha: newCommitSha });

        return { path: fullPath, sha: blobSha };
    }

    async listFilesDetailed(branch: string, useFilter = true): Promise<GitTreeEntry[]> {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees/${branch}?recursive=1`;
        const response = await this.safeRequest(url, 'GET');
        const data = this.parseJson<GitHubTreeResponse>(response);

        if (data.truncated) {
            logger.warn('GitHub tree result is truncated. Some files might not be shown.');
        }

        const entries = data.tree
            .filter(item => item.type === 'blob')
            .map(item => ({ path: item.path, symlink: item.mode === GIT_SYMLINK_MODE }));

        if (!useFilter) return entries;

        return entries.filter(e => {
            if (!this.rootPath) return true;
            const cleanRoot = this.rootPath.endsWith('/') ? this.rootPath : `${this.rootPath}/`;
            return e.path === this.rootPath || e.path.startsWith(cleanRoot);
        });
    }

    async deleteFile(path: string, branch: string, message: string): Promise<void> {
        const file = await this.getFile(path, branch);
        const url = this.getApiUrl(path);
        const body = {
            message,
            sha: file.sha,
            branch
        };

        await this.safeRequest(url, 'DELETE', body);
    }

    async testConnection(): Promise<boolean> {
        try {
            const url = `https://api.github.com/repos/${this.owner}/${this.repo}`;
            await this.safeRequest(url, 'GET');
            return true;
        } catch {
            return false;
        }
    }

}
