import { describe, expect, it } from 'vitest';
import { OperationState } from '../../../src/logic/source-control/OperationState';
import { toChangeId } from '../../../src/logic/source-control/types';

describe('OperationState', () => {
    it('defaults to idle for an untracked change', () => {
        const state = new OperationState();

        expect(state.get(toChangeId('change-a'))).toBe('idle');
    });

    it('moves through running, success, and failed', () => {
        const state = new OperationState();

        state.start(toChangeId('change-a'));
        expect(state.get(toChangeId('change-a'))).toBe('running');

        state.succeed(toChangeId('change-a'));
        expect(state.get(toChangeId('change-a'))).toBe('success');

        state.start(toChangeId('change-a'));
        state.fail(toChangeId('change-a'));
        expect(state.get(toChangeId('change-a'))).toBe('failed');
    });

    it('marks a change as conflict, distinct from failed (needs-resolution, not an error)', () => {
        const state = new OperationState();

        state.start(toChangeId('change-a'));
        state.conflict(toChangeId('change-a'));

        expect(state.get(toChangeId('change-a'))).toBe('conflict');
    });

    it('treats conflict and failed as independent lifecycles', () => {
        const state = new OperationState();

        state.start(toChangeId('conflicted'));
        state.conflict(toChangeId('conflicted'));

        state.start(toChangeId('errored'));
        state.fail(toChangeId('errored'));

        expect(state.get(toChangeId('conflicted'))).toBe('conflict');
        expect(state.get(toChangeId('errored'))).toBe('failed');
    });

    it('tracks multiple changes independently', () => {
        const state = new OperationState();

        state.start(toChangeId('change-a'));
        state.succeed(toChangeId('change-b'));

        expect(state.get(toChangeId('change-a'))).toBe('running');
        expect(state.get(toChangeId('change-b'))).toBe('success');
        expect(state.get(toChangeId('change-c'))).toBe('idle');
    });

    it('resets a single change back to idle', () => {
        const state = new OperationState();
        state.start(toChangeId('change-a'));

        state.reset(toChangeId('change-a'));

        expect(state.get(toChangeId('change-a'))).toBe('idle');
    });

    it('clears all tracked state', () => {
        const state = new OperationState();
        state.start(toChangeId('change-a'));
        state.succeed(toChangeId('change-b'));

        state.clear();

        expect(state.get(toChangeId('change-a'))).toBe('idle');
        expect(state.get(toChangeId('change-b'))).toBe('idle');
    });

    it('does not cross-contaminate two changes that share a path', () => {
        const state = new OperationState();

        // change-1 and change-2 both happen to touch a.md (e.g. delete + re-add)
        state.start(toChangeId('change-1'));
        state.succeed(toChangeId('change-1'));
        state.start(toChangeId('change-2'));

        expect(state.get(toChangeId('change-1'))).toBe('success');
        expect(state.get(toChangeId('change-2'))).toBe('running');
    });
});
