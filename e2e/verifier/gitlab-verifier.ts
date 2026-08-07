import type { RemoteVerifier } from './verifier-contract';

/**
 * Independent verifier for GitLab: talks to GitLab's raw REST API directly
 * via fetch, with no dependency on src/services/gitlab-service.ts. Suites use
 * this to confirm GitLabService's writes actually landed, instead of asking
 * GitLabService to read back its own writes (which would only prove
 * self-consistency, not correctness).
 */
export class GitLabVerifier implements RemoteVerifier {
    constructor(
        private readonly baseUrl: string,
        private readonly projectId: string,
        private readonly token: string
    ) {}

    private headers(): Record<string, string> {
        return { 'PRIVATE-TOKEN': this.token };
    }

    private get encodedProjectId(): string {
        return encodeURIComponent(this.projectId);
    }

    async getFile(path: string, ref: string): Promise<{ content: string; sha: string } | null> {
        const encodedPath = encodeURIComponent(path);
        const url = `${this.baseUrl}/api/v4/projects/${this.encodedProjectId}/repository/files/${encodedPath}?ref=${encodeURIComponent(ref)}`;
        const res = await fetch(url, { headers: this.headers() });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GitLabVerifier.getFile failed: ${res.status} ${await res.text()}`);
        const data = await res.json() as { content: string; blob_id: string };
        return { content: Buffer.from(data.content, 'base64').toString('utf-8'), sha: data.blob_id };
    }

    async listFiles(ref: string): Promise<string[]> {
        const paths: string[] = [];
        let page = 1;
        const perPage = 100;
        while (true) {
            const url = `${this.baseUrl}/api/v4/projects/${this.encodedProjectId}/repository/tree?ref=${encodeURIComponent(ref)}&recursive=true&per_page=${perPage}&page=${page}`;
            const res = await fetch(url, { headers: this.headers() });
            if (!res.ok) throw new Error(`GitLabVerifier.listFiles failed: ${res.status} ${await res.text()}`);
            const data = await res.json() as Array<{ path: string; type: string }>;
            if (data.length === 0) break;
            paths.push(...data.filter(item => item.type === 'blob').map(item => item.path));
            if (data.length < perPage) break;
            page++;
        }
        return paths;
    }

    async fileMissing(path: string, ref: string): Promise<boolean> {
        return (await this.getFile(path, ref)) === null;
    }

    /**
     * Fetches the file's `last_commit_id` (GitLab's optimistic-locking
     * revision) directly, independent of GitLabService.getFile. Used by the
     * #101 regression suite to assert on revision semantics without relying
     * on the production code path under test to report them correctly.
     */
    async getRevision(path: string, ref: string): Promise<string | null> {
        const encodedPath = encodeURIComponent(path);
        const url = `${this.baseUrl}/api/v4/projects/${this.encodedProjectId}/repository/files/${encodedPath}?ref=${encodeURIComponent(ref)}`;
        const res = await fetch(url, { headers: this.headers() });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GitLabVerifier.getRevision failed: ${res.status} ${await res.text()}`);
        const data = await res.json() as { last_commit_id: string };
        return data.last_commit_id;
    }
}
