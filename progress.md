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

**Last Updated:** 2026-07-23
**Session ID:** current
**Active Feature:** None — push stale-HEAD fix committed on `claude/git-file-sync-push-errors-9ffa82`.

## Status

### What's Done

- [x] feat-001..013 — see [archive/2026-07.md](./archive/2026-07.md)
- [x] feat-014: GitHub's `pushBatch`/`deleteBatch` now use GraphQL `createCommitOnBranch` instead of the REST blob-per-file loop (commit `114a575`).
- [x] feat-015: fixed a false "modified" status right after batch push, caused by GitHub's tree-by-branch-name read lagging a just-completed write. `pushAllFiles` now returns `syncedPaths`; `SyncStatusView` marks those files synced directly instead of re-fetching the remote tree (commit `7676325`).
  - Both committed onto `claude/fix-directory-symlink-pull-260713`, **not yet pushed to remote**.
  - Evidence: `npx eslint .` → 0 errors; `npm run build` → clean; `npx vitest run` → 344/344 passed.
- [x] Push failures reported as `GitHub GraphQL error: Expected branch to point to "<oid>" but it did not. Pull and try again.` (whole chunk failed, twice in a row, same oid). Two causes: the stale-HEAD retry pattern in `github-service.ts` never matched that wording, so no retry fired; and `expectedHeadOid` came from the REST `git/ref` read, which GitHub serves `private, max-age=60`, so retries would have resent the same cached oid anyway. `commitOnBranch` now reads the head over GraphQL, the pattern covers GitHub's real wording, exhaustion gives a branch-named message, and the REST read sends `Cache-Control: no-cache`. On `claude/git-file-sync-push-errors-9ffa82`, no PR opened yet.
  - Evidence: `npx eslint .` → 0 errors; `npm run build` → clean (incl. Obsidian 1.11.0 compat); `npx vitest run` → 351/351 passed.
- [x] Console flooded with `Git Service 404 (not found)` before every push (separate from the fix above, pre-existing). Two sources, both probing paths already known to be absent from the pre-fetched remote tree: `SyncStatusView.refreshFileStatus` fell back to `getFile` for any file with no tree entry (a guaranteed 404 per not-yet-pushed file, every refresh), and `SyncManager.detectRename` probed every orphaned `syncMetadata` path once per file in the batch. Both now answer from the tree; the `getFile` fallback is kept only for tree entries that carry no sha.
  - Evidence: `npx eslint .` → 0 errors; `npm run build` → clean; `npx vitest run` → 354/354 passed.

### What's In Progress

- Nothing actively in progress.

### What's Next

1. Push `claude/fix-directory-symlink-pull-260713` to update PR #51 — confirm with the user first.
2. Manually verify feat-014/feat-015 inside the actual Obsidian plugin UI (this session's verification used a live GitHub API smoke test driving `GitHubService` directly, not the full plugin).
3. Filed issue #57 (repo `git-files-sync`, Project #6, P2, 4h estimate): build a repeatable live-credential smoke test process across GitHub/GitLab/Gitea, not just GitHub — https://github.com/firstsun-dev/git-files-sync/issues/57
4. Re-sync against `gh issue list --repo firstsun-dev/git-files-sync --state open` — `feature_list.json`'s backlog is a snapshot from an earlier session.
5. Issue #37 (Bitbucket provider support, feat-010): unblocked, still not started.
6. PR #51 is large (10+ issues' worth of changes now). Flag to the user before piling on more commits.

## Blockers / Risks

- None currently.

## Decisions Made

- **All work goes into one PR (#51)**: user explicitly said "不要那麼多pr merge" (don't want so many PRs). Commit new work directly onto `claude/fix-directory-symlink-pull-260713`.
- **Optimistic local status update over a post-push re-fetch (feat-015)**: rather than delaying the refresh or retrying, mark just-pushed files synced from data already in hand. Correct by construction (it's the exact content just written) and sidesteps GitHub's eventual-consistency window entirely instead of just narrowing it.
- **Credential handling for live smoke tests**: write PATs to a local scratchpad file the agent reads directly — never as a `!`-prefixed command (still lands in the transcript) or a Bash argument (blocked by the permission classifier). Filed as issue #57 to build a proper reusable process across all three providers.

## Files Modified This Session

- `src/services/github-service.ts`, `src/services/git-service-base.ts`, `tests/services/github-service.test.ts` (feat-014)
- `src/logic/sync-manager.ts`, `src/ui/SyncStatusView.ts`, `tests/logic/sync-manager-batch.test.ts`, `tests/ui/SyncStatusView.test.ts` (feat-015)

## Evidence of Completion

- [x] Tests pass: `npx vitest run` → 344/344 passed
- [x] Type check clean: `npm run build` → clean
- [x] Lint clean: `npx eslint .` → 0 errors
- [x] Live smoke tests against a real GitHub repo (feat-014 push/delete, feat-015 empty-file diagnosis)
- [ ] Manual verification inside the actual Obsidian plugin UI — not yet done
- [ ] Pushed to remote — not yet done, needs confirmation

## Notes for Next Session

- Working branch: `claude/fix-directory-symlink-pull-260713` (PR #51). Commits `114a575` and `7676325` are local only — push before starting new work, or confirm with the user.
