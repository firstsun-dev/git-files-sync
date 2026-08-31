import { describe, expect, it } from 'vitest';
import { buildSummary } from '../../../src/logic/source-control/SourceControlSummary';
import { SyncSelectionStore } from '../../../src/logic/source-control/SyncSelectionStore';
import { toChangeId, type SyncChange } from '../../../src/logic/source-control/types';

function local(id: string, path = `${id}.md`): SyncChange {
    return { id: toChangeId(id), path, kind: 'local-only' };
}

function remote(id: string, path = `${id}.md`): SyncChange {
    return { id: toChangeId(id), path, kind: 'remote-only' };
}

function synced(id: string, path = `${id}.md`): SyncChange {
    return { id: toChangeId(id), path, kind: 'synced' };
}

/** Builds a change set with `nLocal` local, `nRemote` remote, and `nSynced` synced changes. */
function changes(nLocal: number, nRemote: number, nSynced: number): SyncChange[] {
    const out: SyncChange[] = [];
    for (let i = 0; i < nLocal; i++) out.push(local(`local-${i}`));
    for (let i = 0; i < nRemote; i++) out.push(remote(`remote-${i}`));
    for (let i = 0; i < nSynced; i++) out.push(synced(`synced-${i}`));
    return out;
}

describe('SourceControlSummary', () => {
    describe('Case 1: actionable All excludes synced', () => {
        it('reports all = local + remote (132) and synced = 36 for 115/17/36', () => {
            const selection = new SyncSelectionStore();
            const summary = buildSummary(changes(115, 17, 36), selection, true);

            expect(summary.counts.all).toBe(132);
            expect(summary.counts.changes).toBe(115);
            expect(summary.counts['remote-changes']).toBe(17);
            expect(summary.counts.synced).toBe(36);
            expect(summary.synced).toHaveLength(36);
        });

        it('keeps synced changes out of the actionable all bucket', () => {
            const selection = new SyncSelectionStore();
            const summary = buildSummary(changes(115, 17, 36), selection, true);

            expect(summary.all.every(change => change.kind !== 'synced')).toBe(true);
            expect(summary.all).toHaveLength(132);
        });
    });

    describe('Case 2: synced hidden (showSynced = false)', () => {
        it('renders a synced count of 0 while the raw synced bucket still holds 36', () => {
            const selection = new SyncSelectionStore();
            const summary = buildSummary(changes(115, 17, 36), selection, false);

            expect(summary.counts.synced).toBe(0);
            expect(summary.synced).toHaveLength(36);
            // render count (0) differs from the actual synced count (36)
            expect(summary.counts.synced).not.toBe(summary.synced.length);
        });

        it('does not affect the actionable All count when synced is hidden', () => {
            const selection = new SyncSelectionStore();
            const hidden = buildSummary(changes(115, 17, 36), selection, false);
            const shown = buildSummary(changes(115, 17, 36), selection, true);

            expect(hidden.counts.all).toBe(132);
            expect(hidden.counts.all).toBe(shown.counts.all);
        });
    });

    describe('Case 3: All filter never surfaces a synced bucket', () => {
        it('contains no synced change in the actionable all bucket', () => {
            const selection = new SyncSelectionStore();
            const summary = buildSummary(changes(10, 5, 20), selection, false);

            expect(summary.all.filter(change => change.kind === 'synced')).toEqual([]);
        });

        it('partitions kinds into disjoint actionable buckets plus synced', () => {
            const input: SyncChange[] = [
                local('l1'), { id: toChangeId('l2'), path: 'l2.md', kind: 'local-modified' },
                { id: toChangeId('l3'), path: 'l3.md', kind: 'moved' },
                { id: toChangeId('l4'), path: 'l4.md', kind: 'local-deleted' },
                remote('r1'), { id: toChangeId('r2'), path: 'r2.md', kind: 'remote-modified' },
                { id: toChangeId('cf'), path: 'cf.md', kind: 'conflict' },
                synced('s1'),
            ];
            const summary = buildSummary(input, new SyncSelectionStore(), true);

            expect(summary.localChanges.map(c => c.id)).toEqual([toChangeId('l1'), toChangeId('l2'), toChangeId('l3'), toChangeId('l4')]);
            expect(summary.remoteChanges.map(c => c.id)).toEqual([toChangeId('r1'), toChangeId('r2')]);
            expect(summary.conflicts.map(c => c.id)).toEqual([toChangeId('cf')]);
            expect(summary.synced.map(c => c.id)).toEqual([toChangeId('s1')]);
            expect(summary.all.map(c => c.id)).toEqual([
                toChangeId('l1'), toChangeId('l2'), toChangeId('l3'), toChangeId('l4'),
                toChangeId('r1'), toChangeId('r2'), toChangeId('cf'),
            ]);
        });
    });

    describe('ready-to-push selection', () => {
        it('counts only selected actionable changes, ignoring synced selections', () => {
            const selection = new SyncSelectionStore();
            selection.selectForSync(toChangeId('local-0'));
            selection.selectForSync(toChangeId('synced-0'));
            const summary = buildSummary(changes(2, 1, 2), selection, true);

            // synced-0 was selected but is not actionable, so it is excluded.
            expect(summary.counts['ready-to-push']).toBe(1);
            expect(summary.readyToPush.map(c => c.id)).toEqual([toChangeId('local-0')]);
        });
    });
});