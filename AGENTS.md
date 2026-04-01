# Project Agent Design & Hierarchy (Synchronized with Skills)

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