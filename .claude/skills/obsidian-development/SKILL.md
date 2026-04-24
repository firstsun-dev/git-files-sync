---
name: obsidian-development
description: Use when developing Obsidian plugins to ensure TDD with Vitest, linting, and adherence to Obsidian API conventions. Trigger this skill when the user mentions building, testing, or modifying an Obsidian plugin, or when they ask for help with Obsidian-specific APIs (commands, ribbon icons, workspace events).
---

# Obsidian Plugin Development

You are a specialist in building Obsidian plugins. This skill ensures you follow the project's specific conventions for testing, linting, and API usage.

## Core Principles

1.  **Test-Driven Development (TDD)**: Always write tests before implementation for logic and service classes.
2.  **API Hygiene**: Use Obsidian's lifecycle methods correctly (`onload`, `onunload`) and register all events/intervals for automatic cleanup.
3.  **Linting**: Adhere to the project's ESLint configuration (`npm run lint`).

## Development Workflow

### 1. Testing with Vitest

The project uses `vitest` for unit and integration testing. Tests are located in the `tests/` directory.

- **Command**: `npm run test` or `npm run test:ui` for the interactive dashboard.
- **Pattern**: Create a corresponding `.test.ts` file for every logic or service file.
- **Example**:
  ```typescript
  // tests/logic/sync-manager.test.ts
  import { describe, it, expect, vi } from 'vitest';
  // ... test implementation
  ```

### 2. Obsidian API Conventions

- **Settings**: Define settings in `src/settings.ts`. Use `this.loadData()` and `this.saveData()` in the main plugin class.
- **Commands**: Register commands using `this.addCommand()`. Always provide an `id` and `name`.
- **UI Elements**: Use `this.addRibbonIcon()` for sidebar buttons.
- **Cleanup**: 
  - Use `this.registerEvent()` for workspace events.
  - Use `this.registerDomEvent()` for DOM events.
  - Use `this.registerInterval()` for recurring tasks.
  - **Why**: These ensure that when the plugin is disabled or uninstalled, Obsidian automatically cleans up the resources to prevent memory leaks.

### 3. Build & Deployment

- **Dev Mode**: `npm run dev` (watches for changes and rebuilds).
- **Production Build**: `npm run build` (runs type checking and minification).
- **Versioning**: `npm run version` (bumps version in `manifest.json` and updates `versions.json`).

## Project Structure Reference

- `src/main.ts`: Entry point (Main Plugin Class).
- `src/settings.ts`: Settings definitions and UI tab.
- `src/services/`: External integrations (e.g., GitLab API).
- `src/logic/`: Core business logic.
- `src/ui/`: Custom modals, views, or setting components.

## Checklist for New Features

- [ ] Draft test cases in `tests/` before writing logic.
- [ ] Use `registerEvent` instead of raw `on` handlers where possible.
- [ ] Verify `npm run lint` passes before completion.
- [ ] Ensure all persistent data is saved via `this.saveSettings()`.
