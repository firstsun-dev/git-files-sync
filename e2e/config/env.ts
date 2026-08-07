/**
 * E2E-only environment/config loading. Deliberately separate from the
 * plugin's own settings — this reads process.env and CLI args, never vault
 * data, and only ever runs under `vitest.e2e.config.ts` (see
 * scripts/run-e2e.mjs for how E2E_PROVIDER gets set).
 */

export const SUPPORTED_PROVIDERS = ['gitea'] as const;
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
