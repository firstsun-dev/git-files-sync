import { describe, expect, it } from 'vitest';
import { OperationState } from '../../../src/logic/source-control/OperationState';

describe('OperationState', () => {
    it('defaults to idle for an untracked path', () => {
        const state = new OperationState();

        expect(state.get('a.md')).toBe('idle');
    });

    it('moves through running, success, and failed', () => {
        const state = new OperationState();

        state.start('a.md');
        expect(state.get('a.md')).toBe('running');

        state.succeed('a.md');
        expect(state.get('a.md')).toBe('success');

        state.start('a.md');
        state.fail('a.md');
        expect(state.get('a.md')).toBe('failed');
    });

    it('tracks multiple paths independently', () => {
        const state = new OperationState();

        state.start('a.md');
        state.succeed('b.md');

        expect(state.get('a.md')).toBe('running');
        expect(state.get('b.md')).toBe('success');
        expect(state.get('c.md')).toBe('idle');
    });

    it('resets a single path back to idle', () => {
        const state = new OperationState();
        state.start('a.md');

        state.reset('a.md');

        expect(state.get('a.md')).toBe('idle');
    });

    it('clears all tracked state', () => {
        const state = new OperationState();
        state.start('a.md');
        state.succeed('b.md');

        state.clear();

        expect(state.get('a.md')).toBe('idle');
        expect(state.get('b.md')).toBe('idle');
    });
});
