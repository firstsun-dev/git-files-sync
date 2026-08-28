// CI contract tests run in Node and intentionally inspect the committed workflow file.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const harness = readFileSync('scripts/e2e-harness.sh', 'utf8');
const runner = readFileSync('scripts/run-e2e.sh', 'utf8');

describe('CI workflow contracts', () => {
    it('retries transient provider failures three times', () => {
        expect(workflow).toContain('max_attempts: 3');
    });

    it('runs secretless Gitea E2E on an ephemeral GitHub-hosted runner', () => {
        expect(workflow).toMatch(/gitea-e2e:[\s\S]*?runs-on: ubuntu-latest/);
        expect(workflow).toMatch(/gitea-e2e:[\s\S]*?permissions:\n\s+contents: read/);
        expect(workflow).toContain('scripts/run-e2e.sh --provider gitea');
        expect(workflow).not.toContain('Gitea E2E is disabled in CI');
    });

    it('keeps credentialed providers on self-hosted runners away from fork PRs', () => {
        expect(workflow).toContain('provider: [github, gitlab]');
        expect(workflow).toContain("github.event_name != 'pull_request'");
        expect(workflow).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    });

    it('allocates isolated concurrency identities to manual and scheduled E2E', () => {
        const independentRunIdentity = "format('{0}-{1}', github.event_name, github.run_id)";
        expect(workflow.split(independentRunIdentity)).toHaveLength(3);
    });

    it('runs lint, unit-test, build, and provider-e2e in parallel (no validation waits on E2E)', () => {
        // The old preflight -> provider-e2e -> e2e-gate -> reusable-CI serial
        // chain is gone; every validation job starts right after the push.
        expect(workflow).not.toContain('preflight:');
        expect(workflow).not.toContain('e2e-gate:');
        expect(workflow).not.toContain('needs: [changes, preflight]');
        expect(workflow).not.toContain('needs: e2e-gate');
    });

    it('gates release behind a single required-checks aggregate that runs even on failure', () => {
        expect(workflow).toContain('name: CI / Required Checks');
        expect(workflow).toContain('needs: [lint, unit-test, build, gitea-e2e, provider-e2e]');
        expect(workflow).toContain('if: always()');
        // Release only starts after the gate; a cancelled matrix leg is a hard
        // failure here (the surviving run owns the latest-commit gate), not a
        // silent pass-through that lets downstream CI/release continue.
        expect(workflow).toContain('needs: [required-checks]');
        expect(workflow).not.toContain('run-ci=false');
        expect(workflow).not.toContain('needs.e2e-gate.outputs.run-ci');
    });
});

describe('local Gitea harness contracts', () => {
    it('publishes Gitea on a Docker-assigned localhost port', () => {
        expect(harness).toContain('-p 127.0.0.1::3000');
        expect(harness).toContain('docker port "$name" 3000/tcp');
        expect(harness).toContain('local base_url="http://127.0.0.1:${host_port}"');
        expect(harness).not.toContain("docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'");
    });

    it('allocates an isolated default workdir for concurrent local runs', () => {
        expect(runner).toContain('mktemp -d "${TMPDIR:-/tmp}/gfs-e2e-${provider}.XXXXXX"');
        expect(runner).toContain('created_workdir=1');
    });
});
