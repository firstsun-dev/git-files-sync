import { describe, expect, it } from 'vitest';
import { FilterState } from '../../../../src/logic/source-control/state/FilterState';

describe('FilterState', () => {
    it('defaults to "all"', () => {
        expect(new FilterState().get()).toBe('all');
    });

    it('holds the last set filter', () => {
        const state = new FilterState();
        state.set('conflicts');
        expect(state.get()).toBe('conflicts');
        state.set('ready-to-push');
        expect(state.get()).toBe('ready-to-push');
    });
});