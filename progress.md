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
**Active Feature:** None — draft [PR #79](https://github.com/firstsun-dev/git-files-sync/pull/79) (`prepare-1.5.0` → `main`, #63/#66/#67 + the delete-race fix) and draft [PR #80](https://github.com/firstsun-dev/git-files-sync/pull/80) (`sync-status-live-update` → `prepare-1.5.0`, the live-status-on-edit/move feature below) are both open, neither merged yet.

## Status

### What's Done

- [x] feat-001..020, plus the perf/push-error follow-ups and PR #71 — see [archive/2026-07.md](./archive/2026-07.md).
- [x] feat-021 (issue [#66](https://github.com/firstsun-dev/git-files-sync/issues/66)) and feat-022 (issue [#67](https://github.com/firstsun-dev/git-files-sync/issues/67)) — merged to `prepare-1.5.0`.
- [x] `fix(sync): track a moved folder's files, not just moved files` — `ee217b1`, merged to `prepare-1.5.0`. Obsidian fires one `rename` event for a moved *folder* (not one per file); the handler only matched `TFile`, so dragging a whole folder tracked nothing.
- [x] `fix(sync): detect a folder move even when the plugin missed the live rename event` — `c806e22`, merged to `prepare-1.5.0`. Added `SyncStatusView.reconcileOutOfBandMoves()`, pairing an orphaned `remote-only` row with an `unsynced` row sharing the same git blob sha, for moves that happened while the plugin's `rename` listener wasn't observing (Obsidian closed, moved externally, or before load).
- [x] `fix(sync): stop clearing rename metadata on generic vault delete events` — `c9d0cde`, pushed to `prepare-1.5.0`, now in draft PR #79. Found and fixed the reason `c806e22`'s reconciler could still fail silently: `main.ts`'s generic `vault.on('delete', ...)` handler called `clearMetadata(path)` for *every* delete Obsidian reported, racing ahead of `reconcileOutOfBandMoves` and destroying the exact metadata it needs when an out-of-band move reaches Obsidian's watcher as a bare delete with no correlated rename. Confirmed with a failing-first test before the fix; the eager clear is now removed entirely (no longer needed for performance either, since `detectRename` reads an already-fetched tree).
- [x] **This session** — new feature (not tied to an existing issue), draft [PR #80](https://github.com/firstsun-dev/git-files-sync/pull/80) against `prepare-1.5.0`: the sync panel updates a row live instead of staying stale until the next manual refresh, in two cases:
  - **Edit**: `main.ts` registers `vault.on('modify', ...)`, gated by the existing `filterPathByVaultFolder` scope check (the "target folder"), forwarding to `SyncStatusView.handleFileModified(file)`. Re-derives `'synced'`/`'modified'` from a local git-blob-hash comparison against the `remoteSha` already cached on that row — no network call.
  - **Rename/move** (added after the user reported moving files/folders didn't update the panel either): `main.ts`'s existing `vault.on('rename', ...)` handler now also calls a new `SyncStatusView.handleFileRenamed(file, oldPath)` once `SyncManager.trackRename` (or, per file, `trackFolderRename`) has updated `syncMetadata` — reads that already-settled state (a `renamedFrom` if one was just recorded) to move the row to the new path as `'moved'`, or carry an unsynced/never-synced row over as-is. Also drops the row if the new path fell outside the configured vault folder. A shared `notifySyncStatusViews()` helper replaced the duplicated leaf-iteration code in both listeners.
  - Both leave `'moved'` rows alone on edit (an edit doesn't undo a pending move) and skip any path mid-`'checking'` (an in-flight refresh will settle it) or not currently tracked (discovering new files needs the remote tree, out of scope for a per-event hook).
  - Evidence: `npx eslint .` → 0 errors; `npm run build` → clean (incl. Obsidian 1.11.0 compat typecheck); `npx vitest run` → 460/460 passed (451 `prepare-1.5.0` baseline + 9 new tests: 4 for `handleFileModified`, 5 for `handleFileRenamed`, plus one assertion added to the existing `trackFolderRename` test).
  - On branch `sync-status-live-update`, based on `prepare-1.5.0` per explicit user request (not `main` — keeps this in the same release train as #63/#66/#67 instead of a second parallel PR against `main`).

### What's In Progress

- `sync-status-live-update` (PR #80) is gate-clean; the rename/move follow-up commit above still needs to be pushed (was committed and verified but not yet pushed at end of session).

### What's Next

1. Push the rename/move follow-up commit on `sync-status-live-update` (PR #80 will update automatically).
2. Get [PR #79](https://github.com/firstsun-dev/git-files-sync/pull/79) (`prepare-1.5.0` → `main`) merged, then [PR #80](https://github.com/firstsun-dev/git-files-sync/pull/80) — #80 is based on #79's branch, so it should follow, not race, #79.
3. Manual verification inside the actual Obsidian plugin is still outstanding for all of feat-021/022, both rounds of the folder-move bug fix, and this session's live-update feature — there is no headless way to confirm Obsidian's real event ordering/timing (in-app drag vs. external-tool move, how promptly `'modify'` fires) matches what's assumed here; flagged in both PR descriptions.
4. Issue #57 (live-credential smoke test before merging push/pull/delete changes) is open and directly relevant to this batch of changes — worth considering before merging.
5. feat-004: SonarQube findings review (issue #45) — not started.
6. feat-010: Bitbucket support (issue #37) — not started, depends on feat-009 (done).
7. Re-sync against `gh issue list --repo firstsun-dev/git-files-sync --state open`.

## Blockers / Risks

- None currently.

## Decisions Made

- **A rename's old path is tracked live, not reconstructed later**: `main.ts` listens for the vault's own `'rename'` event and hands the exact old path to `SyncManager.trackRename`, instead of `detectRename`'s previous content/tree-comparison scan. That scan still exists as a fallback for renames the plugin missed, gated to run only when an orphaned metadata entry actually exists.
- **No vault `'delete'` listener clears `syncMetadata` anymore** (this session): the old rationale (keep `detectRename`'s orphan scan cheap) no longer holds now that scan reads an already-fetched tree instead of probing live. Clearing eagerly actively broke out-of-band move detection, so intentional deletes clear their own metadata at the point of that intentional action instead.
- **Two safety checks around deleting the old path, not one**: a target path that already exists on the remote is never silently overwritten (the move is left pending for the user to resolve), and an old path whose remote content has moved on since the last sync is never silently deleted.
- **The folder-move grouping key is the topmost point where paths diverge, not the file's immediate parent directory**: matching path segments from the end handles arbitrary nesting depth in one pass, and a file whose own name also changed naturally gets a prefix pair unique to itself.
- **Collapsed-group children get no checkboxes**: pushing a group always pushes every member; the group row's own checkbox is the only way to include/exclude the whole thing from a bulk action.

## Files Modified This Session

- `src/main.ts` — removed the vault `'delete'` handler's eager `clearMetadata` call
- `tests/ui/SyncStatusView.test.ts` — new regression test for the out-of-band move hazard

## Evidence of Completion

- [x] Lint clean: `npx eslint .` → 0 errors
- [x] Type check clean: `npm run build` → clean (includes the Obsidian 1.11.0 compat typecheck)
- [x] Tests pass: `npx vitest run` → 451/451 passed
- [ ] Manual verification inside the actual Obsidian plugin UI — not yet done (see "What's Next" #2)

## Notes for Next Session

- `GitServiceInterface.commitBatch` is deliberately separate from `pushBatch`/`deleteBatch`: it takes `(additions, moves, branch, message)` and covers only the cases sync-manager actually needs it for (a push-all mixing edits and moves, and a single-file move).
- `SyncManager.trackRename` always records `renamedFrom` as the still-*unpushed* remote path, not the most recent rename hop — that's what makes a chained rename (A→B→C) collapse to a single A→C move, and what makes renaming back to that exact path (B→A) cancel the pending move entirely.
- If a future session sees another "move not detected" report, check `main.ts`'s vault event handlers first for anything that might clear `syncMetadata` before `reconcileOutOfBandMoves` or `trackRename` gets to read it — that class of bug is exactly what this session found once already.
