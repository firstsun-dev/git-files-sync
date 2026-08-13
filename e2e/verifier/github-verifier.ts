import type { RemoteVerifier } from './verifier-contract';

const API_BASE = 'https://api.github.com';

/**
 * Independent verifier for GitHub: talks to GitHub's REST API directly via
 * fetch, with no dependency on src/services/github-service.ts (which uses
 * GraphQL's createCommitOnBranch for writes). Suites use this to confirm
 * GitHubService's writes actually landed, instead of asking GitHubService to
 * read back its own writes.
 */
export class GitHubVerifier implements RemoteVerifier {
    constructor(
        private readonly owner: string,
        private readonly repo: string,
        private readonly token: string
    ) {}

    private headers(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };
    }

    async getFile(path: string, ref: string): Promise<{ content: string; sha: string } | null> {
        const entry = await this.getRawEntry(path, ref);
        if (entry === null) return null;
        if (entry.type === 'symlink') return { content: '', sha: entry.sha };
        return { content: Buffer.from(entry.content ?? '', 'base64').toString('utf-8'), sha: entry.sha };
    }

    async listFiles(ref: string): Promise<string[]> {
        const tree = await this.fetchTree(ref);
        return tree.filter(item => item.type === 'blob').map(item => item.path);
    }

    async fileMissing(path: string, ref: string): Promise<boolean> {
        return (await this.getFile(path, ref)) === null;
    }

    /** GitHub-specific: raw contents-API entry (exposes `type`/`target` for symlinks, which getFile's RemoteVerifier shape does not). */
    async getRawEntry(path: string, ref: string): Promise<{ content?: string; sha: string; type?: string; target?: string } | null> {
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        const url = `${API_BASE}/repos/${this.owner}/${this.repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
        const res = await fetch(url, { headers: this.headers() });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GitHubVerifier.getRawEntry failed: ${res.status} ${await res.text()}`);
        return await res.json() as { content?: string; sha: string; type?: string; target?: string };
    }

    /** GitHub-specific: git tree entry mode at `path` (e.g. "120000" for a symlink), for symlink regression coverage. */
    async getBlobMode(path: string, ref: string): Promise<string | null> {
        const tree = await this.fetchTree(ref);
        return tree.find(item => item.path === path)?.mode ?? null;
    }

    async listCommitShas(ref: string, perPage = 30): Promise<string[]> {
        const url = `${API_BASE}/repos/${this.owner}/${this.repo}/commits?sha=${encodeURIComponent(ref)}&per_page=${perPage}`;
        const res = await fetch(url, { headers: this.headers() });
        if (!res.ok) throw new Error(`GitHubVerifier.listCommitShas failed: ${res.status} ${await res.text()}`);
        const data = await res.json() as Array<{ sha: string }>;
        return data.map(item => item.sha);
    }

    /** GitHub-specific: the commit message at a given sha, for asserting createCommitOnBranch carried the right message through. */
    async getCommitMessage(sha: string): Promise<string> {
        const url = `${API_BASE}/repos/${this.owner}/${this.repo}/commits/${sha}`;
        const res = await fetch(url, { headers: this.headers() });
        if (!res.ok) throw new Error(`GitHubVerifier.getCommitMessage failed: ${res.status} ${await res.text()}`);
        const data = await res.json() as { commit: { message: string } };
        return data.commit.message;
    }

    private async fetchTree(ref: string): Promise<Array<{ path: string; type: string; mode: string }>> {
        const branchUrl = `${API_BASE}/repos/${this.owner}/${this.repo}/branches/${encodeURIComponent(ref)}`;
        const branchRes = await fetch(branchUrl, { headers: this.headers() });
        if (!branchRes.ok) throw new Error(`GitHubVerifier.fetchTree failed to resolve branch: ${branchRes.status} ${await branchRes.text()}`);
        const branchData = await branchRes.json() as { commit: { sha: string } };

        const treeUrl = `${API_BASE}/repos/${this.owner}/${this.repo}/git/trees/${branchData.commit.sha}?recursive=1`;
        const treeRes = await fetch(treeUrl, { headers: this.headers() });
        if (!treeRes.ok) throw new Error(`GitHubVerifier.fetchTree failed to fetch tree: ${treeRes.status} ${await treeRes.text()}`);
        const treeData = await treeRes.json() as { tree: Array<{ path: string; type: string; mode: string }> };
        return treeData.tree;
    }
}
