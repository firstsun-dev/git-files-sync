# Session Handoff

**Date:** 2026-08-30
**Branch / PR:** `claude/source-control-foundation` / PR #129
**Latest commits (all pushed):** `acd2046` fix(ci): serialize branch validation workflows → `78a78e8` fix(source-control): track diff stat requests by generation token → `49f3033` fix(sync-status): preserve refreshed state across live modifications → `fbe0787` fix(source-control): correct one-sided diff stat direction

## Completed (this round)

Final 4-fix round from the merge-gate review (no scope expansion):

1. **CI whole-run concurrency** — `concurrency:` moved to workflow level in `.github/workflows/ci.yml`: group `ci-<head_ref|ref_name>` for push/pull_request (one whole CI DAG per branch survives; the split per-provider winners race is gone), `format('{0}-{1}', event_name, run_id)` for workflow_dispatch/schedule so manual/scheduled runs never cancel (or get cancelled by) branch CI. Per-job `concurrency:` blocks on `provider-e2e` and `gitea-e2e` removed. Contract tests updated + added in `tests/ci-workflow.test.ts`: independent dispatch/schedule identity, workflow-level serialization (no `group: e2e-` left, `ci-` group present), dispatch/schedule never cancel branch CI.
2. **DiffStatProvider request tokens** — `active` changed from `Set<ChangeId>` to `Map<ChangeId, ActiveDiffStatRequest>` (`token` from a monotonic counter + the two generation values). A request's finally deletes only its own marker (`active.get(id)?.token === request.token`). New `physicalInFlight` counter (incremented on dispatch, decremented in `finish`) gates the MAX_CONCURRENT=4 pump — never `active.size`; `invalidate`/`clear` may drop the row's marker immediately but abandoned physical calls still count until they settle. Regressions added: old-finally-cannot-clear-newer-marker, stale+current-in-flight-no-duplicate, rapid-invalidate burst peak ≤ 4.
3. **SyncStatusRefreshService modify vs full refresh** — `handleFileModified` no longer writes back its pre-await `existing` snapshot. Two-phase: bump revision, read content, bail if revision superseded; then re-read `this.statuses.get(path)` and bail if the row is gone or `file` changed; classification uses `current` (including `current.remoteSha`); final write spreads `{ ...current, status, localContent }`. Full-refresh state (remoteSha A→B, remoteContent, isSymlink, movedFrom) now survives a pending modify read; a delete during pending read stays `local-deleted` without content; a rename-away old path is not written back. Tests +3.
4. **One-sided diff stat direction** — the pane's FileDiff sides (local='' for ↓/D) are download-oriented and must not define the row stat. `ChangePresentation` gains `addedContentStat(content)` (+N) and `deletedContentStat(content)` (−N); `SourceControlItemView.loadDiffStat` routes `remote-only` → additions(remote content), `local-deleted` → deletions(remote content), everything else keeps `computeDiffStat`. `SyncDiffService` doc updated to note DTO-vs-stat semantics split. Tests assert the RENDERED stat: remote-only 2 lines → `+2`, local-deleted 2 lines → `−2` (plus helper unit tests).

## Verification

- `npx eslint .` — 0 errors (full repo, after all 4 commits)
- `npx vitest run` — 66 files / 804 tests passed
- `npm run build` (+ Obsidian 1.11 compat typecheck) — passed via husky pre-commit on each of the 4 commits
- **CI (whole-run concurrency verified in production):** push `9eb3713..17d241c`. For head `17d241c`, push run `33274606265` was cancelled by the new workflow-level group and pull_request run `33274607880` survived with ALL nine groups green: Lint ✅ Build ✅ Unit 22 ✅ Unit 24 ✅ GitHub E2E ✅ GitLab E2E ✅ Gitea E2E ✅ Required Checks ✅ Package ✅ (Publish skipped: non-main). One whole DAG per branch — no split winners.

## Next Step (final merge gate)

1. ~~Watch CI for `fbe0787`~~ DONE: pull_request run `33274607880` @ `17d241c` is the whole-run winner (the push run cancelled as designed); ALL groups green — Lint, Build, Unit 22, Unit 24, GitHub E2E, GitLab E2E, Gitea E2E, Required Checks, Package. The split-winner defect is fixed and verified in production.
2. `npm run deploy` a fresh build, then run the iPad manual matrix from the review's merge gate (80+ row scroll stability, M-diff Back restore, Back+scroll no re-anchor, A +N on content arrival, M auto +N/−N, rapid edit latest-wins, remote-only +N, local delete −N, collapsed sections do zero background stat fetches).
3. Final merge-ready review of PR #129 → merge.