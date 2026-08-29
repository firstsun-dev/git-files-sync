# Session Progress Log

Completed work is archived in [archive/](./archive/), one file per calendar month.

## Current State

**Last Updated:** 2026-08-30
**Active Feature:** PR #129 (`claude/source-control-foundation`) — 4 remaining review fixes done; awaiting CI + iPad regression, then final merge gate.
**Branch / PR:** `claude/source-control-foundation` / PR #129 (head `fbe0787`).

## Outstanding Items

1. New push run(s) for `fbe0787` must finish all green — with the new whole-run concurrency, ONE complete run (push or PR) must own all 9 check groups: Lint, Build, Unit 22, Unit 24, GitHub E2E, GitLab E2E, Gitea E2E, Required Checks, Package.
2. Verify the workflow-level concurrency works as contracted: push + pull_request for the same branch → only one survives in full.
3. Manual iPad regression checklist (merge-gate list in the review) on a fresh `npm run deploy` build.
4. Final merge-ready review of PR #129, then merge.

## Verification Evidence

- `acd2046` fix(ci): serialize branch validation workflows — workflow-level `concurrency:` keyed `ci-<branch>` for push/pull_request, unique groups for workflow_dispatch/schedule; per-job e2e concurrency removed (split-winner race gone). New contract tests in `tests/ci-workflow.test.ts` (10 passed). `npx eslint .` 0 errors, `npm run build` passed (hook).
- `78a78e8` fix(source-control): track diff stat requests by generation token — `active` is now a `Map<ChangeId, ActiveDiffStatRequest>` (token + generations); a finishing request deletes only its own marker; `physicalInFlight` (not `active.size`) gates the 4-concurrency cap. Regression tests: old-finally can't clear newer marker, no duplicate #3 on re-render while stale+current in flight, rapid-invalidate burst never exceeds 4 physically concurrent calls. `npx vitest run tests/ui/source-control/DiffStatProvider.test.ts` — 22 passed.
- `49f3033` fix(sync-status): preserve refreshed state across live modifications — `handleFileModified` re-reads the row after its await and classifies from `current`, not the pre-await snapshot; full-refresh state (remoteSha/remoteContent/isSymlink/movedFrom) survives; modify during pending delete can't resurrect (stays `local-deleted`, content-less); rename-away path not written back. Tests +3 (20 passed in file).
- `fbe0787` fix(source-control): correct one-sided diff stat direction — `addedContentStat`/`deletedContentStat` in ChangePresentation; `SourceControlItemView.loadDiffStat` applies ↓=+N / D=-N without touching the diff-pane FileDiff sides. Rendered-stat tests: remote-only 2 lines → `+2`, local-deleted 2 lines → `-2`. Helper tests in ChangePresentation.test.ts.
- Full gate after all 4: `npx eslint .` — 0 errors; `npx vitest run` — 66 files / 804 tests passed; per-commit `npm run build` (+ Obsidian 1.11 compat) passed via the husky pre-commit hook on all 4 commits.
- Pushed `9eb3713..fbe0787`.