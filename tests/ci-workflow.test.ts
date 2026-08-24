// CI contract tests run in Node and intentionally inspect the committed workflow file.
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

describe('CI workflow contracts', () => {
    it('retries transient provider failures three times', () => {
        expect(workflow).toContain('max_attempts: 3');
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
        expect(workflow).toContain('needs: [lint, unit-test, build, provider-e2e]');
        expect(workflow).toContain('if: always()');
        // Release only starts after the gate; a cancelled matrix leg is a hard
        // failure here (the surviving run owns the latest-commit gate), not a
        // silent pass-through that lets downstream CI/release continue.
        expect(workflow).toContain('needs: [required-checks]');
        expect(workflow).not.toContain('run-ci=false');
        expect(workflow).not.toContain('needs.e2e-gate.outputs.run-ci');
    });
});