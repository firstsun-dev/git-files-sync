/**
 * E2E-only environment/config loading. Deliberately separate from the
 * plugin's own settings — this reads process.env and CLI args, never vault
 * data, and only ever runs under `vitest.e2e.config.ts` (see
 * scripts/run-e2e.mjs for how E2E_PROVIDER gets set).
 */

export const SUPPORTED_PROVIDERS = ['gitea', 'gitlab'] as const;
export type E2EProvider = typeof SUPPORTED_PROVIDERS[number];

export function isSupportedProvider(value: string): value is E2EProvider {
    return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

/** Which provider's suite to run, set by scripts/run-e2e.mjs from `--provider <name>`. */
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
    /** How long to wait for a freshly-started container to answer health checks. */
    containerReadyMs: Number(process.env.E2E_CONTAINER_READY_MS ?? 60_000),
    /** Poll interval while waiting for a container to become ready. */
    pollIntervalMs: Number(process.env.E2E_POLL_INTERVAL_MS ?? 500),
    /** Per-test timeout for suites that provision infrastructure. */
    testMs: Number(process.env.E2E_TEST_TIMEOUT_MS ?? 120_000),
};

export const giteaImage = process.env.E2E_GITEA_IMAGE ?? 'gitea/gitea:1.22';

/**
 * GitLab has no lightweight self-hostable image the way Gitea does (the
 * official `gitlab-ce` image takes minutes to become healthy and is far too
 * heavy to spin up per test run), so unlike Gitea's provisioner, GitLab E2E
 * targets a pre-existing sandbox project rather than a freshly provisioned
 * container. See e2e/provision/gitlab-provision.ts for what it does instead
 * (a run-specific branch inside that project).
 */
export interface GitLabSandboxConfig {
    baseUrl: string;
    projectId: string;
    token: string;
}

/**
 * Reads the dedicated GitLab E2E sandbox project's credentials from env.
 * Requires a token with `api` scope (a Project Access Token on the sandbox
 * project, or a dedicated E2E user's Personal Access Token if Project Access
 * Tokens aren't available on the target GitLab plan) — `write_repository`
 * alone is not sufficient because the verifier and branch provisioning use
 * read/write REST endpoints outside the write_repository scope's coverage.
 */
export function gitlabSandboxConfig(): GitLabSandboxConfig {
    const baseUrl = process.env.E2E_GITLAB_BASE_URL ?? 'https://gitlab.com';
    const projectId = process.env.E2E_GITLAB_PROJECT_ID;
    const token = process.env.E2E_GITLAB_TOKEN;

    const missing: string[] = [];
    if (!projectId) missing.push('E2E_GITLAB_PROJECT_ID');
    if (!token) missing.push('E2E_GITLAB_TOKEN');
    if (missing.length > 0) {
        throw new Error(
            `Missing required env var(s) for GitLab E2E: ${missing.join(', ')}. ` +
            'Point these at a dedicated GitLab sandbox project (not an ordinary project) and a token ' +
            'with `api` scope — a Project Access Token on the sandbox project, or a dedicated E2E ' +
            'user\'s Personal Access Token if Project Access Tokens are unavailable on the plan. ' +
            '`write_repository` scope alone is not sufficient. Optionally set E2E_GITLAB_BASE_URL ' +
            '(defaults to https://gitlab.com).'
        );
    }

    return { baseUrl, projectId: projectId as string, token: token as string };
}
