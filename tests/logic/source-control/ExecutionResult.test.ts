import { describe, expect, it } from 'vitest';
import { emptyExecutionResult } from '../../../src/logic/source-control/ExecutionResult';
import { toChangeId } from '../../../src/logic/source-control/types';

describe('ExecutionResult', () => {
    it('is an empty projection with no completed, conflicts, or failed', () => {
        expect(emptyExecutionResult()).toEqual({
            completed: [],
            conflicts: [],
            failed: [],
        });
    });

    it('returns independent arrays so callers can mutate without aliasing the prototype', () => {
        const a = emptyExecutionResult();
        const b = emptyExecutionResult();
        a.completed.push(toChangeId('c-1'));

        expect(b.completed).toEqual([]);
        expect(a.completed).toEqual([toChangeId('c-1')]);
    });
});