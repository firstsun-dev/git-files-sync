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

**Last Updated:** 2026-07-13 14:20
**Session ID:** (this session)
**Active Feature:** feat-006 - i18n (multi-language) support (issue #38)

## Status

### What's Done

- [x] feat-001 - Project Setup verified (see archive/2026-07.md)
- [x] feat-002 - Settings UX bundle (see archive/2026-07.md); this branch's history already contains it (merged upstream of `claude/fix-directory-symlink-pull-260713`)
- [x] feat-006 implementation - i18n core (`src/i18n/index.ts`, `locales/en.ts`, `locales/zh-tw.ts`), ~130 strings extracted across settings.ts, main.ts, and 7 `ui/` files, tests added, lint/build/test all clean

### What's In Progress

- [ ] feat-006 - push branch `claude/i18n-support-260713` and open a PR (or fold it back into `claude/fix-directory-symlink-pull-260713` per the user's stated intent)
  - Details: worked in a separate branch/worktree because `claude/fix-directory-symlink-pull-260713` was already checked out elsewhere in this repo's other worktree (main checkout at `/home/tianyao/git-files-sync`), so git wouldn't allow checking out the same branch twice
  - Blockers: none technically; needs the user's go-ahead on push/merge direction

### What's Next

1. Confirm with user whether to push `claude/i18n-support-260713` and open a PR, or merge it locally into `claude/fix-directory-symlink-pull-260713`
2. Re-sync this file's backlog (feat-003..005) against `gh issue list --repo firstsun-dev/git-files-sync --state open`

## Blockers / Risks

- None currently.

## Decisions Made

- **Worked on a new branch instead of the pre-existing `claude/fix-directory-symlink-pull-260713`**: that branch was already checked out in another worktree (the main repo checkout), and git disallows the same branch in two worktrees. Created `claude/i18n-support-260713` off `origin/claude/fix-directory-symlink-pull-260713` instead, per the user's choice.
- **Flat key-value i18n dict, not nested namespaces**: matches this plugin's small scale; simpler `t(key, vars)` lookup, no external i18n library dependency.
- **Locale detection via `window.moment.locale()`**: per issue #38's suggested approach; unknown/unmapped locales fall back to English. A bare `zh` locale code is mapped to `zh-tw` since that's the only Chinese variant shipped.
- **Diff-format markers, changelog release-note text, and proper nouns (GitHub/GitLab/Gitea) were left untranslated** — out of scope for UI-chrome i18n.

## Files Modified This Session

- `src/i18n/index.ts` (new) - `t(key, vars?)` helper, locale detection/resolution
- `src/i18n/locales/en.ts`, `src/i18n/locales/zh-tw.ts` (new) - 159 keys each, full parity
- `src/settings.ts`, `src/main.ts` - all hardcoded UI strings replaced with `t()` calls
- `src/ui/SyncStatusView.ts`, `src/ui/SyncConflictModal.ts`, `src/ui/WhatsNewModal.ts`, `src/ui/ConfirmModal.ts` - same
- `src/ui/components/ActionBar.ts`, `FileListItem.ts`, `DiffPanel.ts` - same
- `tests/i18n/index.test.ts` (new) - 6 test cases covering fallback, locale resolution, interpolation

## Evidence of Completion

- [x] Tests pass: `npx vitest run` → 308/308 passed (302 pre-existing + 6 new i18n tests)
- [x] Type check clean: `npm run build` (tsc + Obsidian 1.11.0 compat typecheck + esbuild) → clean
- [x] Lint clean: `npx eslint .` → 0 errors
- [ ] Manual verification in Obsidian: not done (no Obsidian instance available in this environment)

## Notes for Next Session

- Branch `claude/i18n-support-260713` has uncommitted working-tree changes as of this session's end — not yet committed or pushed.
- `feature_list.json`'s backlog (feat-003..005) is a snapshot from 2026-07-13; re-check `gh issue list` before trusting it.
