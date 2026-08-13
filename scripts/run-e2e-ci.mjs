#!/usr/bin/env node
/*
 * CI entry point for one `provider-e2e` matrix cell (see
 * .github/workflows/ci.yml). Thin wrapper around `scripts/run-e2e.mjs`
 * (the same command used locally) adding the two things only CI needs:
 *
 * 1. Sweep stale `gfs-e2e-<provider>-*` branches first (scripts/e2e-sweep-
 *    branches.mjs), so a crashed/cancelled prior run's leftover branch
 *    doesn't linger indefinitely in the sandbox repo/project.
 * 2. Fail loudly, not silently, when credentials are missing.
 *
 * Whether this provider is *supposed* to run at all for the current event
 * (e.g. a fork PR only getting Gitea) is decided by the "Determine whether
 * this provider leg should run" step in ci.yml (job-level `if:` can't see
 * the `matrix` context, so that gate has to be a step, not the job's own
 * `if:`) -- by the time this script runs, that gate has already decided
 * this cell should execute, so missing credentials here always means
 * something is actually broken (an unset repo secret/variable), never "this
 * event legitimately has no credentials". A missing required secret must be
 * an explicit failure, never a silent skip that reports green.
 */
import { spawnSync } from 'node:child_process';

const providerArg = process.argv.find((arg) => arg.startsWith('--provider='));
const provider = providerArg?.split('=')[1];

if (!provider) {
    console.error('Usage: node scripts/run-e2e-ci.mjs --provider=<github|gitlab|gitea>');
    process.exit(1);
}

const REQUIRED_ENV = {
    github: ['E2E_GITHUB_OWNER', 'E2E_GITHUB_REPO', 'E2E_GITHUB_TOKEN'],
    gitlab: ['E2E_GITLAB_PROJECT_ID', 'E2E_GITLAB_TOKEN'],
    gitea: [], // provisioned entirely inside the job via Docker; no repo secrets needed
};

const missing = (REQUIRED_ENV[provider] ?? []).filter((name) => !process.env[name]);
if (missing.length > 0) {
    console.error(`::error::provider-e2e/${provider}: missing required credential(s): ${missing.join(', ')}`);
    process.exit(1);
}

function run(command, args) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
}

run('node', ['scripts/e2e-sweep-branches.mjs', `--provider=${provider}`]);
run('node', ['scripts/run-e2e.mjs', '--provider', provider]);
