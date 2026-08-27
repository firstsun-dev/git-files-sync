# Session Progress Log

Completed work is archived in [archive/](./archive/), one file per calendar month.

## Current State

**Last Updated:** 2026-08-27
**Active Feature:** feat-027 / issue #139 — disposable Gitea local/CI portability and runner trust separation.
**Branch / PR:** `codex/test-gitea-e2e-ci` / PR #140, based on `claude/source-control-foundation` because that stacked branch contains the current E2E baseline.

## Outstanding Items

1. Review and merge PR #140, then allow the stacked source-control branch to reach `main`.
2. Configure `E2E / gitea` as a required check when branch protection is next updated.
3. Optionally validate the fork-only event path with a controlled external fork PR; workflow contracts and targeted dispatch already prove the same success/skipped gate combination.

## Verification Evidence

- Commits `920adee`, `18de6e0`, `b5884fc`: Gitea uses a Docker-assigned loopback port and each local invocation owns a `mktemp` workdir; Gitea CI runs on `ubuntu-latest` with `contents: read`; GitHub/GitLab stay on self-hosted runners with fork rejection at job level; manual/scheduled concurrency cannot cancel normal push/PR checks.
- Local: `npx eslint .` — 0 errors; `npm run build` — pass including Obsidian 1.11 compatibility; `npx vitest run` — 56 files / 554 tests; shell syntax/ShellCheck/actionlint/diff checks — pass (known custom `32gb-ram` label excluded from actionlint); Gitea E2E — 3 files / 27 passed, 17 skipped, including two concurrent runs with distinct ports/workdirs and complete cleanup.
- Real CI: targeted Gitea run 33048613679 — Gitea, aggregate gate, shared lint, Node 22/24 tests, package, and build/release all passed. Concurrent push run 33048499785 retained a successful `E2E / gitea` check while the manual run executed, proving concurrency isolation. SonarCloud passed on PR #140.

The AGENTS-required Haiku verifier was unavailable in this environment; verification ran locally and through real CI.
