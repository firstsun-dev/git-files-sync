# Session Progress Log

Completed work is archived in [archive/](./archive/), one file per calendar month.

## Current State

**Last Updated:** 2026-08-30
**Active Feature:** PR #129 (`claude/source-control-foundation`) — lifecycle hardening + legacy cleanup; awaiting CI + iPad regression, then merge.
**Branch / PR:** `claude/source-control-foundation` / PR #129.

## Outstanding Items

1. CI run `33273746958` (pull_request @ af376f2) must finish all green — Lint, Build, Unit 22/24, Provider E2E (github/gitea/gitlab), Required Checks, Package.
2. Manual iPad regression on build deployed 2026-08-30 04:33 to `~/Obsidian/MyPKM` — scenario list in `session-handoff.md` Next Step.
3. Merge PR #129 once 1+2 pass; PR body already updated with the lifecycle hardening + legacy cleanup section.

## Verification Evidence

- Commit `05f6628` fix(source-control): harden scroll, diff-stat and create lifecycles. `npx eslint .` — 0 errors; `npm run build` — passed incl. Obsidian 1.11 compat; `npx vitest run` — 66 files / 788 tests passed; coverage thresholds introduced (70/70/70/60), full-run numbers 84.02/75.57/81.61/86.11.
- Commit `af376f2` chore(source-control): finish legacy sync-status presentation cleanup. Same gate green at commit time; `-273/+61` lines; dead i18n keys removed (81 per locale), user-facing wording → "Source Control", ESLint restricted-imports guard added, `src/ui/source-control/**` in coverage.
- Previous round (CI-verified): run `33260979664` all green at `2d6cf91`+`709905a`. The push run `33260978068` was cancelled by design (same-branch e2e concurrency; pull_request run supersedes, ci.yml:360).