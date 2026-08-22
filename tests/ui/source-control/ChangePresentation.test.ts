import { describe, expect, it, beforeAll } from 'vitest';
import { cheapLocalStat, computeDiffStat, changeOperation, presentChange } from '../../../src/ui/source-control/ChangePresentation';
import type { SourceControlItem } from '../../../src/logic/source-control/SourceControlViewModel';
import { toChangeId } from '../../../src/logic/source-control/types';
import { setupObsidianDOM } from '../setup-dom';

beforeAll(() => { setupObsidianDOM(); });

function item(overrides: Partial<SourceControlItem> & Pick<SourceControlItem, 'id' | 'path' | 'kind'>): SourceControlItem {
    return { isReadyToPush: false, operationStatus: 'idle', ...overrides };
}

describe('presentChange', () => {
    it('badges a local-only change as A', () => {
        const view = presentChange(item({ id: toChangeId('a'), path: 'a.md', kind: 'local-only' }), 'a.md');
        expect(view.badge.letter).toBe('A');
        expect(view.badge.cls).toBe('local-only');
        expect(view.subtitle).toBe('Added locally');
    });

    it('badges a local-modified change as M', () => {
        const view = presentChange(item({ id: toChangeId('a'), path: 'a.md', kind: 'local-modified' }), 'a.md');
        expect(view.badge.letter).toBe('M');
        expect(view.subtitle).toBe('Modified locally');
    });

    it('badges a remote-only change as a down-arrow with a download tooltip', () => {
        const view = presentChange(item({ id: toChangeId('a'), path: 'a.md', kind: 'remote-only' }), 'a.md');
        expect(view.badge.letter).toBe('↓');
        expect(view.badge.cls).toBe('remote-only');
        expect(view.subtitle).toBe('Remote available');
        expect(view.tooltip).toBe('Exists on remote but not locally — download to add it');
    });

    it('badges a remote-modified change as a sync-arrow', () => {
        const view = presentChange(item({ id: toChangeId('a'), path: 'a.md', kind: 'remote-modified' }), 'a.md');
        expect(view.badge.letter).toBe('↕');
        expect(view.subtitle).toBe('Modified remotely');
    });

    it('badges a moved change as R and splits the rename from the display name', () => {
        const view = presentChange(
            item({ id: toChangeId('a'), path: 'folder/new.md', previousPath: 'folder/old.md', kind: 'moved' }),
            'new.md',
        );
        expect(view.badge.letter).toBe('R');
        expect(view.subtitle).toBe('Renamed');
        expect(view.renameFrom).toBe('old.md');
        expect(view.displayName).toBe('new.md');
    });

    it('badges a conflict as !', () => {
        const view = presentChange(item({ id: toChangeId('a'), path: 'a.md', kind: 'conflict' }), 'a.md');
        expect(view.badge.letter).toBe('!');
        expect(view.subtitle).toBe('Conflict');
    });

    it('badges a synced change as S', () => {
        const view = presentChange(item({ id: toChangeId('a'), path: 'a.md', kind: 'synced' }), 'a.md');
        expect(view.badge.letter).toBe('S');
        expect(view.subtitle).toBe('Synced');
    });

    it('uses the basename of previousPath for the rename from', () => {
        const view = presentChange(
            item({ id: toChangeId('a'), path: 'x/y.md', previousPath: 'a/b/old.md', kind: 'moved' }),
            'y.md',
        );
        expect(view.renameFrom).toBe('old.md');
    });
});

describe('changeOperation', () => {
    it.each([
        ['local-only', 'upload'],
        ['local-modified', 'upload'],
        ['moved', 'upload'],
        ['conflict', 'upload'],
    ] as const)('routes %s to upload', (kind, op) => {
        expect(changeOperation(kind)).toBe(op);
    });

    it.each([
        ['remote-only', 'download'],
        ['remote-modified', 'download'],
    ] as const)('routes %s to download', (kind, op) => {
        expect(changeOperation(kind)).toBe(op);
    });
});

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