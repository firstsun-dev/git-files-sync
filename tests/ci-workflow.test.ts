// CI contract tests run in Node and intentionally inspect the committed workflow file.
// eslint-disable-next-line import/no-nodejs-modules
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

    it('requires both Gitea and credentialed-provider results before downstream CI', () => {
        expect(workflow).toContain('needs: [gitea-e2e, provider-e2e]');
        expect(workflow).toContain('gitea_result="${{ needs.gitea-e2e.result }}"');
        expect(workflow).toContain('provider_result="${{ needs.provider-e2e.result }}"');
    });

    it('deduplicates push and PR runs without cancelling manual or scheduled checks', () => {
        const independentRunIdentity = "format('{0}-{1}', github.event_name, github.run_id)";
        expect(workflow.split(independentRunIdentity)).toHaveLength(3);
    });

    it('does not fail or continue downstream CI when a provider run is replaced', () => {
        expect(workflow).toContain('if [ "$result" = "cancelled" ]; then');
        expect(workflow).toContain('echo "run-ci=false" >> "$GITHUB_OUTPUT"');
        expect(workflow).toContain(
            "if: always() && needs.e2e-gate.result == 'success' && needs.e2e-gate.outputs.run-ci == 'true'",
        );
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
