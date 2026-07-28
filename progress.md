# Session Progress Log

<!--
  CLEANUP CADENCE: this file tracks only what's still open. When a feature
  finishes, move its narrative to archive/YYYY-MM.md (current month) as a
  one-line entry (name + commit hash) and remove it from here. Archive once
  this file passes ~80 lines — "What's Done" is a snapshot, not a permanent
  changelog.
-->

Completed work is archived in [archive/](./archive/), one file per calendar month — this file only tracks what's still open.

## Current State

**Last Updated:** 2026-07-28
**Session ID:** current
**Active Feature:** None — draft [PR #79](https://github.com/firstsun-dev/git-files-sync/pull/79) (`prepare-1.5.0` → `main`, includes #63/#66/#67/#78, the delete-race fix, and the live-status feature from ex-PR #80) is open, not yet merged.

## Status

### What's Done

- [x] feat-001..022, the perf/push-error follow-ups, PR #71, and the folder-move / out-of-band-move / delete-race fixes — see [archive/2026-07.md](./archive/2026-07.md).
- [x] **This session** — user reported that even after installing a `prepare-1.5.0` CI build with all the above fixes, moving an already-"synced" file/folder inside Obsidian still showed as a stray `remote-only` + `unsynced` pair instead of `'moved'`. Root cause confirmed with the user (file had never been pushed/pulled through the plugin): `SyncStatusView.refreshFileStatusBySha`/`refreshFileStatusByContent` classify a row `'synced'` purely from a local-vs-remote content/sha comparison, but never wrote that into `settings.syncMetadata` — `updateMetadata` was called from zero places in `SyncStatusView.ts`, only from actual push/pull code in `sync-manager.ts`. `SyncManager.trackRename` and `reconcileOutOfBandMoves` both silently no-op when no metadata exists at a path, so any file that reached `'synced'` by coincidental content match (cloned in, never explicitly synced by the plugin) could never have its move tracked, regardless of the fixes already on `prepare-1.5.0`.
  - Fix: both classification paths now call `sync.updateMetadata(path, sha)` when they land on `'synced'`, so the plugin's own record of "this path is synced at this sha" matches what the panel displays, and a later rename/move finds the metadata it needs.
  - New tests: `refreshFileStatusBySha` and `refreshFileStatusByContent` each backfill `syncMetadata` on a synced classification, plus an end-to-end test that a rename right after such a classification is tracked as `'moved'`.
  - Evidence: `npx eslint .` → 0 errors; `npm run build` → clean (incl. Obsidian 1.11.0 compat typecheck); `npx vitest run` → 463/463 passed (460 baseline + 3 new).
  - On branch `claude/backfill-sync-metadata-on-match`, based on `prepare-1.5.0` (same release train as PR #79).

### What's In Progress

- `claude/backfill-sync-metadata-on-match` is gate-clean, committed; PR not yet opened.

### What's Next

1. Open a PR from `claude/backfill-sync-metadata-on-match` into `prepare-1.5.0`.
2. Get [PR #79](https://github.com/firstsun-dev/git-files-sync/pull/79) (`prepare-1.5.0` → `main`) merged.
3. Manual verification inside the actual Obsidian plugin is still outstanding for all of the move-detection work this month — no headless way to confirm Obsidian's real event ordering/timing matches what's assumed here.
4. Issue #57 (live-credential smoke test before merging push/pull/delete changes) is open and directly relevant.
5. feat-004: SonarQube findings review (issue #45) — not started.
6. feat-010: Bitbucket support (issue #37) — not started, depends on feat-009 (done).
7. Re-sync against `gh issue list --repo firstsun-dev/git-files-sync --state open`.

## Blockers / Risks

- None currently.

## Decisions Made

- **A `'synced'` classification must write `syncMetadata`, not just display it**: the panel's read-only status refresh (`refreshFileStatusBySha`/`refreshFileStatusByContent`) is the plugin's own ground truth for "is this path considered synced" via `SyncManager.trackRename`/`reconcileOutOfBandMoves`. Letting the UI show `'synced'` without persisting that reading created a class of file (content matches remote, but never pushed/pulled through the plugin) whose moves could never be tracked.
- (Carried from last session) A rename's old path is tracked live via the vault's own `'rename'` event, not reconstructed later; `detectRename`'s scan remains a fallback gated to orphaned metadata only.
- (Carried from last session) No vault `'delete'` listener clears `syncMetadata` anymore — that eager clear broke out-of-band move detection; intentional deletes clear their own metadata at the point of that action instead.

## Files Modified This Session

- `src/ui/SyncStatusView.ts` — `refreshFileStatusBySha`/`refreshFileStatusByContent` now call `sync.updateMetadata` on a `'synced'` classification
- `tests/ui/SyncStatusView.test.ts` — 3 new regression tests, plus an `updateMetadata` mock added to `makePlugin`'s `sync` stub

## Notes for Next Session

- `SyncManager.trackRename` always records `renamedFrom` as the still-*unpushed* remote path, not the most recent rename hop — that's what makes a chained rename (A→B→C) collapse to a single A→C move, and what makes renaming back to that exact path (B→A) cancel the pending move entirely.
- If a future session sees another "move not detected" report: check both (a) whether `syncMetadata` actually has an entry at the old path (this session's bug — a `'synced'` row with no metadata), and (b) `main.ts`'s vault event handlers for anything that might clear `syncMetadata` before `reconcileOutOfBandMoves`/`trackRename` gets to read it (last session's bug).
