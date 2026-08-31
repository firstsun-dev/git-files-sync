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

    describe('reason', () => {
        it('defaults to manual when start is called with no argument', () => {
            const state = new RefreshState();
            state.start();
            expect(state.getReason()).toBe('manual');
        });

        it('records the reason passed to start', () => {
            const state = new RefreshState();
            state.start('startup');
            expect(state.getReason()).toBe('startup');
            state.start('local-change');
            expect(state.getReason()).toBe('local-change');
        });

        it('has no reason before the first refresh', () => {
            expect(new RefreshState().getReason()).toBeUndefined();
        });

        it('keeps the reason of the most recent refresh after it settles', () => {
            const state = new RefreshState();
            state.start('sync-complete');
            state.succeed();
            expect(state.getReason()).toBe('sync-complete');
        });
    });

    describe('lastCheckedAt', () => {
        it('is 0 before the first successful refresh', () => {
            expect(new RefreshState().getLastCheckedAt()).toBe(0);
            const state = new RefreshState();
            state.start();
            expect(state.getLastCheckedAt()).toBe(0);
        });

        it('records the completion time on succeed', () => {
            const state = new RefreshState();
            state.start();
            state.succeed();
            const first = state.getLastCheckedAt();
            expect(first).toBeGreaterThan(0);
        });

        it('advances on a subsequent succeed', async () => {
            const state = new RefreshState();
            state.start();
            state.succeed();
            const first = state.getLastCheckedAt();
            await new Promise(resolve => window.setTimeout(resolve, 5));
            state.start();
            state.succeed();
            expect(state.getLastCheckedAt()).toBeGreaterThan(first);
        });

        it('does not advance on fail', () => {
            const state = new RefreshState();
            state.start();
            state.succeed();
            const first = state.getLastCheckedAt();
            state.start();
            state.fail();
            expect(state.getLastCheckedAt()).toBe(first);
        });
    });
});