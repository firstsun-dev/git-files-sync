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

**Last Updated:** 2026-07-13 14:35
**Session ID:** (this session, merged with session_01YYCTyZw7gUmJ7oh1VTmAqh's parallel work)
**Active Feature:** none — feat-001 through feat-009 are all done; feat-010 (Bitbucket, #37) is next up but not started

## Status

### What's Done

- [x] feat-001..008 (project setup, settings UX bundle, folder picker, symlink pull fix, tree-SHA refresh, HTML-response error clarity, what's-new modal) — see archive/2026-07.md
- [x] feat-009 - i18n / multi-language support (issue #38): `src/i18n/{index,locales/en,locales/zh-tw}.ts` (159 keys, en + zh-tw, full parity), ~130 hardcoded strings replaced across `settings.ts`, `main.ts`, and 7 `ui/` files, `tests/i18n/index.test.ts` added (6 cases)
- All consolidated onto branch `claude/fix-directory-symlink-pull-260713` → **PR #51**, per the user's explicit request to keep the PR count down rather than one PR per issue.

### What's In Progress

- Nothing actively in progress. feat-009 landed as a separate commit (`144eb28`, from a temporary branch `claude/i18n-support-260713`) merged into this branch and pushed to origin as part of PR #51.

### What's Next

1. Issue #37 (Bitbucket provider support, feat-010) — large, was deferred until #38 landed (agreed order: 39→38→37). Now unblocked.
2. Re-sync against `gh issue list --repo firstsun-dev/git-files-sync --state open`. Remaining genuinely-unstarted issues as of this session: #47 (regex ignore lists), #45 (SonarQube findings), #37 (Bitbucket), #28 (non-engineering: community visibility).
3. PR #51 is large (7 issues' worth of changes now). If the user wants to review/merge it before more work piles on, flag this rather than continuing to add commits indefinitely.

## Blockers / Risks

- None currently. (Earlier in this session, feat-009 was recorded as "blocked, awaiting scope decision" by a parallel session working in the main checkout — that scope question was resolved directly with the user in this session instead: flat key-value dict, `window.moment.locale()` detection with English fallback, cover settings.ts + all Notices now. No longer blocked.)

## Decisions Made

- **All work goes into one PR (#51)**: user explicitly said "不要那麼多pr merge" (don't want so many PRs). Any further issue work should commit directly onto `claude/fix-directory-symlink-pull-260713`, not a new branch — the i18n work below was an exception only because that branch was already checked out in another worktree when the session started; it was merged back in immediately rather than left as a standing separate branch/PR.
- **feat-009 scope**: settings.ts + all Notice() messages, done in one pass rather than split into infra-first/settings-only phases — a half-migrated i18n system (some strings extracted, most not) would be worse than finishing it.
- **Flat key-value i18n dict, not nested namespaces**: matches this plugin's small scale; simpler `t(key, vars)` lookup, no external i18n library dependency.
- **Locale detection via `window.moment.locale()`**: per issue #38's suggested approach; unresolvable/unsupported locales fall back to English. A bare `zh` locale code maps to `zh-tw`, the only Chinese variant shipped.
- **Diff-format markers, changelog release-note text, and proper nouns (GitHub/GitLab/Gitea) were left untranslated** — out of scope for UI-chrome i18n.
- **`src/changelog.ts` is hand-curated, separate from the auto-generated `CHANGELOG.md`**: semantic-release already maintains `CHANGELOG.md` from Conventional Commit messages, but it's commit-log-level detail (too granular for an end-user popup) and isn't shipped in the release assets. The what's-new modal needs a small, hand-written, user-facing "highlights" list instead.
- **Fixed two duplication regressions mid-session** (SonarCloud gate is 3% on new code, learned the hard way on PR #49 earlier): deduped `TextComponent`/`TextAreaComponent` test mocks, and deduped the GitHub/Gitea `getBlob()` bodies into a shared `fetchGitHubStyleBlob()` base helper.

## Files Modified This Session

- feat-009 (i18n): `src/i18n/index.ts`, `src/i18n/locales/en.ts`, `src/i18n/locales/zh-tw.ts`, `tests/i18n/index.test.ts` (all new); `src/settings.ts`, `src/main.ts`, `src/ui/SyncStatusView.ts`, `src/ui/SyncConflictModal.ts`, `src/ui/WhatsNewModal.ts`, `src/ui/ConfirmModal.ts`, `src/ui/components/ActionBar.ts`, `FileListItem.ts`, `DiffPanel.ts` (modified)
- See archive/2026-07.md entries feat-003/005/006/007/008 for the earlier features' file lists.

## Evidence of Completion

- [x] Tests pass: `npx vitest run` → 308/308 passed
- [x] Type check clean: `npm run build` (tsc + Obsidian 1.11.0 compat typecheck + esbuild) → clean
- [x] Lint clean: `npx eslint .` → 0 errors
- [ ] Manual verification in Obsidian: not done (no Obsidian instance available in this environment) for any feature this session

## Notes for Next Session

- Working branch for all further commits: `claude/fix-directory-symlink-pull-260713` (PR #51). Do not open a new branch/PR for the next issue unless the user says otherwise.
- `feature_list.json`'s backlog is a snapshot from this session — re-check `gh issue list` before trusting it.
