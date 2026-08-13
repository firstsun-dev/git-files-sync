#!/usr/bin/env node
/*
 * Best-effort cleanup for leftover `gfs-e2e-<provider>-*` branches (see
 * e2e/namespace.ts) left behind by a crashed/cancelled CI run -- a normal
 * run deletes its own branch in teardown (e2e/provision/{github,gitlab}-
 * provision.ts). Gitea needs no sweeper: its whole container, not just a
 * branch, is torn down in afterAll, and a leftover container is cleaned up
 * by the next run reusing the same run-specific container name.
 *
 * Never throws and never fails its own process: sweeping is opportunistic
 * housekeeping run before the required E2E gate (scripts/run-e2e-ci.mjs),
 * not part of it. Missing credentials mean "nothing to sweep here", not an
 * error -- run-e2e-ci.mjs is what turns missing *required* credentials into
 * an explicit failure.
 */

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BRANCH_PREFIX = (provider) => `gfs-e2e-${provider}-`;

function log(message) {
    console.log(`[e2e-sweep] ${message}`);
}

async function sweepGitHub() {
    const owner = process.env.E2E_GITHUB_OWNER;
    const repo = process.env.E2E_GITHUB_REPO;
    const token = process.env.E2E_GITHUB_TOKEN;
    if (!owner || !repo || !token) {
        log('github: no credentials configured, skipping');
        return;
    }
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    const prefix = BRANCH_PREFIX('github');

    const listRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, { headers });
    if (!listRes.ok) {
        log(`github: failed to list branches (${listRes.status}), skipping`);
        return;
    }
    const branches = await listRes.json();

    for (const branch of branches) {
        if (!branch.name?.startsWith(prefix)) continue;
        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch.commit.sha}`, { headers });
        if (!commitRes.ok) continue;
        const commit = await commitRes.json();
        const committedAt = new Date(commit.commit?.committer?.date ?? 0).getTime();
        if (Date.now() - committedAt < MAX_AGE_MS) continue;

        log(`github: deleting stale branch ${branch.name}`);
        await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch.name)}`, {
            method: 'DELETE',
            headers,
        }).catch(() => {});
    }
}

async function sweepGitLab() {
    const baseUrl = process.env.E2E_GITLAB_BASE_URL ?? 'https://gitlab.com';
    const projectId = process.env.E2E_GITLAB_PROJECT_ID;
    const token = process.env.E2E_GITLAB_TOKEN;
    if (!projectId || !token) {
        log('gitlab: no credentials configured, skipping');
        return;
    }
    const headers = { 'PRIVATE-TOKEN': token };
    const encodedProjectId = encodeURIComponent(projectId);
    const prefix = BRANCH_PREFIX('gitlab');

    const listRes = await fetch(`${baseUrl}/api/v4/projects/${encodedProjectId}/repository/branches?per_page=100`, { headers });
    if (!listRes.ok) {
        log(`gitlab: failed to list branches (${listRes.status}), skipping`);
        return;
    }
    const branches = await listRes.json();

    for (const branch of branches) {
        if (!branch.name?.startsWith(prefix)) continue;
        const committedAt = new Date(branch.commit?.committed_date ?? 0).getTime();
        if (Date.now() - committedAt < MAX_AGE_MS) continue;

        log(`gitlab: deleting stale branch ${branch.name}`);
        await fetch(`${baseUrl}/api/v4/projects/${encodedProjectId}/repository/branches/${encodeURIComponent(branch.name)}`, {
            method: 'DELETE',
            headers,
        }).catch(() => {});
    }
}

async function main() {
    const providerArg = process.argv.find((arg) => arg.startsWith('--provider='));
    const provider = providerArg?.split('=')[1];

    const sweeps = { github: sweepGitHub, gitlab: sweepGitLab };
    const toRun = provider ? [provider] : Object.keys(sweeps);

    for (const name of toRun) {
        const sweep = sweeps[name];
        if (!sweep) continue; // gitea: no branch sweeper needed, see header comment
        try {
            await sweep();
        } catch (e) {
            log(`${name}: sweep failed, ignoring (best-effort): ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}

await main();
