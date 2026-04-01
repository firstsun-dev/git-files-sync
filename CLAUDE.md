# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands
- Build: `npm run build` (runs type check and esbuild in production mode)
- Dev: `npm run dev` (builds in watch mode using esbuild)
- Lint: `npm run lint` (runs eslint check)
- Test: `npm run test` (runs vitest suite)
- Version bump: `npm run version` (updates manifest.json and versions.json via script)
- **CI/CD Monitoring**: After pushing changes, task a Haiku subagent to monitor the pipeline and report results as "Success: N stages, Failure: X stages".
- **Cost Optimization**: Always use a Haiku subagent for running tests, linting, and final commits. Report as "Success: N items, Failure: X items".

## Code Architecture
- **Type**: Obsidian Plugin (TypeScript)
- **Entry Point**: `src/main.ts` contains the main `MyPlugin` class extending `Plugin`.
- **Settings**: `src/settings.ts` defines `MyPluginSettings` interface, `DEFAULT_SETTINGS` object, and `SampleSettingTab` for the Obsidian UI.
- **Bundling**: Uses `esbuild.config.mjs` for compilation from TypeScript to a single `main.js` file.
- **Deployment**: Relies on `manifest.json` for plugin metadata and `versions.json` for version mapping/compatibility.

## Conventions
- Use `this.loadData()` and `this.saveData()` for persistent settings.
- Use `this.addCommand()` for registration in the Command Palette.
- Use `this.addRibbonIcon()` for left-sidebar buttons.
- Use `this.registerDomEvent()` and `this.registerInterval()` to ensure automatic cleanup when the plugin is disabled.