# Session Handoff

**Date:** 2026-08-30
**Branch / PR:** `claude/source-control-foundation` / PR #129
**Latest commits:** `05f6628 fix(source-control): harden scroll, diff-stat and create lifecycles`, `af376f2 chore(source-control): finish legacy sync-status presentation cleanup` (both pushed)
**Build:** deployed to `~/Obsidian/MyPKM` via `npm run deploy` (2026-08-30 04:33)

## Completed (this round)

Fix-all plan from the review (no more piecemeal patches):

1. **Mobile scroll lifecycle** — navigation restore (`mainScrollState` + `navigationAnchorId`) now runs ONLY on the Back transition via `restoreNavigationScrollOnNextRender`; regular rerenders (checkbox/diff-stat/status) use the captured-DOM path and never re-anchor.
2. **DiffStatProvider stale async writes** — two-level generation guard (globalGeneration + per-row generations). `invalidate()`/`clear()` evict queued AND in-flight markers, bump generations; stale responses are denied the cache write (not aborted). Loader rejections = retryable, never cached `unavailable`, never unhandled rejections.
3. **Invalidation fingerprint** — `DiffStatFingerprint` (status/localContent/remoteContent/remoteSha/movedFrom/isSymlink) in SourceControlItemView; stale-path snapshots removed when republish drops rows.
4. **handleFileCreated resilient two-step** — publish A immediately (no content, pending stat) → async read → republish under per-path `contentRevisions` guard (create read cannot clobber raced modify; read failure leaves row visible/retryable).
5. **loadVisible scoped to rendered rows** — collapsed Repository Changes AND collapsed queue (desktop `checkedChanges`, mobile `mobileQueueExpanded`) fire zero stat requests.
6. **One-sided diff semantics in SyncDiffService** — local-only ⇒ remote `''`; remote-only/local-deleted ⇒ local `''`; computeDiffStat turns `''→content` into +N. Plus in-flight remote-blob memoization keyed `remoteSha:path`.
7. **Error policy** — background `run()`/`lazyLoad()` catch loader throws: not cached, retryable, no unhandled rejection.
8. **Tests** — +18 lifecycle regression tests (stale-result, clear-in-flight, out-of-order settle, rejection retry, mobile scroll matrix, one-sided stats, dedup, raced-create guard).
9. **Legacy cleanup** — audit confirmed `src/ui/sync-status/*` + `SyncStatusView` already deleted. Removed 81 dead i18n keys per locale; reworded ribbon/command/view-title to "Source Control" (kept `open-sync-status` command ID + `sync-status-view` type); ESLint `no-restricted-imports` guard vs `ui/sync-status`; renamed `SyncStatusView.revertMove.test.ts` → `VaultPath.test.ts` (never tested the legacy view); stale SyncStatusView comments cleaned; coverage now includes `src/ui/source-control/**` (~90% lines) with thresholds 70/70/70/60. CSS audit: all `.ssv-diff-*` is shared DiffPanel CSS (kept); zero orphan legacy CSS.

## Verification

- `npx eslint .` — 0 errors (incl. new restricted-imports guard)
- `npm run build` — passed incl. Obsidian 1.11 compat
- `npx vitest run` — 66 files / 788 tests passed
- `npx vitest run --coverage` — statements 84.02% / branches 75.57% / functions 81.61% / lines 86.11% (above thresholds)
- Local provider E2E impossible (no E2E_* credentials locally; they live in GitHub secrets) — CI runs: push `33273745179`, pull_request `33273746958` (in progress at handoff)

## Next Step

1. Check CI run `33273746958` (pull_request, sha af376f2) — must be all green (Lint, Build, Unit 22/24, E2E github/gitea/gitlab, Required Checks, Package).
2. Manual iPad regression on the deployed build — full list in Fix-all plan item 10: 80+ rows scroll/diff/Back, background +/- progressive without jumping, A immediate + +N when content ready, M +N/−N auto-update, rapid consecutive edits → latest stat wins, local delete → −N, remote-only → +N, collapse Repository Changes → no background diff downloads.
3. After CI + manual PASS → review → merge PR #129.