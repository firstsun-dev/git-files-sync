# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Workflow

- **Startup**: read `feature_list.json` (active/next-up work; GitHub Issues on `firstsun-dev/git-files-sync`, Project #6, is the actual source of truth — re-sync before trusting stale entries) and `progress.md` (what's open right now).
- **Before editing**: run `./init.sh` (installs deps, then lint + test + build) to confirm you're starting from a green baseline.
- **Definition of done**: `npx eslint .` has 0 errors, `npm run build` passes (includes the Obsidian 1.11.0 compat typecheck), and `npx vitest run` passes, *and* evidence of that run is recorded (one line: command + result) in `progress.md` or the PR description — not just claimed.
- **Scope**: work one `feature_list.json` entry at a time; don't start the next until the current one's evidence is recorded.
- **End of session**: move finished items from `progress.md` into `archive/YYYY-MM.md` (current month).
- Issue/PR conventions (Conventional Commits titles, Project #6 fields, English-only for this public plugin repo) are defined in the `firstsun-pm` skill, not duplicated here.

## Development Commands
- Build: `npm run build` (runs type check and esbuild in production mode)
- Dev: `npm run dev` (builds in watch mode using esbuild)
- Lint: `npm run lint` (runs eslint check)
- Test: `npm run test` (runs vitest suite)
- Version bump: `npm run version` (updates manifest.json and versions.json via script)

## Code Architecture
- **Type**: Obsidian Plugin (TypeScript) that syncs vault files with a GitLab or GitHub repository.
- **Entry Point**: `src/main.ts` contains the main `GitLabFilesPush` class extending `Plugin`.
- **Settings**: `src/settings.ts` defines `GitLabFilesPushSettings` interface, `DEFAULT_SETTINGS` object, and `GitLabSyncSettingTab` for the Obsidian UI.
- **Services**: `src/services/` abstracts the git provider behind `GitServiceInterface`, with `GitHubService` and `GitLabService` implementations sharing common logic via `BaseGitService`.
- **Sync logic**: `src/logic/sync-manager.ts` handles push/pull, conflict detection, and rename detection; `src/logic/gitignore-manager.ts` merges local and remote `.gitignore` rules.
- **UI**: `src/ui/SyncStatusView.ts` renders the sync status side panel; `src/ui/components/` holds its sub-views.
- **Bundling**: Uses `esbuild.config.mjs` for compilation from TypeScript to a single `main.js` file.
- **Deployment**: Relies on `manifest.json` for plugin metadata and `versions.json` for version mapping/compatibility.

## Conventions
- Use `this.loadData()` and `this.saveData()` for persistent settings.
- Use `this.addCommand()` for registration in the Command Palette.
- Use `this.addRibbonIcon()` for left-sidebar buttons.
- Use `this.registerDomEvent()` and `this.registerInterval()` to ensure automatic cleanup when the plugin is disabled.