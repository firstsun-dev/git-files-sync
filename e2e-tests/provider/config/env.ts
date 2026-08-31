/**
 * E2E-only environment/config loading. Deliberately separate from the
 * plugin's own settings — this reads process.env, never vault data.
 *
 * Branch/container/credential provisioning itself happens in
 * `scripts/e2e-harness.sh provision` (Shell + Git), before vitest ever
 * starts — these factories only construct the real production
 * GitServiceInterface implementation against whatever that step already
 * resolved, via the env vars it exports (see docs/testing/real-provider-e2e.md).
 */
import { GitHubService } from '../../../src/services/github-service';
import { GitLabService } from '../../../src/services/gitlab-service';
import { GiteaService } from '../../../src/services/gitea-service';
import type { GitServiceInterface } from '../../../src/services/git-service-interface';

export const SUPPORTED_PROVIDERS = ['gitea', 'gitlab', 'github'] as const;
export type E2EProvider = typeof SUPPORTED_PROVIDERS[number];

export function isSupportedProvider(value: string): value is E2EProvider {
    return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

/** Which provider's suite to run, set by `npm run test:e2e -- --provider <name>`. */
export function currentProvider(): E2EProvider {
    const value = process.env.E2E_PROVIDER;
    if (!value) {
        throw new Error(
            `E2E_PROVIDER is not set. Run via "npm run test:e2e -- --provider <${SUPPORTED_PROVIDERS.join('|')}>", ` +
            'not vitest directly.'
        );
    }
    if (!isSupportedProvider(value)) {
        throw new Error(`Unsupported E2E provider "${value}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
    }
    return value;
}

/** Milliseconds config, overridable via env for slower CI runners. */
export const timeouts = {
    containerReadyMs: Number(process.env.E2E_CONTAINER_READY_MS ?? 60_000),
    pollIntervalMs: Number(process.env.E2E_POLL_INTERVAL_MS ?? 500),
    testMs: Number(process.env.E2E_TEST_TIMEOUT_MS ?? 120_000),
};

export function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not set. Run "scripts/e2e-harness.sh provision" first — see docs/testing/real-provider-e2e.md.`);
    }
    return value;
}

/** Branch `scripts/e2e-harness.sh provision` created/resolved for this run. */
function testBranch(): string {
    return requiredEnv('E2E_TEST_BRANCH');
}

export interface ProviderContext {
    service: GitServiceInterface;
    branch: string;
}

export function githubContext(): ProviderContext {
    const owner = requiredEnv('E2E_GITHUB_OWNER');
    const repo = requiredEnv('E2E_GITHUB_REPO');
    const token = requiredEnv('E2E_GITHUB_TOKEN');
    const service = new GitHubService();
    service.updateConfig(token, owner, repo, '');
    return { service, branch: testBranch() };
}

export function gitlabContext(): ProviderContext {
    const baseUrl = process.env.E2E_GITLAB_BASE_URL ?? 'https://gitlab.com';
    const projectId = requiredEnv('E2E_GITLAB_PROJECT_ID');
    const token = requiredEnv('E2E_GITLAB_TOKEN');
    const service = new GitLabService();
    service.updateConfig(baseUrl, token, projectId, '');
    return { service, branch: testBranch() };
}

/**
 * Gitea has no dedicated sandbox repo the way GitHub/GitLab do — the harness
 * provisions a whole disposable container + repo per run and hands back its
 * URL/credentials generically (E2E_TEST_REPO_URL/E2E_GIT_USERNAME/
 * E2E_GIT_TOKEN), since there's no stable owner/repo pair to name ahead of time.
 */
export function giteaContext(): ProviderContext {
    const repoUrl = new URL(requiredEnv('E2E_TEST_REPO_URL'));
    const token = requiredEnv('E2E_GIT_TOKEN');
    const [owner, repoWithGit] = repoUrl.pathname.replace(/^\//, '').split('/');
    const repo = (repoWithGit ?? '').replace(/\.git$/, '');
    if (!owner || !repo) {
        throw new Error(`Could not parse owner/repo from E2E_TEST_REPO_URL "${repoUrl}"`);
    }
    const baseUrl = `${repoUrl.protocol}//${repoUrl.host}`;
    const service = new GiteaService();
    service.updateConfig(baseUrl, token, owner, repo, '');
    return { service, branch: testBranch() };
}

export function contextFor(provider: E2EProvider): ProviderContext {
    if (provider === 'github') return githubContext();
    if (provider === 'gitlab') return gitlabContext();
    return giteaContext();
}
