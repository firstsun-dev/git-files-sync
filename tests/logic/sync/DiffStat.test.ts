import { describe, expect, it } from 'vitest';
import { addedContentStat, cheapLocalStat, computeDiffStat, deletedContentStat } from '../../../src/logic/sync/DiffStat';

describe('computeDiffStat', () => {
    it('counts additions and deletions from a two-sided diff', () => {
        const remote = 'line1\nline2\nline3';
        const local = 'line1\nchanged\nline3\nline4';
        const stat = computeDiffStat(remote, local);
        expect(stat.additions).toBe(2);
        expect(stat.deletions).toBe(1);
    });

    it('reports zero for identical content', () => {
        const stat = computeDiffStat('a\nb', 'a\nb');
        expect(stat).toEqual({ additions: 0, deletions: 0 });
    });

    it('treats a pure addition as additions only', () => {
        const stat = computeDiffStat('a', 'a\nb');
        expect(stat).toEqual({ additions: 1, deletions: 0 });
    });

    it('treats a pure deletion as deletions only', () => {
        const stat = computeDiffStat('a\nb', 'a');
        expect(stat).toEqual({ additions: 0, deletions: 1 });
    });
});

describe('cheapLocalStat', () => {
    it('counts local lines as additions with no deletions', () => {
        expect(cheapLocalStat('a\nb\nc')).toEqual({ additions: 3, deletions: 0 });
    });

    it('reports zero for empty content', () => {
        expect(cheapLocalStat('')).toEqual({ additions: 0, deletions: 0 });
    });

    it('does not count a trailing newline as a phantom line', () => {
        expect(cheapLocalStat('a\nb\n')).toEqual({ additions: 2, deletions: 0 });
    });

    it('normalizes CRLF line endings', () => {
        expect(cheapLocalStat('a\r\nb\r\nc')).toEqual({ additions: 3, deletions: 0 });
    });
});

describe('addedContentStat', () => {
    it('counts every line as an addition for a one-sided +N change', () => {
        expect(addedContentStat('line1\nline2')).toEqual({ additions: 2, deletions: 0 });
    });

    it('reports zero for empty content', () => {
        expect(addedContentStat('')).toEqual({ additions: 0, deletions: 0 });
    });

    it('does not count a trailing newline as a phantom line', () => {
        expect(addedContentStat('line1\nline2\n')).toEqual({ additions: 2, deletions: 0 });
    });
});

describe('deletedContentStat', () => {
    it('counts every line as a deletion for a one-sided -N change', () => {
        expect(deletedContentStat('line1\nline2')).toEqual({ additions: 0, deletions: 2 });
    });

    it('reports zero for empty content', () => {
        expect(deletedContentStat('')).toEqual({ additions: 0, deletions: 0 });
    });

    it('does not count a trailing newline as a phantom line', () => {
        expect(deletedContentStat('line1\nline2\n')).toEqual({ additions: 0, deletions: 2 });
    });
});
