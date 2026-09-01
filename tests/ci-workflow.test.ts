// CI contract tests run in Node and intentionally inspect the committed workflow file.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const harness = readFileSync('scripts/e2e-harness.sh', 'utf8');
const runner = readFileSync('scripts/run-e2e.sh', 'utf8');
const vitestE2eConfig = readFileSync('vitest.e2e.config.ts', 'utf8');
const eslintConfig = readFileSync('eslint.config.mts', 'utf8');
const syncManagerE2eSuite = readFileSync('e2e-tests/provider/suites/sync-manager.e2e.test.ts', 'utf8');

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

    it('allocates an isolated concurrency identity to manual and scheduled runs', () => {
        const independentRunIdentity = "format('{0}-{1}', github.event_name, github.run_id)";
        expect(workflow.split(independentRunIdentity)).toHaveLength(2);
    });

    it('serializes whole branch CI runs at workflow level (no split provider winners)', () => {
        // A push + pull_request race for the same commit must let ONE whole
        // run survive; concurrency is keyed by source branch at workflow
        // level, and per-provider job groups are gone.
        expect(workflow).toMatch(/^concurrency:\n/m);
        expect(workflow).toContain('&& (github.head_ref || github.ref_name)');
        expect(workflow).toContain('cancel-in-progress: true');
        // No job-level concurrency remains: the workflow-level block is the
        // single top-level one, keyed by `ci-`.
        // The top-level workflow block is the only concurrency block, keyed
        // by `ci-` (folded scalar: "group: >-" followed by the ci- prefix).
        expect(workflow.match(/group: >-\n\s+ci-\$\{\{/)).toBeTruthy();
        expect(workflow).not.toContain('group: e2e-');
    });

    it('does not let workflow_dispatch or schedule cancel branch CI', () => {
        // Manual/scheduled runs get unique groups (event_name + run_id), so
        // they can neither cancel nor be cancelled by branch CI runs.
        const concurrencyBlock = workflow.slice(workflow.indexOf('concurrency:'), workflow.indexOf('jobs:'));
        expect(concurrencyBlock).toContain("github.event_name == 'push' || github.event_name == 'pull_request'");
        expect(concurrencyBlock).toContain("format('{0}-{1}', github.event_name, github.run_id)");
        expect(concurrencyBlock).not.toContain('workflow_dispatch');
        expect(concurrencyBlock).not.toContain('schedule');
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

describe('E2E scanner-boundary contracts (e2e-tests/provider, no runtime generation)', () => {
    it('triggers E2E on the e2e-tests/** boundary, not the old e2e/** path', () => {
        expect(workflow).toContain("- 'e2e-tests/**'");
        expect(workflow).not.toContain("- 'e2e/**'");
    });

    it('triggers E2E when the suite manifest or the E2E vitest config changes', () => {
        expect(workflow).toContain("- 'scripts/e2e-suites.txt'");
        expect(workflow).toContain("- 'vitest.e2e.config.ts'");
    });

    it('triggers E2E on the real sync/ and source-control/ logic directories, not just the sync-manager.ts compat shim', () => {
        expect(workflow).toContain("- 'src/logic/sync/**'");
        expect(workflow).toContain("- 'src/logic/source-control/**'");
    });

    it('runs suites from e2e-tests/provider/suites, not the old e2e/suites path', () => {
        expect(runner).toContain('e2e-tests/provider/suites');
        expect(runner).not.toContain('e2e/suites');
    });

    it('does not generate scanner-workaround runtime adapters at provision time', () => {
        expect(harness).not.toContain('generate_runtime');
        expect(harness).not.toContain('E2E_RUNTIME_DIR');
        expect(harness).not.toMatch(/runtime_dir/);
    });

    it('points vitest.e2e.config.ts at committed static runtime files, not an E2E_RUNTIME_DIR alias', () => {
        expect(vitestE2eConfig).not.toContain('E2E_RUNTIME_DIR');
        expect(vitestE2eConfig).not.toContain('@e2e-runtime');
        expect(vitestE2eConfig).toContain('./e2e-tests/provider/runtime/obsidian-request-url.ts');
        expect(vitestE2eConfig).toContain('./e2e-tests/provider/runtime/window-timers.ts');
        expect(vitestE2eConfig).toContain("include: ['e2e-tests/provider/suites/**/*.e2e.test.ts']");
    });

    it('scopes e2e-tests/** Node-tooling lint exemptions to that directory, not the whole repo', () => {
        expect(eslintConfig).toContain('"e2e-tests/**/*.ts"');
        expect(eslintConfig).not.toContain('"e2e/**/*.ts"');
    });

    it('still blocks src/ imports of the removed legacy sync-status presentation layer', () => {
        // Architecture regression guard for the SyncStatusView -> Source
        // Control migration (see docs/source-control.md): a future refactor
        // must not silently drop this no-restricted-imports rule and let
        // ui/sync-status or SyncStatusView get re-wired back in.
        expect(eslintConfig).toContain('"**/ui/sync-status"');
        expect(eslintConfig).toContain('"**/ui/sync-status/*"');
        expect(eslintConfig).toContain('"**/SyncStatusView"');
        expect(eslintConfig).toContain('"**/ui/SyncStatusView"');
        expect(eslintConfig).toContain('no-restricted-imports');
    });

    it('exercises remote delete through the Source Control application path, not a direct provider bypass', () => {
        // The remote-delete E2E used to call `service.deleteFile()` directly,
        // reproducing what the removed SyncStatusView UI used to do. The
        // current production path is SourceControlActionService.deleteRemote()
        // -> SyncWorkspace.deleteRemote() -> RemoteDeleteExecutor ->
        // gitService.deleteFile() -- a future edit must keep exercising that
        // chain instead of quietly reverting to the raw provider call.
        expect(syncManagerE2eSuite).not.toMatch(/\bservice\.deleteFile\(/);
        expect(syncManagerE2eSuite).toContain('actionService.deleteRemote(');
        expect(syncManagerE2eSuite).toContain("from '../../../src/logic/source-control/SourceControlActionService'");
        expect(syncManagerE2eSuite).toContain("from '../../../src/logic/sync/SyncWorkspace'");
    });
});
