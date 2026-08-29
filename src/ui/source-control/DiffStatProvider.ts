import type { ChangeId } from '../../logic/source-control/types';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeStat } from './ChangePresentation';

/**
 * What the loader resolved for one change row. The distinction matters
 * because the cache treats the three outcomes differently:
 * - `ready` — cached as a usable stat.
 * - `unavailable` — permanent (binary, symlink, no two sides to diff);
 *   cached so the row is never retried.
 * - `pending` — the backing content simply isn't in memory yet (e.g. a
 *   `local-only` row whose `localContent` hasn't been read). NOT cached:
 *   the next load pass retries the row, so a late-arriving stat still lands.
 */
export type DiffStatLoadResult =
    | { status: 'ready'; stat: ChangeStat }
    | { status: 'pending' }
    | { status: 'unavailable' };

type DiffStatCacheEntry =
    | { state: 'ready'; stat: ChangeStat }
    | { state: 'unavailable' };

/**
 * Loads (load) and caches the +/- diff stat for change rows, isolated from
 * the view so cache + load + invalidate live in one place instead of being
 * scattered across `SourceControlView` render methods. The view owns no diff
 * cache of its own anymore — it asks this provider.
 *
 * Loading is bounded ({@link DiffStatProvider.MAX_CONCURRENT}) and runs in
 * the background: `loadVisible` queues every uncached row — `local-only`
 * first (cheap in-memory reads), then two-sided changes — progressively
 * settling re-renders as stats land. `lazyLoad` serves the single
 * user-opened diff without waiting behind the queue.
 *
 * Only permanent outcomes are cached (`ready` / `unavailable`); `pending`
 * stays uncached so the row retries. The injected `settle` callback
 * re-renders the view once a batch lands; `lazyLoad` settles only when it
 * produced a stat (nothing to render otherwise). Per-row
 * {@link DiffStatProvider.invalidate} lets a single file's status update
 * drop just that row's stat without clearing the other rows' caches.
 */
export class DiffStatProvider {
    /** Upper bound on concurrent loader calls — a long list must not fire 80 fetches at once. */
    private static readonly MAX_CONCURRENT = 4;

    /** Cached stat state per change id; `pending` results are deliberately absent. */
    private readonly cache = new Map<ChangeId, DiffStatCacheEntry>();
    /** Items queued for a background load (insertion order = render order). */
    private readonly queued = new Map<ChangeId, SourceControlItem>();
    private readonly active = new Set<ChangeId>();
    private settleScheduled = false;

    constructor(
        /**
         * Supplies the load outcome for a change row. `local-only` is expected
         * to be a cheap in-memory read; other kinds may involve a remote
         * fetch. When omitted the provider is inert (the view renders
         * without stats).
         */
        private readonly loadDiffStat: ((item: SourceControlItem) => Promise<DiffStatLoadResult>) | undefined,
        /** Re-renders the view after an async load settles so rows show their stat. */
        private readonly settle: () => void,
    ) {}

    /** Returns the cached stat for `id`, or `undefined` when none is cached (incl. never-attempted / pending). */
    get(id: ChangeId): ChangeStat | undefined {
        const entry = this.cache.get(id);
        return entry?.state === 'ready' ? entry.stat : undefined;
    }

    /** Empties the cache so all rows reload after a refresh or sync. */
    clear(): void {
        this.cache.clear();
    }

    /** Drops one row's cached entry so only it reloads (a single file's content changed). */
    invalidate(id: ChangeId): void {
        this.cache.delete(id);
    }

    /**
     * Background-loads stats for the given visible rows. Every uncached/not-
     * in-flight item is queued (priority: `local-only` first, then two-sided
     * kinds), run at most {@link DiffStatProvider.MAX_CONCURRENT} at a time,
     * and each `ready` result settles (batched per microtask) one progressive
     * re-render. `pending` results stay uncached and retry on the next pass.
     */
    loadVisible(items: readonly SourceControlItem[]): void {
        if (!this.loadDiffStat) return;
        for (const item of items) {
            if (this.cache.has(item.id) || this.active.has(item.id) || this.queued.has(item.id)) continue;
            this.queued.set(item.id, item);
        }
        this.pump();
    }

    /**
     * Lazily resolves the stat for a single change outside the background
     * queue (a user just opened that row's diff), caching it so subsequent
     * renders show the stat without a refetch. Settles only when a stat was
     * actually produced (an `unavailable`/`pending` result changes nothing on
     * screen); pending is retried on a later call.
     */
    async lazyLoad(item: SourceControlItem): Promise<void> {
        if (!this.loadDiffStat || this.cache.has(item.id) || this.active.has(item.id)) return;
        this.active.add(item.id);
        try {
            const result = await this.loadDiffStat(item);
            if (result.status === 'ready') {
                this.cache.set(item.id, { state: 'ready', stat: result.stat });
                this.settleOnce();
            } else if (result.status === 'unavailable') {
                this.cache.set(item.id, { state: 'unavailable' });
            }
        } finally {
            this.active.delete(item.id);
            this.pump();
        }
    }

    private pump(): void {
        while (this.active.size < DiffStatProvider.MAX_CONCURRENT && this.queued.size > 0) {
            const item = this.takeNext();
            if (!item) break;
            this.active.add(item.id);
            void this.run(item);
        }
    }

    /** Dequeues the highest-priority item (`local-only` cheap reads before two-sided fetches). */
    private takeNext(): SourceControlItem | undefined {
        for (const item of this.queued.values()) {
            if (item.kind === 'local-only') {
                this.queued.delete(item.id);
                return item;
            }
        }
        const first = this.queued.values().next();
        if (first.done) return undefined;
        const item = first.value;
        this.queued.delete(item.id);
        return item;
    }

    private async run(item: SourceControlItem): Promise<void> {
        try {
            const result = await this.loadDiffStat!(item);
            if (result.status === 'ready') {
                this.cache.set(item.id, { state: 'ready', stat: result.stat });
                this.settleOnce();
            } else if (result.status === 'unavailable') {
                this.cache.set(item.id, { state: 'unavailable' });
            }
        } finally {
            this.active.delete(item.id);
            this.pump();
        }
    }

    /** Batches settle calls so a burst of stat landings re-renders once, not once per row. */
    private settleOnce(): void {
        if (this.settleScheduled) return;
        this.settleScheduled = true;
        queueMicrotask(() => {
            this.settleScheduled = false;
            this.settle();
        });
    }
}