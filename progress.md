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
**Active Feature:** None — feat-021/feat-022 (issues #66, #67) are committed on `claude/rename-as-move-66-67`, not yet pushed/PR'd.

## Status

### What's Done

- [x] feat-001..020, plus the perf/push-error follow-ups and PR #71 — see [archive/2026-07.md](./archive/2026-07.md).
- [x] feat-021 (issue [#66](https://github.com/firstsun-dev/git-files-sync/issues/66)): renames commit as a real move (add + delete, one commit) instead of leaving a duplicate on the remote. Commit `aeb1ad0`.
- [x] feat-022 (issue [#67](https://github.com/firstsun-dev/git-files-sync/issues/67)): a fully-moved folder collapses into one sync-panel row instead of one per file. Commit `1ba1293`.
- Evidence for both: `npx eslint .` → 0 errors; `npm run build` → clean (incl. Obsidian 1.11.0 compat typecheck); `npx vitest run` → 430/430 passed.

### What's In Progress

- Nothing actively in progress.

### What's Next

1. Push `claude/rename-as-move-66-67` and open a PR against `main`.
2. Manual verification of feat-021/022 inside the actual Obsidian plugin UI — evidence so far is lint/build/unit tests only. Worth checking specifically: renaming a synced note (single commit, old path gone from remote), dragging a multi-file folder (collapsed row, single commit on push), and the Revert action on both a single moved row and a collapsed group.
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
