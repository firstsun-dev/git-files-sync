import { runNamespace } from '../namespace';
import { globalSecrets, logInfo } from '../redact';
import { gitlabSandboxConfig } from '../config/env';

export interface GitLabEnvironment {
    baseUrl: string;
    projectId: string;
    token: string;
    /** Run-specific branch created off the project's default branch; the suite reads/writes here. */
    branch: string;
}

/**
 * "Provisions" GitLab E2E by pointing at a pre-existing dedicated sandbox
 * project (see e2e/config/env.ts) and creating a run-specific branch inside
 * it, rather than spinning up infrastructure like Gitea's Docker provisioner
 * does. Isolation therefore comes from the branch name (derived from
 * runNamespace so concurrent jobs never collide) plus the rootPath prefix
 * each suite already applies to its file paths — never from a throwaway
 * project, since ordinary/ non-sandbox GitLab projects must never be touched.
 */
export async function provisionGitLab(): Promise<GitLabEnvironment> {
    const { baseUrl, projectId, token } = gitlabSandboxConfig();
    globalSecrets.add(token);

    const encodedProjectId = encodeURIComponent(projectId);
    const headers = { 'PRIVATE-TOKEN': token };

    logInfo(`Resolving default branch for GitLab sandbox project ${projectId}`);
    const projectRes = await fetch(`${baseUrl}/api/v4/projects/${encodedProjectId}`, { headers });
    if (!projectRes.ok) {
        throw new Error(
            `Failed to reach GitLab sandbox project ${projectId}: ${projectRes.status} ${await projectRes.text()}. ` +
            'Check E2E_GITLAB_BASE_URL/E2E_GITLAB_PROJECT_ID and that the token has `api` scope on this project.'
        );
    }
    const project = await projectRes.json() as { default_branch: string };

    const branch = runNamespace('gitlab');
    logInfo(`Creating branch ${branch} off ${project.default_branch}`);
    const branchRes = await fetch(
        `${baseUrl}/api/v4/projects/${encodedProjectId}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(project.default_branch)}`,
        { method: 'POST', headers }
    );
    if (!branchRes.ok) {
        throw new Error(`Failed to create GitLab E2E branch ${branch}: ${branchRes.status} ${await branchRes.text()}`);
    }

    return { baseUrl, projectId, token, branch };
}

/** Best-effort cleanup — deletes the run-specific branch. Must not throw. */
export async function teardownGitLab(env: GitLabEnvironment): Promise<void> {
    if (process.env.E2E_KEEP_BRANCH === '1' || process.env.E2E_KEEP_BRANCH === 'true') {
        logInfo(`E2E_KEEP_BRANCH set — leaving branch ${env.branch} in place for debugging`);
        return;
    }
    try {
        logInfo(`Removing branch ${env.branch}`);
        const encodedProjectId = encodeURIComponent(env.projectId);
        await fetch(
            `${env.baseUrl}/api/v4/projects/${encodedProjectId}/repository/branches/${encodeURIComponent(env.branch)}`,
            { method: 'DELETE', headers: { 'PRIVATE-TOKEN': env.token } }
        );
    } catch {
        // best-effort: used for cleanup, the branch may already be gone
    }
}
