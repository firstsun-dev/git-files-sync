# Project Agent Design & Hierarchy (Synchronized with Skills)

## Startup Workflow

Before writing code:
- Read `feature_list.json` (active/next-up work — GitHub Issues on `firstsun-dev/git-files-sync`, Project #6, is the real source of truth; re-sync stale entries) and `progress.md` (what's currently open).
- Read `session-handoff.md` for the previous session's exact stopping point.
- Run `./init.sh` to confirm a clean, green baseline before editing.

## Definition of Done

A feature is done only when all of the following hold, with evidence recorded (command + result) in `progress.md`:
- `npx eslint .` — 0 errors
- `npm run build` — passes (tsc + Obsidian 1.11.0 compat typecheck + esbuild)
- `npx vitest run` — passes
- Manual verification in Obsidian, when the change has a runtime UI surface

## Stay in Scope

- One feature at a time: pick a single `feature_list.json` entry and finish it (with recorded evidence) before starting the next.
- Don't expand scope mid-task — file a new GitHub issue via the `firstsun-pm` skill instead of quietly bundling unrelated work.

## End of Session

Before ending a session:
- Overwrite `session-handoff.md` (don't append) with the new stopping point so the repo stays restartable.
- Move finished items from `progress.md` into `archive/YYYY-MM.md` (current month) — next steps in `progress.md` should read as a short list, not a changelog.

## Agent Tiers

### 1. High-Tier (Red/Orange Group)
- **Sonnet 4.6 (Primary)**: Orchestrator for complex planning and architecture.
- **Opus (Architect)**: Deep research and large-scale refactoring.

### 2. Low-Tier (Blue/Green/Cyan Group)
- **Haiku (Specialized)**: Fast, token-efficient model for TDD, linting, and CI/CD monitoring. **REQUIRED**: All verification tasks MUST be offloaded to Haiku to save tokens.
- **Subagents**: Isolated tasks for context protection.

## Core Workflows (Mandatory Skills Integration)

### 1. TDD & Linting (Skill: `obsidian-development`)
- **Rule**: Write Vitest tests BEFORE implementation.
- **Execution**: Offload `npx vitest run` and `npm run lint` to Haiku.
- **Report Format**: `Success: N items, Failure: X items` (including error logs on failure).

### 2. Marketplace Readiness (Skill: `obsidian-marketplace-check`)
- **Rule**: Verify compliance before any release candidate.
- **Checks**: `manifest.json` parity, `isDesktopOnly` logic, and `onunload` cleanup.

### 3. CI/CD Monitoring (Skill: `obsidian-development`)
- **Rule**: Post-push monitoring by Haiku in the background.
- **Failure Protocol**: Fetch and return specific error messages from the CI pipeline.

### 4. Git Integrity
- **Pre-commit**: Husky hook running `npm run lint && npm run build`.