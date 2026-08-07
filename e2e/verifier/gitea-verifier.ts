import type { RemoteVerifier } from './verifier-contract';

/**
 * Independent verifier for Gitea: talks to Gitea's raw REST API directly via
 * fetch, with no dependency on src/services/gitea-service.ts. Suites use
 * this to confirm GiteaService's writes actually landed, instead of asking
 * GiteaService to read back its own writes (which would only prove
 * self-consistency, not correctness).
 */
export class GiteaVerifier implements RemoteVerifier {
    constructor(
        private readonly baseUrl: string,
        private readonly owner: string,
        private readonly repo: string,
        private readonly token: string
    ) {}

    private headers(): Record<string, string> {
        return { 'Authorization': `token ${this.token}` };
    }

    async getFile(path: string, ref: string): Promise<{ content: string; sha: string } | null> {
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        const url = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
        const res = await fetch(url, { headers: this.headers() });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GiteaVerifier.getFile failed: ${res.status} ${await res.text()}`);
        const data = await res.json() as { content: string; sha: string };
        return { content: Buffer.from(data.content, 'base64').toString('utf-8'), sha: data.sha };
    }

    async listFiles(ref: string): Promise<string[]> {
        const branchUrl = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/branches/${encodeURIComponent(ref)}`;
        const branchRes = await fetch(branchUrl, { headers: this.headers() });
        if (!branchRes.ok) throw new Error(`GiteaVerifier.listFiles failed to resolve branch: ${branchRes.status} ${await branchRes.text()}`);
        const branchData = await branchRes.json() as { commit: { id: string } };

        const treeUrl = `${this.baseUrl}/api/v1/repos/${this.owner}/${this.repo}/git/trees/${branchData.commit.id}?recursive=1`;
        const treeRes = await fetch(treeUrl, { headers: this.headers() });
        if (!treeRes.ok) throw new Error(`GiteaVerifier.listFiles failed to fetch tree: ${treeRes.status} ${await treeRes.text()}`);
        const treeData = await treeRes.json() as { tree: Array<{ path: string; type: string }> };
        return treeData.tree.filter(item => item.type === 'blob').map(item => item.path);
    }

    async fileMissing(path: string, ref: string): Promise<boolean> {
        return (await this.getFile(path, ref)) === null;
    }
}
