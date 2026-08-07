import { globalSecrets, logInfo } from '../redact';
import { runNamespace } from '../namespace';

/**
 * "Provisioning" for a hosted provider like GitHub isn't standing up a
 * container (see gitea-provision.ts) — it's validating pre-supplied
 * credentials against a dedicated, already-existing E2E sandbox repository,
 * then creating a run-specific branch so this run's writes never collide
 * with another run's or a real user's history. The branch is deleted in
 * teardown; the sandbox repo itself is never created or destroyed here.
 */
export interface GitHubEnvironment {
    owner: string;
    repo: string;
    token: string;
    /** Run-specific branch created off baseBranch; all suite writes target this. */
    branch: string;
    /** Pre-existing branch the sandbox repo already has, branched from. */
    baseBranch: string;
}

const API_BASE = 'https://api.github.com';

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} is not set. GitHub E2E requires E2E_GITHUB_OWNER, E2E_GITHUB_REPO, and ` +
            'E2E_GITHUB_TOKEN (a fine-grained PAT scoped only to the dedicated E2E sandbox repo). ' +
            'See e2e/provision/github-provision.ts.'
        );
    }
    return value;
}

function headers(token: string): Record<string, string> {
    return {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

export async function provisionGitHub(): Promise<GitHubEnvironment> {
    const owner = requiredEnv('E2E_GITHUB_OWNER');
    const repo = requiredEnv('E2E_GITHUB_REPO');
    const token = requiredEnv('E2E_GITHUB_TOKEN');
    globalSecrets.add(token);
    const baseBranch = process.env.E2E_GITHUB_BASE_BRANCH ?? 'main';
    const branch = runNamespace('github');

    logInfo(`Verifying access to ${owner}/${repo}`);
    const repoRes = await fetch(`${API_BASE}/repos/${owner}/${repo}`, { headers: headers(token) });
    if (!repoRes.ok) {
        throw new Error(
            `GitHub E2E sandbox repo ${owner}/${repo} is not reachable with the supplied token: ` +
            `${repoRes.status} ${await repoRes.text()}`
        );
    }

    logInfo(`Reading base branch ${baseBranch}`);
    const baseRefRes = await fetch(`${API_BASE}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`, {
        headers: headers(token),
    });
    if (!baseRefRes.ok) {
        throw new Error(`Failed to read base branch "${baseBranch}": ${baseRefRes.status} ${await baseRefRes.text()}`);
    }
    const baseRef = await baseRefRes.json() as { object: { sha: string } };

    logInfo(`Creating run branch ${branch} off ${baseBranch}`);
    const createRefRes = await fetch(`${API_BASE}/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers: { ...headers(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
    });
    if (!createRefRes.ok) {
        throw new Error(`Failed to create run branch "${branch}": ${createRefRes.status} ${await createRefRes.text()}`);
    }

    return { owner, repo, token, branch, baseBranch };
}

/** Best-effort cleanup — safe to call even if provisioning only partially completed. */
export async function teardownGitHub(env: GitHubEnvironment): Promise<void> {
    logInfo(`Removing run branch ${env.branch}`);
    try {
        await fetch(`${API_BASE}/repos/${env.owner}/${env.repo}/git/refs/heads/${encodeURIComponent(env.branch)}`, {
            method: 'DELETE',
            headers: headers(env.token),
        });
    } catch {
        // best-effort: branch may already be gone, or provisioning never got this far
    }
}
