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

**Last Updated:** 2026-07-24
**Session ID:** current
**Active Feature:** None — feat-023 (issue #63, sync plan preview) merged to `prepare-1.5.0` via PR #78. A follow-up fix for out-of-band move detection is committed locally on `local-prepare-1.5.0`, about to be pushed.

## Status

### What's Done

- [x] feat-001..020, plus the perf/push-error follow-ups and PR #71 — see [archive/2026-07.md](./archive/2026-07.md).
- [x] feat-021 (issue [#66](https://github.com/firstsun-dev/git-files-sync/issues/66)) and feat-022 (issue [#67](https://github.com/firstsun-dev/git-files-sync/issues/67)) — merged to `prepare-1.5.0`.
- [x] `fix(sync): track a moved folder's files, not just moved files` — `ee217b1`, merged to `prepare-1.5.0`. Obsidian fires one `rename` event for a moved *folder* (not one per file); the handler only matched `TFile`, so dragging a whole folder tracked nothing.
- [x] **New this session** — user reported the folder-move status still didn't show up after rebuilding with `ee217b1` and reinstalling into their vault. Root cause is a level deeper: the sync panel's status refresh only recognizes a move via the live-tracked `renamedFrom` metadata field set by the vault's `rename` event handler — it has no fallback for a move that happens while the plugin isn't observing that event (Obsidian closed, moved via OS/another device, or the move happened before the plugin finished loading). Such a move showed as a `remote-only` ghost (old path) plus an `unsynced` new file (new path), never `moved`.
  - Reproduced first with a failing test (`SyncStatusView move detection without a live rename event`), confirmed it failed only on the intended assertion, all 434 other tests still green.
  - Fix: `SyncStatusView.reconcileOutOfBandMoves()`, run once after `performStatusCheck` in `refreshAllStatuses`. Pairs a `remote-only` row that still carries synced metadata at that exact path with an `unsynced` row (no remote entry of its own) sharing the same git blob sha — no extra network calls, reuses the tree sha and local content already fetched for classification. Only pairs 1:1 unambiguous matches (a duplicated boilerplate file at multiple paths is left alone); confirmed matches call the existing `SyncManager.trackRename` so the result is indistinguishable from a live-tracked move (same push/revert/folder-grouping behavior).
  - Evidence: `npx eslint .` → 0 errors; `npm run build` → clean (incl. Obsidian 1.11.0 compat typecheck); `npx vitest run` → 435/435 passed.

### What's In Progress

- Above fix is committed locally, rebased onto `prepare-1.5.0` (which now also has feat-023/PR #78), about to be pushed.

### What's Next

1. Push the out-of-band move detection fix to `prepare-1.5.0`.
2. Manual verification of the folder-move fixes inside the actual Obsidian plugin UI is still outstanding for feat-021/022 and both rounds of the folder-move bug fix.
3. feat-004: SonarQube findings review (issue #45) — not started.
4. feat-010: Bitbucket support (issue #37) — not started, depends on feat-009 (done).
5. Re-sync against `gh issue list --repo firstsun-dev/git-files-sync --state open`.

## Blockers / Risks

- None currently.

## Decisions Made

- **A rename's old path is tracked live, not reconstructed later**: `main.ts` now listens for the vault's own `'rename'` event and hands the exact old path to `SyncManager.trackRename`, instead of `detectRename`'s previous content/tree-comparison scan. That scan still exists as a fallback for renames the plugin missed (e.g. it was disabled), gated to run only when an orphaned metadata entry actually exists.
- **Two safety checks around deleting the old path, not one**: a target path that already exists on the remote is never silently overwritten (the move is left pending for the user to resolve), and an old path whose remote content has moved on since the last sync is never silently deleted (the new content still gets pushed either way, since nothing local is at risk).
- **The folder-move grouping key is the topmost point where paths diverge, not the file's immediate parent directory**: matching path segments from the end handles arbitrary nesting depth in one pass — every file under a moved folder groups together regardless of how deep it sits — and a file whose own name also changed (not just its folder) naturally gets a prefix pair unique to itself, so it never merges into a group without extra logic for that case.
- **Collapsed-group children get no checkboxes**: "move half a folder" isn't a thing that row means: pushing it always pushes every member, and the row's own checkbox (which toggles every member's selection together) is the only way to include/exclude the whole group from a bulk action.

## Files Modified This Session

- `src/settings.ts` — `SyncMetadata.renamedFrom`
- `src/ui/types.ts` — `FileStatus` status `'moved'` + `movedFrom`; `FilterValue` `'moved'`
- `src/main.ts` — vault `'rename'` event registration
- `src/logic/sync-manager.ts` — `trackRename`, real-move `handleRename`/`commitMove`, batch `toMove` queue + `commitPushBatch`/`commitCombinedChunk`
- `src/services/git-service-interface.ts`, `github-service.ts`, `gitlab-service.ts`, `gitea-service.ts` — new optional `commitBatch`
- `src/ui/SyncStatusView.ts`, `src/ui/components/FileListItem.ts`, `src/ui/components/icons.ts`, `styles.css` — moved row/tab/revert, folder-move grouping and collapsed row
- `src/i18n/locales/{en,zh-tw,zh-cn}.ts` — new keys
- `tests/logic/sync-manager.test.ts`, `sync-manager-batch.test.ts`, `tests/services/{github,gitlab,gitea}-service.test.ts`, `tests/ui/{FileListItem,SyncStatusView}.test.ts` — updated + new coverage

## Evidence of Completion

- [x] Lint clean: `npx eslint .` → 0 errors
- [x] Type check clean: `npm run build` → clean (includes the Obsidian 1.11.0 compat typecheck)
- [x] Tests pass: `npx vitest run` → 430/430 passed (412 at the session's green baseline)
- [ ] Manual verification inside the actual Obsidian plugin UI — not yet done

## Notes for Next Session

- Working branch: `claude/rename-as-move-66-67` (worktree), not yet pushed.
- `GitServiceInterface.commitBatch` is deliberately separate from `pushBatch`/`deleteBatch` rather than a refactor of them: it takes `(additions, moves, branch, message)` and covers only the cases sync-manager actually needs it for (a push-all mixing edits and moves, and a single-file move). Existing `pushBatch`/`deleteBatch` call sites are untouched.
- `SyncManager.trackRename` always records `renamedFrom` as the still-*unpushed* remote path, not the most recent rename hop — that's what makes a chained rename (A→B→C) collapse to a single A→C move, and what makes renaming back to that exact path (B→A) cancel the pending move entirely (see the "moves the metadata entry" / "collapses a chained rename" / "cancels the pending move" tests in `sync-manager.test.ts`).
