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

**Last Updated:** 2026-07-13 14:05
**Session ID:** session_01YYCTyZw7gUmJ7oh1VTmAqh
**Active Feature:** feat-009 - i18n / multi-language support (issue #38) — paused, awaiting scope decision

## Status

### What's Done

- [x] feat-001..008 (project setup, settings UX bundle, folder picker, symlink pull fix, tree-SHA refresh, HTML-response error clarity, what's-new modal) — see archive/2026-07.md
- All consolidated onto branch `claude/fix-directory-symlink-pull-260713` → **PR #51** (open, all CI green as of last check), per user's explicit request to keep the PR count down rather than one PR per issue.

### What's In Progress

- [ ] feat-009 - i18n / multi-language support (issue #38)
  - Scope is large: ~47 hardcoded strings in `src/settings.ts`, ~24 in `src/ui/SyncStatusView.ts`, plus 37 `new Notice(...)` call sites across `src/logic/sync-manager.ts`, `src/settings.ts`, `src/main.ts`, `src/ui/SyncStatusView.ts` (many with interpolated values).
  - Asked the user how deep to scope this (full settings.ts extraction only vs. settings+all Notices vs. infra-only-first); the question prompt was dismissed without an answer before the user ran `/firstsun-harness`. **Not yet started** — no i18n files created.
  - Next step: get a scope decision from the user before writing any code, since a half-migrated i18n system (some strings extracted, most not) is worse than not starting.

### What's Next

1. Resolve feat-009's scope question with the user, then implement.
2. Issue #37 (Bitbucket provider support) — large, deferred until #38 lands (per agreed order: 39→38→37).
3. Re-sync against `gh issue list --repo firstsun-dev/git-files-sync --state open` — as of this session, #40/#41/#42/#48/#33/#36/#31/#39 are technically still "open" on GitHub but are all done in code and waiting on PR #51 to merge (they'll auto-close then). Remaining genuinely-unstarted issues: #47 (regex ignore lists), #45 (SonarQube findings), #38 (i18n, in progress), #37 (Bitbucket), #28 (non-engineering: community visibility).

## Blockers / Risks

- feat-009 (i18n) is blocked on a scope decision from the user — do not start writing `src/i18n/*` or touching `settings.ts` strings until that's confirmed, to avoid an inconsistent half-migration.
- PR #51 is large (6 issues' worth of changes). If the user wants to review/merge it before more work piles on, flag this rather than continuing to add commits indefinitely.

## Decisions Made

- **All work goes into one PR (#51)**: user explicitly said "不要那麼多pr merge" (don't want so many PRs). Branches `claude/tree-sha-status-refresh-260713` and `claude/fix-html-response-json-error-260713` were merged into `claude/fix-directory-symlink-pull-260713` and their PRs (#52, #53) closed/auto-resolved; `claude/settings-ux-improvements-260713` and `claude/folder-picker-settings-260713` were already merged in earlier the same way (PRs #49, #50 closed). **Any further issue work this session should commit directly onto `claude/fix-directory-symlink-pull-260713`, not a new branch.**
- **`src/changelog.ts` is hand-curated, separate from the auto-generated `CHANGELOG.md`**: semantic-release already maintains `CHANGELOG.md` from Conventional Commit messages, but it's commit-log-level detail (too granular for an end-user popup) and isn't shipped in the release assets (only `main.js`/`manifest.json`/`styles.css` are). The new modal needs a small, hand-written, user-facing "highlights" list instead — added as part of cutting a release, not auto-generated.
- **Fixed two duplication regressions mid-session** (SonarCloud gate is 3% on new code, learned the hard way on PR #49 earlier): deduped `TextComponent`/`TextAreaComponent` test mocks, and deduped the GitHub/Gitea `getBlob()` bodies into a shared `fetchGitHubStyleBlob()` base helper.

## Files Modified This Session

See archive/2026-07.md entries feat-003/005/006/007/008 for the full per-feature file lists. No files touched yet for feat-009 (i18n) — paused before any code was written.

## Evidence of Completion

- [x] Tests pass: `npx vitest run` → 302/302 passed (as of commit 4eebebc)
- [x] Type check clean: `npm run build` → clean
- [x] Lint clean: `npx eslint .` → 0 errors
- [ ] Manual verification in Obsidian: not done (no Obsidian instance available in this environment) for any feature this session

## Notes for Next Session

- Start by getting the user's answer on feat-009's scope (see "What's In Progress" above) before writing any i18n code.
- `feature_list.json`'s backlog is a snapshot from this session — re-check `gh issue list` before trusting it, though as of now it should be accurate (checked at end of session).
- Working branch for all further commits: `claude/fix-directory-symlink-pull-260713` (PR #51). Do not open a new branch/PR for the next issue unless the user says otherwise.
