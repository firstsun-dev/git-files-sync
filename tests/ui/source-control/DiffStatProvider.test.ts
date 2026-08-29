import { describe, expect, it, vi } from 'vitest';
import { DiffStatProvider } from '../../../src/ui/source-control/DiffStatProvider';
import type { DiffStatLoadResult } from '../../../src/ui/source-control/DiffStatProvider';
import type { SourceControlItem } from '../../../src/logic/source-control/SourceControlViewModel';
import type { ChangeStat } from '../../../src/ui/source-control/ChangePresentation';
import { toChangeId } from '../../../src/logic/source-control/types';

function item(id: string, kind: SourceControlItem['kind'] = 'local-only'): SourceControlItem {
    return { id: toChangeId(id), path: `${id}.md`, kind, isSelectedForSync: false, operationStatus: 'idle' };
}

function ready(stat: ChangeStat): DiffStatLoadResult {
    return { status: 'ready', stat };
}

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('DiffStatProvider', () => {
    it('returns undefined for an uncached id and surfaces the stat once loadVisible settles', async () => {
        const stat: ChangeStat = { additions: 5, deletions: 0 };
        const loadDiffStat = vi.fn().mockResolvedValue(ready(stat));
        const settle = vi.fn();
        const provider = new DiffStatProvider(loadDiffStat, settle);

        expect(provider.get(toChangeId('c-1'))).toBeUndefined();

        provider.loadVisible([item('c-1')]);
        await flush();

        expect(loadDiffStat).toHaveBeenCalledOnce();
        expect(provider.get(toChangeId('c-1'))).toEqual(stat);
        expect(settle).toHaveBeenCalledOnce();
    });

    it('loadVisible loads all kinds — two-sided rows background-load too', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue(ready({ additions: 1, deletions: 0 }));
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        provider.loadVisible([item('c-1', 'local-only'), item('c-2', 'local-modified'), item('c-3', 'remote-only')]);
        await flush();

        expect(loadDiffStat).toHaveBeenCalledTimes(3);
    });

    it('prioritizes local-only rows ahead of two-sided rows in the background queue', async () => {
        const deferred: Array<(result: DiffStatLoadResult) => void> = [];
        const calls: SourceControlItem[] = [];
        const loadDiffStat = vi.fn((item: SourceControlItem): Promise<DiffStatLoadResult> => {
            calls.push(item);
            return new Promise(resolve => { deferred.push(resolve); });
        });
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        provider.loadVisible([item('m-1', 'local-modified'), item('a-1', 'local-only'), item('m-2', 'local-modified'), item('m-3', 'local-modified'), item('a-2', 'local-only'), item('m-4', 'local-modified')]);
        // First dispatch wave fills up to the concurrency cap, but takes
        // local-only rows ahead of two-sided rows wherever they sit in the
        // queue.
        const firstWave = calls.slice(0, 4).map(call => call.kind);
        expect(firstWave.filter(kind => kind === 'local-only')).toHaveLength(2);
        expect(calls[0]?.kind).toBe('local-only');
    });

    it('never runs more than 4 loaders concurrently when a long list is queued', async () => {
        const MAX = 4;
        let inFlight = 0;
        let peak = 0;
        let dispatched = 0;
        const loadDiffStat = vi.fn((_item: SourceControlItem): Promise<DiffStatLoadResult> => {
            dispatched += 1;
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            return new Promise<DiffStatLoadResult>(resolve => {
                // Each in-flight call resolves after a fresh microtask turn so
                // the concurrency cap is observed across many dispatch waves.
                queueMicrotask(() => {
                    inFlight -= 1;
                    resolve(ready({ additions: 1, deletions: 0 }));
                });
            });
        });
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());
        provider.loadVisible(Array.from({ length: 20 }, (_, i) => item(`m-${i}`, 'local-modified')));

        await vi.waitFor(() => { expect(dispatched).toBe(20); });
        expect(peak).toBeLessThanOrEqual(MAX);
    });

    it('caches an unavailable result so the row is never retried', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue({ status: 'unavailable' });
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        provider.loadVisible([item('c-1')]);
        await flush();
        expect(loadDiffStat).toHaveBeenCalledOnce();

        // A second pass must not re-request the already-cached unavailable row.
        provider.loadVisible([item('c-1')]);
        await flush();
        expect(loadDiffStat).toHaveBeenCalledOnce();
    });

    it('does NOT cache a pending result, so the row retries and lands when content arrives', async () => {
        const stat: ChangeStat = { additions: 130, deletions: 0 };
        const loadDiffStat = vi
            .fn((_item: SourceControlItem): Promise<DiffStatLoadResult> => Promise.resolve({ status: 'pending' }))
            .mockResolvedValueOnce({ status: 'pending' })
            .mockResolvedValueOnce(ready(stat));
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        // First pass: content not yet in memory.
        provider.loadVisible([item('c-1')]);
        await flush();
        expect(loadDiffStat).toHaveBeenCalledOnce();
        expect(provider.get(toChangeId('c-1'))).toBeUndefined();

        // Second pass retries (nothing poisoned the cache) and caches the stat.
        provider.loadVisible([item('c-1')]);
        await flush();
        expect(loadDiffStat).toHaveBeenCalledTimes(2);
        expect(provider.get(toChangeId('c-1'))).toEqual(stat);
    });

    it('loading the same local-only row twice does not duplicate the fetch', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue(ready({ additions: 2, deletions: 1 }));
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        provider.loadVisible([item('c-1')]);
        provider.loadVisible([item('c-1')]);
        await flush();

        expect(loadDiffStat).toHaveBeenCalledOnce();
        expect(provider.get(toChangeId('c-1'))).toEqual({ additions: 2, deletions: 1 });
    });

    it('invalidate drops only one row so just it reloads', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue(ready({ additions: 1, deletions: 0 }));
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        provider.loadVisible([item('c-1'), item('c-2')]);
        await flush();
        expect(loadDiffStat).toHaveBeenCalledTimes(2);

        provider.invalidate(toChangeId('c-1'));
        expect(provider.get(toChangeId('c-1'))).toBeUndefined();
        expect(provider.get(toChangeId('c-2'))).toBeDefined();

        provider.loadVisible([item('c-1'), item('c-2')]);
        await flush();
        // Only the invalidated row re-fetched.
        expect(loadDiffStat).toHaveBeenCalledTimes(3);
    });

    it('clear empties the cache so all rows reload after a refresh', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue(ready({ additions: 3, deletions: 0 }));
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());
        provider.loadVisible([item('c-1')]);
        await flush();
        expect(provider.get(toChangeId('c-1'))).toBeDefined();

        provider.clear();
        expect(provider.get(toChangeId('c-1'))).toBeUndefined();

        provider.loadVisible([item('c-1')]);
        await flush();
        expect(loadDiffStat).toHaveBeenCalledTimes(2);
    });

    it('lazyLoad loads a single uncached item outside the queue and caches it', async () => {
        const stat: ChangeStat = { additions: 1, deletions: 4 };
        const loadDiffStat = vi.fn().mockResolvedValue(ready(stat));
        const settle = vi.fn();
        const provider = new DiffStatProvider(loadDiffStat, settle);

        await provider.lazyLoad(item('c-2', 'local-modified'));

        expect(loadDiffStat).toHaveBeenCalledOnce();
        expect(provider.get(toChangeId('c-2'))).toEqual(stat);
        expect(settle).toHaveBeenCalledOnce();
    });

    it('lazyLoad skips when the stat is already cached', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue(ready({ additions: 1, deletions: 0 }));
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());
        provider.loadVisible([item('c-1')]);
        await flush();

        await provider.lazyLoad(item('c-1'));

        expect(loadDiffStat).toHaveBeenCalledOnce();
    });

    it('lazyLoad does not settle or cache a pending result and retries on the next call', async () => {
        const loadDiffStat = vi.fn().mockResolvedValue({ status: 'pending' });
        const settle = vi.fn();
        const provider = new DiffStatProvider(loadDiffStat, settle);

        await provider.lazyLoad(item('c-2', 'local-modified'));

        // Nothing to render, so no re-render.
        expect(settle).not.toHaveBeenCalled();
        // Pending is not cached: a second lazyLoad retries.
        await provider.lazyLoad(item('c-2', 'local-modified'));
        expect(loadDiffStat).toHaveBeenCalledTimes(2);
    });

    it('batches settle calls that land in the same microtask into one re-render', async () => {
        const settle = vi.fn();
        const loadDiffStat = vi.fn().mockResolvedValue(ready({ additions: 1, deletions: 0 }));
        const provider = new DiffStatProvider(loadDiffStat, settle);

        provider.loadVisible([item('c-1'), item('c-2'), item('c-3')]);
        await flush();

        expect(loadDiffStat).toHaveBeenCalledTimes(3);
        expect(settle).toHaveBeenCalledOnce();
    });

    it('is a no-op when no loader is provided', async () => {
        const provider = new DiffStatProvider(undefined, vi.fn());
        provider.loadVisible([item('c-1')]);
        await provider.lazyLoad(item('c-1'));
        await flush();
        expect(provider.get(toChangeId('c-1'))).toBeUndefined();
    });

    // ---------------------------------------------------------------
    // Stale async results must never poison the cache (lifecycle)
    // ---------------------------------------------------------------

    it('discards an in-flight load result that settled after invalidate()', async () => {
        const deferred: Array<(result: DiffStatLoadResult) => void> = [];
        const loadDiffStat = vi.fn((_item: SourceControlItem): Promise<DiffStatLoadResult> =>
            new Promise(resolve => { deferred.push(resolve); }));
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        // Request #1 starts (old content).
        provider.loadVisible([item('c-1')]);
        expect(loadDiffStat).toHaveBeenCalledTimes(1);

        // invalidate() while the request is in flight (content changed).
        provider.invalidate(toChangeId('c-1'));

        // Request #1 returns the OLD stat — stale; must not enter the cache.
        deferred[0]?.(ready({ additions: 3, deletions: 1 }));
        await flush();
        expect(provider.get(toChangeId('c-1'))).toBeUndefined();

        // Next load pass: request #2 fires and the new stat wins.
        provider.loadVisible([item('c-1')]);
        expect(loadDiffStat).toHaveBeenCalledTimes(2);
        deferred[1]?.(ready({ additions: 8, deletions: 2 }));
        await flush();
        expect(provider.get(toChangeId('c-1'))).toEqual({ additions: 8, deletions: 2 });
    });

    it('a freshly-requeued row whose old request settles after re-request does not overwrite (out-of-order settle)', async () => {
        const deferred: Array<(result: DiffStatLoadResult) => void> = [];
        const loadDiffStat = vi.fn((_item: SourceControlItem): Promise<DiffStatLoadResult> =>
            new Promise(resolve => { deferred.push(resolve); }));
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        provider.loadVisible([item('c-1')]);
        provider.invalidate(toChangeId('c-1'));
        provider.loadVisible([item('c-1')]);
        // Deferred[0] = stale request #1; deferred[1] = fresh request #2.
        // Settle them out of order to prove the generation guard, not
        // resolution order, decides the winner.
        deferred[0]?.(ready({ additions: 99, deletions: 0 }));
        await flush();
        expect(provider.get(toChangeId('c-1'))).toBeUndefined();
        deferred[1]?.(ready({ additions: 8, deletions: 2 }));
        await flush();
        expect(provider.get(toChangeId('c-1'))).toEqual({ additions: 8, deletions: 2 });
    });

    it('clear() while requests are in flight rejects ALL old results — none repopulate the cache', async () => {
        const deferred: Array<(result: DiffStatLoadResult) => void> = [];
        const loadDiffStat = vi.fn((_item: SourceControlItem): Promise<DiffStatLoadResult> =>
            new Promise(resolve => { deferred.push(resolve); }));
        const provider = new DiffStatProvider(loadDiffStat, vi.fn());

        provider.loadVisible([item('c-1'), item('c-2'), item('c-3'), item('c-4')]);
        // All four wave-1 requests are in flight when the refresh clears.
        provider.clear();

        for (let index = 0; index < 4; index++) {
            deferred[index]?.(ready({ additions: index + 1, deletions: 0 }));
        }
        await flush();

        for (const id of ['c-1', 'c-2', 'c-3', 'c-4']) {
            expect(provider.get(toChangeId(id))).toBeUndefined();
        }
        // A later full reload starts fresh and commits normally.
        provider.loadVisible([item('c-1')]);
        expect(loadDiffStat).toHaveBeenCalledTimes(5);
        deferred[4]?.(ready({ additions: 42, deletions: 0 }));
        await flush();
        expect(provider.get(toChangeId('c-1'))).toEqual({ additions: 42, deletions: 0 });
    });

    it('a background loader rejection is not cached as unavailable and does not reject fire-and-forget callers', async () => {
        const loader: (item: SourceControlItem) => Promise<DiffStatLoadResult> = vi.fn()
            .mockRejectedValueOnce(new Error('transient network failure'))
            .mockResolvedValueOnce(ready({ additions: 5, deletions: 0 }));
        const loadDiffStat = loader as ReturnType<typeof vi.fn>;
        const settle = vi.fn();
        const provider = new DiffStatProvider(loader, settle);

        // `run` swallows the rejection; no unhandled rejection escapes.
        provider.loadVisible([item('c-1')]);
        await flush();
        expect(provider.get(toChangeId('c-1'))).toBeUndefined();
        expect(settle).not.toHaveBeenCalled();

        // The row stays retryable — the next pass succeeds and caches.
        provider.loadVisible([item('c-1')]);
        await flush();
        expect(loadDiffStat).toHaveBeenCalledTimes(2);
        expect(provider.get(toChangeId('c-1'))).toEqual({ additions: 5, deletions: 0 });
    });

    it('a lazyLoad rejection is swallowed and the row retries later', async () => {
        const loader: (item: SourceControlItem) => Promise<DiffStatLoadResult> = vi.fn()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValueOnce(ready({ additions: 2, deletions: 0 }));
        const provider = new DiffStatProvider(loader, vi.fn());

        await expect(provider.lazyLoad(item('c-1'))).resolves.toBeUndefined();
        expect(provider.get(toChangeId('c-1'))).toBeUndefined();

        await provider.lazyLoad(item('c-1'));
        expect(provider.get(toChangeId('c-1'))).toEqual({ additions: 2, deletions: 0 });
    });
});