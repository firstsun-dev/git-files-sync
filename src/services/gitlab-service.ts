import { GitServiceInterface, GitTreeEntry, BatchPushItem, BatchPushResult, BatchCommitPlan } from './git-service-interface';
import { BaseGitService, ConnectionTestResult, GitFile, GitLabFileResponse, GitLabTreeItem, GIT_SYMLINK_MODE } from './git-service-base';
import { isBinaryPath } from '../utils/path';

export class GitLabService extends BaseGitService implements GitServiceInterface {
    private baseUrl: string = 'https://gitlab.com';
    private projectId: string = '';

    updateConfig(baseUrl: string, token: string, projectId: string, rootPath: string = '') {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.token = token;
        this.projectId = projectId;
        this.rootPath = rootPath;
    }

    protected addAuthHeader(headers: Record<string, string>): void {
        headers['PRIVATE-TOKEN'] = this.token;
    }

    private getApiUrl(path: string): string {
        const fullPath = this.getFullPath(path);
        const encodedPath = encodeURIComponent(fullPath);
        const encodedProjectId = encodeURIComponent(this.projectId);
        return `${this.baseUrl}/api/v4/projects/${encodedProjectId}/repository/files/${encodedPath}`;
    }

    async getFile(path: string, branch: string): Promise<GitFile> {
        try {
            const url = `${this.getApiUrl(path)}?ref=${branch}`;
            const response = await this.safeRequest(url, 'GET');
            const data = this.parseJson<GitLabFileResponse>(response);

            return {
                content: this.decodeContent(data.content, path),
                sha: data.blob_id,
                revision: data.last_commit_id
            };
        } catch (e) {
            return this.handleFileNotFound(e);
        }
    }

    async pushFile(path: string, content: string | ArrayBuffer, branch: string, message: string, sha?: string, revision?: string): Promise<{ path: string, sha?: string }> {
        const url = this.getApiUrl(path);
        const body: { branch: string; content: string; encoding: string; commit_message: string; last_commit_id?: string } = {
            branch,
            content: this.encodeContent(content),
            encoding: 'base64',
            commit_message: message,
        };
        // A blank sha means the file is new: create it (POST). Use revision for GitLab's optimistic locking.
        if (revision) body.last_commit_id = revision;

        const method = sha ? 'PUT' : 'POST';
        const response = await this.safeRequest(url, method, body);
        const data = this.parseJson<GitLabFileResponse>(response);
        return { path: data.file_path };
    }

    async pushBatch(items: BatchPushItem[], branch: string, message: string): Promise<BatchPushResult[]> {
        if (items.length === 0) return [];
        const encodedProjectId = encodeURIComponent(this.projectId);
        const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/repository/commits`;

        const actions = await Promise.all(items.map(async item => ({
            action: item.existedRemotely ? 'update' : 'create',
            file_path: this.getFullPath(item.path),
            content: this.encodeContent(item.content),
            encoding: 'base64',
            ...(item.existedRemotely && item.revision ? { last_commit_id: item.revision } : {}),
        })));

        await this.safeRequest(url, 'POST', { branch, commit_message: message, actions });

        // The Commits API response doesn't include each file's new blob sha, so
        // read it back via a single follow-up tree fetch (one extra call for the
        // whole batch, not per file) rather than per-file getFile calls.
        const freshTree = await this.listFilesDetailed(branch, false);
        const shaByPath = new Map(freshTree.map(e => [e.path, e.sha]));
        return items.map(item => ({ path: item.path, sha: shaByPath.get(this.getFullPath(item.path)) }));
    }

    /**
     * A real `git mv`: additions and moves land in one commit via the Commits
     * API's native `action: 'move'`, which GitLab records as an actual rename
     * (previous_path) rather than a same-content add+delete pair. Plain
     * deletions ride in the same `actions[]` as `action: 'delete'`, so a Sync
     * Plan mixing writes/moves/deletions still lands as one commit.
     */
    async commitBatch(plan: BatchCommitPlan, branch: string, message: string): Promise<BatchPushResult[]> {
        const { writes, moves, deletions } = plan;
        if (writes.length === 0 && moves.length === 0 && deletions.length === 0) return [];
        const encodedProjectId = encodeURIComponent(this.projectId);
        const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/repository/commits`;

        const actions = [
            ...await Promise.all(writes.map(async item => ({
                action: item.existedRemotely ? 'update' : 'create',
                file_path: this.getFullPath(item.path),
                content: this.encodeContent(item.content),
                encoding: 'base64',
                ...(item.existedRemotely && item.revision ? { last_commit_id: item.revision } : {}),
            }))),
            ...await Promise.all(moves.map(async item => ({
                action: 'move',
                file_path: this.getFullPath(item.newPath),
                previous_path: this.getFullPath(item.oldPath),
                content: this.encodeContent(item.content),
                encoding: 'base64',
                ...(item.oldRevision ? { last_commit_id: item.oldRevision } : {}),
            }))),
            ...await Promise.all(deletions.map(async path => ({
                action: 'delete',
                file_path: this.getFullPath(path),
                last_commit_id: (await this.getFile(path, branch)).revision,
            }))),
        ];

        await this.safeRequest(url, 'POST', { branch, commit_message: message, actions });

        const freshTree = await this.listFilesDetailed(branch, false);
        const shaByPath = new Map(freshTree.map(e => [e.path, e.sha]));
        return [
            ...writes.map(item => ({ path: item.path, sha: shaByPath.get(this.getFullPath(item.path)) })),
            ...moves.map(item => ({ path: item.newPath, sha: shaByPath.get(this.getFullPath(item.newPath)) })),
        ];
    }

    async listFilesDetailed(branch: string, useFilter = true): Promise<GitTreeEntry[]> {
        const encodedProjectId = encodeURIComponent(this.projectId);
        let allEntries: GitTreeEntry[] = [];
        let page = 1;
        const perPage = 100;

        while (true) {
            const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/repository/tree?ref=${branch}&recursive=true&per_page=${perPage}&page=${page}`;
            let data: GitLabTreeItem[];
            try {
                const response = await this.safeRequest(url, 'GET');
                data = this.parseJson<GitLabTreeItem[]>(response);
            } catch (e) {
                throw this.branchNotFoundError(e, branch);
            }

            if (!data || data.length === 0) break;

            const entries = data
                .filter(item => item.type === 'blob')
                .map(item => ({ path: item.path, symlink: item.mode === GIT_SYMLINK_MODE, sha: item.id }));

            if (useFilter) {
                const filtered = entries.filter(e => {
                    if (!this.rootPath) return true;
                    const cleanRoot = this.rootPath.endsWith('/') ? this.rootPath : `${this.rootPath}/`;
                    return e.path === this.rootPath || e.path.startsWith(cleanRoot);
                });
                allEntries = allEntries.concat(filtered);
            } else {
                allEntries = allEntries.concat(entries);
            }

            if (data.length < perPage) break;
            page++;
        }

        return allEntries;
    }

    async getBlob(sha: string, path: string): Promise<GitFile> {
        // Unlike GitHub/Gitea's base64-JSON blob endpoint, GitLab's raw blob
        // endpoint returns the file's actual bytes directly.
        const encodedProjectId = encodeURIComponent(this.projectId);
        const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/repository/blobs/${sha}/raw`;
        const response = await this.safeRequest(url, 'GET');
        const content = isBinaryPath(path) ? response.arrayBuffer : response.text;
        return { content, sha };
    }

    async deleteFile(path: string, branch: string, message: string): Promise<void> {
        const url = this.getApiUrl(path);
        const body = {
            branch,
            commit_message: message
        };

        await this.safeRequest(url, 'DELETE', body);
    }

    async deleteBatch(paths: string[], branch: string, message: string): Promise<void> {
        if (paths.length === 0) return;
        const encodedProjectId = encodeURIComponent(this.projectId);
        const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/repository/commits`;

        const actions = await Promise.all(paths.map(async path => ({
            action: 'delete',
            file_path: this.getFullPath(path),
            last_commit_id: (await this.getFile(path, branch)).revision,
        })));

        await this.safeRequest(url, 'POST', { branch, commit_message: message, actions });
    }

    async testConnection(branch: string): Promise<ConnectionTestResult> {
        const encodedProjectId = encodeURIComponent(this.projectId);
        try {
            const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}`;
            await this.safeRequest(url, 'GET');
        } catch (e) {
            return { repoOk: false, branchOk: false, error: e instanceof Error ? e.message : String(e) };
        }

        try {
            const encodedBranch = encodeURIComponent(branch);
            const branchUrl = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/repository/branches/${encodedBranch}`;
            await this.safeRequest(branchUrl, 'GET', undefined, undefined, true);
            return { repoOk: true, branchOk: true };
        } catch {
            return { repoOk: true, branchOk: false };
        }
    }

}
