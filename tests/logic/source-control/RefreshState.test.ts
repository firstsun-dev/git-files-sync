import { describe, expect, it } from 'vitest';
import { RefreshState } from '../../../src/logic/source-control/RefreshState';

describe('RefreshState', () => {
    it('starts idle', () => {
        expect(new RefreshState().get()).toBe('idle');
    });

    it('transitions to loading on start', () => {
        const state = new RefreshState();
        state.start();
        expect(state.get()).toBe('loading');
    });

    it('transitions back to idle on succeed', () => {
        const state = new RefreshState();
        state.start();
        state.succeed();
        expect(state.get()).toBe('idle');
    });

    it('transitions to failed on fail', () => {
        const state = new RefreshState();
        state.start();
        state.fail();
        expect(state.get()).toBe('failed');
    });

    it('clears a failure back to idle', () => {
        const state = new RefreshState();
        state.start();
        state.fail();
        state.clear();
        expect(state.get()).toBe('idle');
    });

    it('succeed clears a failed state back to idle', () => {
        const state = new RefreshState();
        state.start();
        state.fail();
        state.succeed();
        expect(state.get()).toBe('idle');
    });
});