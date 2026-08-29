import { describe, expect, it, vi } from 'vitest';
import { DiffStatProvider } from '../../../src/ui/source-control/DiffStatProvider';
import type { SourceControlItem } from '../../../src/logic/source-control/SourceControlViewModel';
import type { ChangeStat } from '../../../src/ui/source-control/ChangePresentation';
import { toChangeId } from '../../../src/logic/source-control/types';

function item(id: string, kind: SourceControlItem['kind'] = 'local-only'): SourceControlItem {
    return { id: toChangeId(id), path: `${id}.md`, kind, isSelectedForSync: false, operationStatus: 'idle' };
}

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('DiffStatProvider', () => {
    it('returns undefined for an uncached id and surfaces the stat once eagerLocal settles', async () => {
        const stat: ChangeStat = { additions: 5, deletions: 0 };
        const loadDiffStat = vi.fn().mockResolvedValue(stat);
        const settle = vi.fn();
        const provider = new DiffStatProvider(loadDiffStat, settle);

        expect(provider.get(toChangeId('c-1'))).toBeUndefined();

        provider.eagerLocal([item('c-1')]);
        await flush();

        expect(loadDiffStat).toHaveBeenCalledOnce();
        expect(provider.get(toChangeId('c-1'))).toEqual(stat);
        expect(settle).toHaveBeenCalledOnce();
    });

    it('eagerLocal only loads local-only rows, skipping other kinds', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue({ additions: 1, deletions: 0 });
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        provider.eagerLocal([item('c-1', 'local-only'), item('c-2', 'local-modified'), item('c-3', 'remote-only')]);
        await flush();

        expect(loadDiffStat).toHaveBeenCalledOnce();
        expect(loadDiffStat).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local-only' }));
    });

    it('eagerSelected loads every kind in the queue, not just local-only', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue({ additions: 2, deletions: 1 });
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        provider.eagerSelected([item('c-1', 'local-only'), item('c-2', 'local-modified')]);
        await flush();

        expect(loadDiffStat).toHaveBeenCalledTimes(2);
    });

    it('caches a null result so an unavailable stat is not retried on the next pass', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue(null);
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        provider.eagerLocal([item('c-1')]);
        await flush();
        expect(loadDiffStat).toHaveBeenCalledOnce();

        // A second pass must not re-request the already-settled (null) row.
        provider.eagerLocal([item('c-1')]);
        await flush();
        expect(loadDiffStat).toHaveBeenCalledOnce();
    });

    it('lazyLoad loads a single uncached item and caches it', async () => {
        const stat: ChangeStat = { additions: 1, deletions: 4 };
        const loadDiffStat = vi.fn().mockResolvedValue(stat);
        const settle = vi.fn();
        const provider = new DiffStatProvider(loadDiffStat, settle);

        await provider.lazyLoad(item('c-2', 'local-modified'));

        expect(loadDiffStat).toHaveBeenCalledOnce();
        expect(provider.get(toChangeId('c-2'))).toEqual(stat);
        expect(settle).toHaveBeenCalledOnce();
    });

    it('lazyLoad skips when the stat is already cached', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue({ additions: 1, deletions: 0 });
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());
        provider.eagerLocal([item('c-1')]);
        await flush();

        await provider.lazyLoad(item('c-1'));

        expect(loadDiffStat).toHaveBeenCalledOnce();
    });

    it('lazyLoad does not settle when the result is null and does not retry on the next call', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue(null);
        const settle = vi.fn();
        const provider = new DiffStatProvider(loadDiffStat, settle);

        await provider.lazyLoad(item('c-2', 'local-modified'));

        // Nothing to render, so no re-render.
        expect(settle).not.toHaveBeenCalled();
        // The null result is cached: a second lazyLoad must not re-request it.
        await provider.lazyLoad(item('c-2', 'local-modified'));
        expect(loadDiffStat).toHaveBeenCalledOnce();
    });

    it('clear empties the cache so rows reload after a refresh', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue({ additions: 3, deletions: 0 });
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());
        provider.eagerLocal([item('c-1')]);
        await flush();
        expect(provider.get(toChangeId('c-1'))).toBeDefined();

        provider.clear();
        expect(provider.get(toChangeId('c-1'))).toBeUndefined();

        provider.eagerLocal([item('c-1')]);
        await flush();
        expect(loadDiffStat).toHaveBeenCalledTimes(2);
    });

    it('is a no-op when no loader is provided', async () => {
        const provider = new DiffStatProvider(undefined, vi.fn());
        provider.eagerLocal([item('c-1')]);
        provider.eagerSelected([item('c-1')]);
        await provider.lazyLoad(item('c-1'));
        await flush();
        expect(provider.get(toChangeId('c-1'))).toBeUndefined();
    });
});