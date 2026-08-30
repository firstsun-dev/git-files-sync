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
 * One in-flight load request's identity. The map key (change id) answers "is
 * there a current request for this row"; the record itself carries the
 * request's unique token and the generations it was started under, so a
 * finishing request can only remove ITS OWN marker — never a newer request's
 * (the old `Set<ChangeId>` conflated both and let request #1's finally block
 * delete request #2's marker after an `invalidate` re-request).
 */
interface ActiveDiffStatRequest {
    readonly token: number;
    readonly globalGeneration: number;
    readonly itemGeneration: number;
}

/**
 * Minimal row contract: any item with a string id can get backgrounded,
 * bounded, cached diff-stat loading.
 */
export type DiffStatItem<TId extends string> = { readonly id: TId };

/**
 * Loads (load) and caches the +/- diff stat for change rows, isolated from
 * the view so cache + load + invalidate live in one place instead of being
 * scattered across render methods. The view owns no diff cache of its own —
 * it asks this provider.
 *
 * Generic over the row item: `SourceControlView` feeds `SourceControlItem`s,
 * the batch conflict modal feeds `BatchPushConflict`s, and any other surface
 * reuses the same bounded-queue + generation-guard + settle-batching
 * machinery instead of growing its own cache architecture.
 *
 * Loading is bounded ({@link DiffStatProvider.MAX_CONCURRENT}) and runs in
 * the background: `loadVisible` queues every uncached row — prioritizeable
 * rows first (cheap in-memory reads), then the rest — progressively settling
 * re-renders as stats land. `lazyLoad` serves the single user-opened diff
 * without waiting behind the queue.
 *
 * Only permanent outcomes are cached (`ready` / `unavailable`); `pending`
 * stays uncached so the row retries. A loader *throwing* is also not
 * cached — a transient background failure must not poison the row as
 * permanently `unavailable`; the next load pass retries it. The injected
 * `settle` callback re-renders the view once a batch lands; `lazyLoad`
 * settles only when it produced a stat (nothing to render otherwise).
 *
 * In-flight loads are guarded by a two-level generation counter: an
 * `invalidate` (bumps the row generation) or `clear` (bumps the global
 * generation) drops the cache AND makes the still-running request's result
 * stale, so a late-resolving old response can never commit into the cache
 * over the fresh reload. The stale request is not aborted — it is simply
 * denied the cache write. Identity of in-flight work is per-REQUEST (a token
 * on {@link ActiveDiffStatRequest}), not per-row: `invalidate` may start a
 * new request while the old one is still physically running, and only the
 * token owner may remove its own marker. Physical concurrency is tracked
 * separately (`physicalInFlight`) so abandoned calls still count against the
 * {@link DiffStatProvider.MAX_CONCURRENT} cap.
 */
export class DiffStatProvider<TId extends string, TItem extends DiffStatItem<TId>> {
    /** Upper bound on concurrent loader calls — a long list must not fire 80 fetches at once. */
    private static readonly MAX_CONCURRENT = 4;

    /** Cached stat state per change id; `pending` results are deliberately absent. */
    private readonly cache = new Map<TId, DiffStatCacheEntry>();
    /** Items queued for a background load (insertion order = render order). */
    private readonly queued = new Map<TId, TItem>();
    /** Current (newest) in-flight request per row, keyed by change id. */
    private readonly active = new Map<TId, ActiveDiffStatRequest>();
    /**
     * Physical HTTP/loader calls that have not finished yet. Distinct from
     * `active.size`: `invalidate` drops a row's active marker immediately so
     * a fresh request can start, but the abandoned call is still physically
     * running and must keep counting against
     * {@link DiffStatProvider.MAX_CONCURRENT} until it settles.
     */
    private physicalInFlight = 0;
    private nextRequestToken = 0;
    /** Bumped by `clear()`; any in-flight request carrying an older value is stale. */
    private globalGeneration = 0;
    /** Bumped per row by `invalidate()`; an in-flight request for that row carrying an older value is stale. */
    private readonly generations = new Map<TId, number>();
    private settleScheduled = false;

    constructor(
        /**
         * Supplies the load outcome for a change row. Cheap in-memory reads
         * are expected to resolve instantly; other kinds may involve a
         * remote fetch. When omitted the provider is inert (the view renders
         * without stats).
         */
        private readonly loadDiffStat: ((item: TItem) => Promise<DiffStatLoadResult>) | undefined,
        /** Re-renders the view after an async load settles so rows show their stat. */
        private readonly settle: () => void,
        /**
         * Marks rows that should jump the background queue because their stat
         * is a cheap in-memory read (e.g. `local-only` source-control rows).
         */
        private readonly isPriority: (item: TItem) => boolean = () => false,
    ) {}

    /** Returns the cached stat for `id`, or `undefined` when none is cached (incl. never-attempted / pending). */
    get(id: TId): ChangeStat | undefined {
        const entry = this.cache.get(id);
        return entry?.state === 'ready' ? entry.stat : undefined;
    }

    /**
     * Empties the cache so all rows reload after a refresh or sync. Bumps
     * the global generation so results from every in-flight request are
     * rejected — none of them may repopulate the emptied cache. Queued and
     * in-flight markers are dropped too, so the next load pass re-requests
     * everything fresh instead of waiting behind stale work.
     */
    clear(): void {
        this.globalGeneration++;
        this.cache.clear();
        this.queued.clear();
        this.active.clear();
        // `physicalInFlight` is deliberately NOT zeroed: the abandoned calls
        // still occupy real loader/HTTP capacity until they settle.
    }

    /**
     * Drops one row's cached entry so only it reloads (a single file's
     * content changed). Also drops the row's queued/in-flight markers and
     * bumps its generation: the next load pass re-requests immediately, and
     * any still-running request for the OLD content cannot commit its stale
     * result over the fresh reload.
     */
    invalidate(id: TId): void {
        this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
        this.cache.delete(id);
        this.queued.delete(id);
        // Drop the row's active marker so a new-generation request can start
        // immediately. The abandoned physical call keeps counting in
        // `physicalInFlight` until it settles; its finally block can only
        // delete its OWN marker (token check), never the new request's.
        this.active.delete(id);
    }

    /**
     * Background-loads stats for the given visible rows. Every uncached/not-
     * in-flight item is queued (priority rows via {@link isPriority} first,
     * then the rest), run at most {@link DiffStatProvider.MAX_CONCURRENT} at
     * a time, and each `ready` result settles (batched per microtask) one
     * progressive re-render. `pending` results stay uncached and retry on
     * the next pass.
     */
    loadVisible(items: readonly TItem[]): void {
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
     * screen); pending is retried on a later call. A thrown loader error is
     * neither cached nor re-thrown (the caller is fire-and-forget too) — the
     * row simply stays retryable.
     */
    async lazyLoad(item: TItem): Promise<void> {
        if (!this.loadDiffStat || this.cache.has(item.id) || this.active.has(item.id)) return;
        const request: ActiveDiffStatRequest = {
            token: ++this.nextRequestToken,
            globalGeneration: this.globalGeneration,
            itemGeneration: this.generations.get(item.id) ?? 0,
        };
        this.active.set(item.id, request);
        this.physicalInFlight++;
        try {
            const result = await this.loadDiffStat(item);
            if (!this.isStale(item.id, request.globalGeneration, request.itemGeneration)) {
                this.commit(item.id, result);
            }
        } catch {
            // Transient failure: don't cache unavailable, allow later retry.
        } finally {
            this.finish(item.id, request);
        }
    }

    private pump(): void {
        while (this.physicalInFlight < DiffStatProvider.MAX_CONCURRENT && this.queued.size > 0) {
            const item = this.takeNext();
            if (!item) break;
            const request: ActiveDiffStatRequest = {
                token: ++this.nextRequestToken,
                globalGeneration: this.globalGeneration,
                itemGeneration: this.generations.get(item.id) ?? 0,
            };
            this.active.set(item.id, request);
            this.physicalInFlight++;
            void this.run(item, request);
        }
    }

    /** Dequeues the highest-priority item (cheap reads before remote fetches). */
    private takeNext(): TItem | undefined {
        for (const item of this.queued.values()) {
            if (this.isPriority(item)) {
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

    /** Background single-row load: same generation guard + error policy as `lazyLoad`. */
    private async run(item: TItem, request: ActiveDiffStatRequest): Promise<void> {
        try {
            const result = await this.loadDiffStat!(item);
            if (!this.isStale(item.id, request.globalGeneration, request.itemGeneration)) {
                this.commit(item.id, result);
            }
        } catch {
            // Transient failure: not a permanent unavailable. Leave the row
            // uncached so a later load pass retries it. Swallow here — the
            // caller (`pump`) is a fire-and-forget `void`, and an unhandled
            // rejection from a *background* stat must never surface as if
            // the sync pipeline had failed.
        } finally {
            this.finish(item.id, request);
        }
    }

    /**
     * Settles one request: removes ONLY its own active marker (a newer
     * request may own the row after an invalidate), releases its physical
     * slot, and wakes the queue.
     */
    private finish(id: TId, request: ActiveDiffStatRequest): void {
        if (this.active.get(id)?.token === request.token) {
            this.active.delete(id);
        }
        this.physicalInFlight--;
        this.pump();
    }

    private isStale(id: TId, globalGeneration: number, itemGeneration: number): boolean {
        return globalGeneration !== this.globalGeneration
            || itemGeneration !== (this.generations.get(id) ?? 0);
    }

    /** Commits a still-fresh load result to the cache. */
    private commit(id: TId, result: DiffStatLoadResult): void {
        if (result.status === 'ready') {
            this.cache.set(id, { state: 'ready', stat: result.stat });
            this.settleOnce();
        } else if (result.status === 'unavailable') {
            this.cache.set(id, { state: 'unavailable' });
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