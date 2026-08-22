import type { ChangeId } from '../../logic/source-control/types';
import type { SourceControlItem } from '../../logic/source-control/SourceControlViewModel';
import type { ChangeStat } from './ChangePresentation';

/**
 * Loads (load) and caches the +/- diff stat for change rows, isolated from
 * the view so cache + load + invalidate live in one place instead of being
 * scattered across `SourceControlView` render methods. The view owns no diff
 * cache of its own anymore — it asks this provider.
 *
 * Three load policies mirror the old view methods:
 * - {@link DiffStatProvider.eagerLocal} — cheap in-memory `local-only` reads,
 *   fired once per render for uncached rows.
 * - {@link DiffStatProvider.eagerSelected} — every kind in the Sync Queue (the
 *   working push batch is small and worth a remote round-trip).
 * - {@link DiffStatProvider.lazyLoad} — a single two-sided change on open.
 *
 * A `null` result (binary/missing content) is cached too, so an unavailable
 * stat isn't retried on every rerender. The injected `settle` callback
 * re-renders the view once an async batch lands; `lazyLoad` only settles when
 * it actually produced a stat (nothing to render otherwise).
 */
export class DiffStatProvider {
    /** Cached +/- diff stats per change id (`null` = attempted but unavailable). */
    private readonly cache = new Map<ChangeId, ChangeStat | null>();

    constructor(
        /**
         * Supplies the +/- stat for a change row. `local-only` is expected to
         * be a cheap in-memory read; other kinds may involve a remote fetch.
         * When omitted the provider is inert (the view renders without stats).
         */
        private readonly loadDiffStat: ((item: SourceControlItem) => Promise<ChangeStat | null>) | undefined,
        /** Re-renders the view after an async load settles so rows show their stat. */
        private readonly settle: () => void,
    ) {}

    /** Returns the cached stat for `id`, or `undefined` when none is cached (incl. never-attempted). */
    get(id: ChangeId): ChangeStat | undefined {
        return this.cache.get(id) ?? undefined;
    }

    /** Empties the cache so rows reload after a refresh or sync. */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Eagerly resolves stats for visible `local-only` rows: cheap in-memory
     * reads (no provider call), fired once per render for uncached items, then
     * settles a single re-render when the batch lands.
     */
    eagerLocal(items: readonly SourceControlItem[]): void {
        if (!this.loadDiffStat) return;
        const pending = items.filter(item => item.kind === 'local-only' && !this.cache.has(item.id));
        if (pending.length === 0) return;
        void Promise.all(pending.map(async item => {
            const stat = await this.loadDiffStat!(item);
            this.cache.set(item.id, stat ?? null);
        })).then(() => this.settle());
    }

    /**
     * Eagerly resolves stats for every change in the Sync Queue so the queue
     * previews `+3 -1` next to each row. Covers all kinds (two-sided changes
     * may involve a remote fetch), but the queue is the user's working push
     * batch — small and worth the round-trip.
     */
    eagerSelected(syncQueue: readonly SourceControlItem[]): void {
        if (!this.loadDiffStat) return;
        const pending = syncQueue.filter(item => !this.cache.has(item.id));
        if (pending.length === 0) return;
        void Promise.all(pending.map(async item => {
            const stat = await this.loadDiffStat!(item);
            this.cache.set(item.id, stat ?? null);
        })).then(() => this.settle());
    }

    /**
     * Lazily resolves the stat for a single two-sided change on open, caching
     * it so subsequent renders show the stat without a refetch. Settles only
     * when a stat was actually produced (a `null` result changes nothing on
     * screen).
     */
    async lazyLoad(item: SourceControlItem): Promise<void> {
        if (!this.loadDiffStat || this.cache.has(item.id)) return;
        const stat = await this.loadDiffStat(item);
        this.cache.set(item.id, stat ?? null);
        if (stat) this.settle();
    }
}