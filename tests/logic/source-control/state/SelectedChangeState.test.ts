import { describe, expect, it } from 'vitest';
import { SelectedChangeState } from '../../../../src/logic/source-control/state/SelectedChangeState';
import { toChangeId } from '../../../../src/logic/source-control/types';

describe('SelectedChangeState', () => {
    it('defaults to null', () => {
        expect(new SelectedChangeState().get()).toBeNull();
    });

    it('holds the selected change id and clears back to null', () => {
        const state = new SelectedChangeState();
        state.set(toChangeId('c-1'));
        expect(state.get()).toBe(toChangeId('c-1'));

        state.clear();
        expect(state.get()).toBeNull();
    });
});