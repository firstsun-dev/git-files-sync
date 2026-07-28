# Session Handoff

**Date:** 2026-07-28
**Branch:** `codex/sync-status-service-1-5`, based on `github/prepare-1.5.0` (`bfa8119`)

## Completed

- `c610dde`: extracted the pure `SyncStatusService` classifier.
- `9cefb25`: moved the status map and subscriptions into that service. `SyncManager.status` is the plugin-wide instance; `updateMetadata()` publishes `synced` with the confirmed SHA. A live Sync Status View subscribes to the same state, so Ribbon/context-menu pushes update it without a manual refresh.
- `SyncStatusView` retains presentation-only state (filters, selection, expanded folder groups) and uses the service for all file-status reads/writes.
- Move remains conservative: a row is only `moved` when `renamedFrom` metadata exists or the existing unique-SHA out-of-band reconciliation creates it. A never-pushed file stays `unsynced` after rename.

## Verification

```
npx eslint .    -> 0 errors
npm run build   -> passes (including Obsidian 1.11.0 compatibility)
npx vitest run  -> 31 files, 470 tests passed
```

## Exact Next Step

Push `codex/sync-status-service-1-5` to `github`, then open a PR targeting `prepare-1.5.0`. Manual Obsidian verification remains outstanding for the user-visible status flows.
