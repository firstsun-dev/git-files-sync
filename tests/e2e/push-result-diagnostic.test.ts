import { describe, expect, it } from 'vitest';
import { describePushResult } from '../../e2e-tests/provider/support/push-result-diagnostic';

describe('describePushResult', () => {
    it('includes provider errors in a failed push assertion', () => {
        expect(describePushResult({
            success: 0,
            failed: 1,
            errors: [{ file: 'new.md', error: 'GitHub returned 503' }],
        })).toContain('GitHub returned 503');
    });
});
