// CI contract tests run in Node and intentionally inspect the committed workflow file.
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

describe('CI workflow contracts', () => {
    it('retries transient provider failures three times', () => {
        expect(workflow).toContain('max_attempts: 3');
    });

    it('does not fail or continue downstream CI when a provider run is replaced', () => {
        expect(workflow).toContain('if [ "$result" = "cancelled" ]; then');
        expect(workflow).toContain('echo "run-ci=false" >> "$GITHUB_OUTPUT"');
        expect(workflow).toContain("if: needs.e2e-gate.outputs.run-ci == 'true'");
    });
});
