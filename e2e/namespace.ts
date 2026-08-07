import { randomBytes } from 'node:crypto';

/**
 * Builds a run-specific resource name so E2E provisioning never collides
 * with other jobs on the same host. The GitHub Actions self-hosted runners
 * used by this repo share one Docker daemon across concurrent jobs, so any
 * fixed/singleton container, network, volume, or port name (e.g. "gitea",
 * "e2e-network") would race between jobs. Every Docker resource an E2E
 * provisioner creates must be derived from this namespace instead.
 *
 * In CI, GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT uniquely identify the job run.
 * Locally, neither is set, so fall back to a random suffix.
 */
export function runNamespace(provider: string): string {
    const runId = process.env.GITHUB_RUN_ID;
    const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? '1';
    const suffix = runId ? `${runId}-${runAttempt}` : `local-${randomBytes(4).toString('hex')}`;
    return `gfs-e2e-${provider}-${suffix}`;
}
