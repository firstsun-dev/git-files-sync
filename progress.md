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
**Active Feature:** None — sync-panel UX work (feat-018/019/020) is committed on `claude/git-mv-convenience-26f64c` and pushed; PR #71 is open against `main`.

## Status

### What's Done

- [x] feat-001..015 — see [archive/2026-07.md](./archive/2026-07.md). 1.3.0 shipped 2026-07-14.

**Merged to main since (feat-016/017 and the push-error work), pending archiving — see "What's Next" item 4:**

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

**This session (feat-018/019/020, PR #71):**

- [x] feat-018 (issue [#70](https://github.com/firstsun-dev/git-files-sync/issues/70)): path search filter in the sync panel. The real work was structural — `renderView()` emptied the whole tree, so an input inside it lost focus after one keystroke. `onOpen()` now builds a persistent `headerEl`/`bodyEl` and `renderView()` rebuilds only the inner containers.
- [x] feat-019 (issue [#68](https://github.com/firstsun-dev/git-files-sync/issues/68)): the row path is now a link whose target follows where the file lives — vault for local statuses, provider web page for `remote-only`, plain text when neither resolves.
- [x] feat-020 (issue [#69](https://github.com/firstsun-dev/git-files-sync/issues/69)): desktop shows diffs in a dedicated `DiffView` pane; mobile keeps the inline panel.
- [x] Follow-up fix (`7fcd24f`): filtering pruned the selection instead of clearing it, after the user hit the clear-everything behaviour immediately.

### What's In Progress

- Nothing actively in progress.

### What's Next

1. Resolve and merge [PR #71](https://github.com/firstsun-dev/git-files-sync/pull/71) — conflicted only in the three harness/doc files (`feature_list.json`, `progress.md`, `session-handoff.md`); all source merged cleanly.
2. Issue [#66](https://github.com/firstsun-dev/git-files-sync/issues/66) (rename → real move, P1) and [#67](https://github.com/firstsun-dev/git-files-sync/issues/67) (folder-move collapse, depends on #66) are filed and designed but not started. #66 is the correctness one.
3. Manual verification of feat-018/019/020 inside the actual Obsidian plugin UI — evidence so far is lint/build/unit tests only.
4. **Archive the merged feat-016/017 + push-error entries above into `archive/2026-07.md`.** They are shipped (1.3.1, 1.3.2) and the cleanup cadence says they should not sit in "What's Done"; left in place here rather than rewriting another session's records during a merge.
5. New release folders (e.g. `src/changelog/1.4.0/`) still need one import line added to `src/changelog/index.ts`'s `CHANGELOG` array.
6. Re-sync against `gh issue list --repo firstsun-dev/git-files-sync --state open`.

## Blockers / Risks

- None currently.

## Decisions Made

- **The selection is always a subset of what's on screen**: any change to the search or the status tab prunes it to the visible rows. First shipped as "clear the whole selection on any query change", which the user hit immediately — ticking files and then typing threw the ticks away even when they still matched. Clearing is the wrong extreme, but so is letting the selection outlive the filter: Push, Pull and remote Delete all act on it and all three are irreversible, so a count the visible rows can't explain is a real hazard. Pruning satisfies both. Tab switching now prunes too, where it used to clear outright.
- **Link target follows the file's location, and unresolvable paths stay plain text**: a dead link on a `remote-only` row — the row users are most curious about — is worse than no link. GitLab with a numeric `projectId` has no per-file web URL, so it deliberately produces none.
- **One diff entry point per platform**: desktop opens the pane, mobile expands inline. Two buttons rendering the same diff differently just invites "what's the difference?".
- **The diff pane closes when its file is pushed or pulled**: it would otherwise keep rendering the pre-push diff while looking perfectly current.
- **Changelog "what's new" text lives in per-version folders under `src/changelog/`, not the shared i18n catalog** (from the merged session): dumping every release's entry text into `src/i18n/locales/*.ts` would make those files grow forever.
- **perf → patch under `.releaserc.json`** (from the merged session): `perf(push)` commits bump the patch version automatically; no manual edit to `package.json`/`manifest.json`/`versions.json`.

## Files Modified This Session

- `src/ui/SyncStatusView.ts` — header/body split, search filter, selection pruning, open-target resolution, diff-pane open/close
- `src/ui/DiffView.ts` (new), `src/main.ts` — the desktop diff pane and its registration
- `src/utils/remote-url.ts` (new) — provider web URLs
- `src/ui/components/FileListItem.ts`, `src/ui/components/icons.ts`, `styles.css` — link rendering, platform-branched diff button, styles
- `src/i18n/locales/{en,zh-tw,zh-cn}.ts` — new keys
- `tests/setup.ts`, `tests/ui/setup-dom.ts` — mock gaps found by the new tests (`debounce`, `Keymap`, `setAttr`, mutable `Platform.isMobile`)
- `tests/ui/SyncStatusView.search.test.ts`, `tests/ui/SyncStatusView.openFile.test.ts`, `tests/ui/DiffView.test.ts`, `tests/utils/remote-url.test.ts` (new); `tests/ui/FileListItem.test.ts`, `tests/ui/SyncStatusView.test.ts` (updated fixtures)

## Evidence of Completion

- [x] Lint clean: `npx eslint .` → 0 errors
- [x] Type check clean: `npm run build` → clean (includes the Obsidian 1.11.0 compat typecheck)
- [x] Tests pass: `npx vitest run` → 397/397 passed (350 at the session's green baseline)
- [ ] Post-merge re-verification against `origin/main` — see below
- [ ] Manual verification inside the actual Obsidian plugin UI — not yet done

## Notes for Next Session

- Working branch: `claude/git-mv-convenience-26f64c` (worktree), PR #71 against `main`.
- `main` moved on during this session (PR #72 + releases 1.3.1/1.3.2), including `src/changelog.ts` → `src/changelog/` and further push-path perf work. Source files merged without conflict, but the merge result needs its own full gate run before the PR is merged.
