# AGENTS.md

Obsidian plugin that syncs vault files with a GitHub, GitLab, or Gitea repository. This repository is
public: write issues and PRs in English; conventions are in the `firstsun-pm` skill.

## Start

Read this file, then only what the task needs. From an issue: read it and what it links. Resuming: read the
Draft PR description, commits, checks and review comments before editing.

## Task tracking and handoff

- Tasks and backlog: GitHub Issues. Priority and status: [Project #6](https://github.com/orgs/firstsun-dev/projects/6).
- Progress and handoff: branch, commits, Draft PR. Unfinished work goes to an issue.
- History: git log; retired state files are in `archive/legacy-harness/` (do not load by default).

## Scope

- One task per branch (a worktree when sessions run in parallel). Check open PRs for overlap.
- No unrelated refactoring; file an issue instead.

## Verification and Definition of Done

- `pnpm exec eslint .`: 0 errors
- `pnpm run build`: tsc, Obsidian 1.11.0 compatibility typecheck, esbuild
- `pnpm exec vitest run`
- Manual verification in Obsidian when a change has a runtime UI surface

`./init.sh` runs install, lint, test and build.

The PR records each check as PASS, FAIL, SKIP or NOT RUN (with the reason). Never call a failure
pre-existing without reproducing it on the base branch.

## Development Commands
- Build: `pnpm run build` (runs type check and esbuild in production mode)
- Dev: `pnpm run dev` (builds in watch mode using esbuild)
- Lint: `pnpm run lint` (runs eslint check)
- Test: `pnpm run test` (runs vitest suite)
- Version bump: `pnpm run version` (updates manifest.json and versions.json via script)

## Architecture Contract

Before production code changes:
- Read `docs/architecture.md`.
- For bug fixes also read `docs/bug-fix-guidelines.md`.
- Identify the owning module before editing.
- Preserve dependency direction.
- Do not bypass `SyncWorkspace`.
- Do not move domain/provider logic into UI.
- Do not duplicate status/conflict/rename/action policy.

`docs/architecture.md` is the canonical module map (layers, ownership table, MUST/MUST NOT rules, current hotspots) — this file does not duplicate it. A short summary:

- **Type**: Obsidian Plugin (TypeScript) that syncs vault files with a GitHub, GitLab, or Gitea repository.
- **Entry point**: `src/main.ts` owns only Obsidian lifecycle (settings load/save, command/view/ribbon/vault-event registration); the sync/Source Control constructor graph is wired by `src/runtime/createSyncRuntime.ts`.
- **Settings**: `src/settings.ts` defines `GitLabFilesPushSettings` interface, `DEFAULT_SETTINGS` object, and `GitLabSyncSettingTab` for the Obsidian UI.

Two compatibility gotchas not covered by `docs/architecture.md`:
- Do not reintroduce `SyncStatusView` or `ui/sync-status/*` — that legacy presentation layer was replaced by the Source Control surface (`SourceControlItemView`/`SourceControlView`) and is blocked by an ESLint `no-restricted-imports` rule (`eslint.config.*`). The historical migration docs live in `docs/source-control-refactor/` and are marked as such; they are not current implementation guidance.
- `SOURCE_CONTROL_VIEW_TYPE` (`'sync-status-view'`) and the `open-sync-status` command id are intentionally kept as-is for pinned-leaf/workspace-layout compatibility — they resolve to the current `SourceControlItemView`, not a leftover of the old UI. Do not rename them as "cleanup."

- **Bundling**: Uses `esbuild.config.mjs` for compilation from TypeScript to a single `main.js` file.
- **Deployment**: Relies on `manifest.json` for plugin metadata and `versions.json` for version mapping/compatibility.

## Conventions
- Use `this.loadData()` and `this.saveData()` for persistent settings.
- Use `this.addCommand()` for registration in the Command Palette.
- Use `this.addRibbonIcon()` for left-sidebar buttons.
- Use `this.registerDomEvent()` and `this.registerInterval()` to ensure automatic cleanup when the plugin is disabled.

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
- **Execution**: Offload `pnpm exec vitest run` and `pnpm run lint` to Haiku.
- **Report Format**: `Success: N items, Failure: X items` (including error logs on failure).

### 2. Marketplace Readiness (Skill: `obsidian-marketplace-check`)
- **Rule**: Verify compliance before any release candidate.
- **Checks**: `manifest.json` parity, `isDesktopOnly` logic, and `onunload` cleanup.

### 3. CI/CD Monitoring (Skill: `obsidian-development`)
- **Rule**: Post-push monitoring by Haiku in the background.
- **Failure Protocol**: Fetch and return specific error messages from the CI pipeline.

### 4. Git Integrity
- **Pre-commit**: Husky hook running `pnpm run lint && pnpm run build`.
