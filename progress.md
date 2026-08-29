# Session Progress Log

Completed work is archived in [archive/](./archive/), one file per calendar month.

## Current State

**Last Updated:** 2026-08-30
**Active Feature:** PR #129 (`claude/source-control-foundation`) — 4 remaining review fixes done + CI fully green on run `33274607880`; iPad manual regression → final merge.
**Branch / PR:** `claude/source-control-foundation` / PR #129 (head `17d241c`).

## Outstanding Items

1. ✅ CI verified: surviving whole-run `33274607880` (pull_request @ `17d241c`) all green — Lint, Build, Unit 22, Unit 24, GitHub E2E, GitLab E2E, Gitea E2E, Required Checks, Package (Publish skipped: non-main). The competing push run was cancelled by the new workflow-level concurrency — exactly the intended contract.
2. Manual iPad regression checklist (merge-gate list in the review) on a fresh `npm run deploy` build.
3. Final merge-ready review of PR #129, then merge.

## Verification Evidence

- `acd2046` fix(ci): serialize branch validation workflows — workflow-level `concurrency:` keyed `ci-<branch>` for push/pull_request, unique groups for workflow_dispatch/schedule; per-job e2e concurrency removed (split-winner race gone). New contract tests in `tests/ci-workflow.test.ts` (10 passed). `npx eslint .` 0 errors, `npm run build` passed (hook).
- `78a78e8` fix(source-control): track diff stat requests by generation token — `active` is now a `Map<ChangeId, ActiveDiffStatRequest>` (token + generations); a finishing request deletes only its own marker; `physicalInFlight` (not `active.size`) gates the 4-concurrency cap. Regression tests: old-finally can't clear newer marker, no duplicate #3 on re-render while stale+current in flight, rapid-invalidate burst never exceeds 4 physically concurrent calls. `npx vitest run tests/ui/source-control/DiffStatProvider.test.ts` — 22 passed.
- `49f3033` fix(sync-status): preserve refreshed state across live modifications — `handleFileModified` re-reads the row after its await and classifies from `current`, not the pre-await snapshot; full-refresh state (remoteSha/remoteContent/isSymlink/movedFrom) survives; modify during pending delete can't resurrect (stays `local-deleted`, content-less); rename-away path not written back. Tests +3 (20 passed in file).
- `fbe0787` fix(source-control): correct one-sided diff stat direction — `addedContentStat`/`deletedContentStat` in ChangePresentation; `SourceControlItemView.loadDiffStat` applies ↓=+N / D=-N without touching the diff-pane FileDiff sides. Rendered-stat tests: remote-only 2 lines → `+2`, local-deleted 2 lines → `-2`. Helper tests in ChangePresentation.test.ts.
- Full gate after all 4: `npx eslint .` — 0 errors; `npx vitest run` — 66 files / 804 tests passed; per-commit `npm run build` (+ Obsidian 1.11 compat) passed via the husky pre-commit hook on all 4 commits.
- Pushed `9eb3713..17d241c` (4 fixes + docs). CI: whole-run concurrency confirmed live — for `17d241c`, push run `33274606265` cancelled, pull_request run `33274607880` survived with ALL groups green: Lint ✅ Build ✅ Unit22 ✅ Unit24 ✅ GitHub E2E ✅ GitLab E2E ✅ Gitea E2E ✅ Required Checks ✅ Package ✅ (Publish skipped, non-main).