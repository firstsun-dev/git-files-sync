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
**Active Feature:** None — this branch's push/perf fixes are merged with main and awaiting PR #72.

## Status

### What's Done

- [x] feat-001..015 — see [archive/2026-07.md](./archive/2026-07.md). 1.3.0 shipped 2026-07-14 (`chore(release): 1.3.0`).
- [x] Two push-speed perf commits landed on `codex/perf-github-push-260723` prior to this session: `0445b17` (eliminate redundant GitHub requests) and `f8a0a26` (avoid stale rename lookup requests). Both `perf(push)` scope — patch-level under `.releaserc.json`'s commit-analyzer rules, so the next automated release will be 1.3.1.
- [x] feat-064 (issue [#64](https://github.com/firstsun-dev/git-files-sync/issues/64)): "what's new" entry text moved out of hard-coded English strings. `ChangelogEntry.text` is now `{ en, 'zh-tw'?, 'zh-cn'? }`; `entryText()` in `src/changelog/index.ts` picks the active locale at render time, falling back to `en`. `WhatsNewModal` and the settings banner both call it instead of reading `entry.text` directly.
- [x] Changelog content reorganized from a single growing `src/changelog.ts` into per-version folders (`src/changelog/1.2.1/`, `1.3.0/`, `1.3.1/`) — user explicitly asked for this instead of piling more keys into the shared `src/i18n/locales/*.ts` catalog, which would grow unbounded release over release.
- [x] Added a `1.3.1` release entry (notable, i18n'd in en/zh-tw/zh-cn) summarizing the push-speed work, so the "what's new" modal covers it once semantic-release cuts 1.3.1.
- Evidence: `npx eslint .` → 0 errors; `npm run build` → clean (includes Obsidian 1.11.0 compat check); `npx vitest run` → 351/351 passed. (Ran `npm install` first — `node_modules` was empty at session start in this worktree.)
- [x] Push failures reported as `GitHub GraphQL error: Expected branch to point to "<oid>" but it did not. Pull and try again.` (whole chunk failed, twice in a row, same oid). Two causes: the stale-HEAD retry pattern in `github-service.ts` never matched that wording, so no retry fired; and `expectedHeadOid` came from the REST `git/ref` read, which GitHub serves `private, max-age=60`, so retries would have resent the same cached oid anyway. `commitOnBranch` now reads the head over GraphQL, the pattern covers GitHub's real wording, exhaustion gives a branch-named message, and the REST read sends `Cache-Control: no-cache`. On `claude/git-file-sync-push-errors-9ffa82` (PR #72).
  - Evidence: `npx eslint .` → 0 errors; `npm run build` → clean (incl. Obsidian 1.11.0 compat); `npx vitest run` → 351/351 passed.
- [x] Console flooded with `Git Service 404 (not found)` before every push (separate from the fix above, pre-existing). Two sources, both probing paths already known to be absent from the pre-fetched remote tree: `SyncStatusView.refreshFileStatus` fell back to `getFile` for any file with no tree entry (a guaranteed 404 per not-yet-pushed file, every refresh), and `SyncManager.detectRename` probed every orphaned `syncMetadata` path once per file in the batch. Both now answer from the tree; the `getFile` fallback is kept only for tree entries that carry no sha.
  - Evidence: `npx eslint .` → 0 errors; `npm run build` → clean; `npx vitest run` → 354/354 passed.
- [x] Audit of the remaining per-file request paths (follow-up to the 404 sweep): gitignore discovery remote-fetched speculative candidates (repo root + every rootPath ancestor) that exist nowhere, and `SyncStatusView` triggered a *second* full tree fetch per refresh by calling `loadGitignores()` without the tree it had just read; batch pull downloaded every file's content just to discover it was unchanged. Gitignore lookups now skip candidates a known tree doesn't list, the view shares its (now unfiltered) tree, and pull decides unchanged/conflict from tree shas, fetching content only when it will actually write.
  - Evidence: `npx eslint .` → 0 errors; `npm run build` → clean; `npx vitest run` → 360/360 passed.

### What's In Progress

- Nothing actively in progress.

### What's Next

1. Push this session's commit to `origin/codex/perf-github-push-260723` — confirm with the user first (this branch already has no open PR; decide whether to open one or merge directly to `main`).
2. New release folders (e.g. `src/changelog/1.4.0/`) still need one import line added to `src/changelog/index.ts`'s `CHANGELOG` array — not fully zero-touch, but no longer touches the shared i18n locale files.
3. Re-sync against `gh issue list --repo firstsun-dev/git-files-sync --state open` — the backlog below is a snapshot from an earlier session.

## Blockers / Risks

- None currently.

## Decisions Made

- **Changelog "what's new" text lives in per-version folders under `src/changelog/`, not the shared i18n catalog**: user flagged that dumping every release's entry text into `src/i18n/locales/*.ts` would make those files grow forever. Each `src/changelog/<version>/index.ts` carries its own inline `{ en, zh-tw, zh-cn }` text; `src/changelog/index.ts` aggregates and resolves per the active locale via `entryText()`.
- **perf → patch under `.releaserc.json`**: confirmed via `.releaserc.json`'s commit-analyzer `releaseRules` (`{ "type": "perf", "release": "patch" }`), so the two `perf(push)` commits already on this branch bump 1.3.0 → 1.3.1 automatically on release — no manual edit to `package.json`/`manifest.json`/`versions.json` (that's `@semantic-release/exec`'s job in CI).

## Files Modified This Session

- `src/changelog.ts` deleted; replaced by `src/changelog/{index,types}.ts` and `src/changelog/{1.2.1,1.3.0,1.3.1}/index.ts`
- `src/ui/WhatsNewModal.ts`, `src/settings.ts` (use `entryText()` instead of raw `entry.text`)
- `tests/changelog.test.ts`, `tests/ui/WhatsNewModal.test.ts` (fixtures updated to the new `text: { en }` shape)
- `package-lock.json` (stale `version` field synced to 1.3.0 by `npm install`)

## Evidence of Completion

- [x] Tests pass: `npx vitest run` → 351/351 passed
- [x] Type check clean: `npm run build` → clean
- [x] Lint clean: `npx eslint .` → 0 errors
- [ ] Manual verification inside the actual Obsidian plugin UI — not done, no Obsidian instance available
- [ ] Pushed to remote — not yet done, needs confirmation

## Notes for Next Session

- Working branch: `claude/conventional-perf-push-speed-9136c3`, tracking `origin/codex/perf-github-push-260723`. Nothing pushed yet — confirm with the user before pushing/merging.
