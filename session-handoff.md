# Session Handoff

**Date:** 2026-07-28
**Branch:** `codex/sync-status-tree-view`, based on `prepare-1.5.0`

## Completed

- Sync Status now renders a path-derived, collapsible folder tree. `StatusTree` is presentation-only; the existing path-keyed sync state and batch operations are unchanged.
- Folder checkboxes operate on currently visible descendants and use the native indeterminate state for partial selections. Individual file checkboxes remain unchanged.
- The controls directly below Refresh contain Tree view and, when it is enabled, Show synced. Turning off Tree view restores the flat All list with Synced entries last. Folder disclosure is a plain `+` / `−`, avoiding a visual collision with checkboxes.
**Branch:** `prepare-1.5.0`

## Completed

- Startup status refresh is enabled by default via `autoRefreshOnStartup`, with a settings toggle to disable it. The refresh waits for Obsidian layout readiness, then opens and refreshes Sync Status View.
- Sync Status View now renders the Synced tab last and places synced rows at the bottom of All. Added regression coverage.

- `c610dde`: extracted the pure `SyncStatusService` classifier.
- `9cefb25`: moved the status map and subscriptions into that service. `SyncManager.status` is the plugin-wide instance; `updateMetadata()` publishes `synced` with the confirmed SHA. A live Sync Status View subscribes to the same state, so Ribbon/context-menu pushes update it without a manual refresh.
- `e586fc2`: regression test for an unpushed-file rename. `SyncManager.trackRename()` leaves absent metadata absent; the panel then carries the new path as `unsynced` (Local only), without `movedFrom`.
- `61ca728`: direct `SyncManager.pushFile()` checks the current `GitignoreManager` predicate before reading the vault or contacting the provider. `pushAllFiles()` filters ignored paths too; relevant setting changes refresh the ignore manager.
- `ed04867`: restart/out-of-band move reconciliation accepts legacy metadata whose `lastKnownPath` is absent, using the record key as its implied path. The same compatibility rule covers direct Push's fallback rename detection.
- Moved rows now show a Diff action when the old remote blob is available. Status refresh captures that old blob's SHA and current local content; live renames retain the SHA, and subsequent edits refresh the local side without changing the status away from `moved`. The diff fetch uses `movedFrom` as its source path.

## Verification

```
npx eslint .    -> 0 errors
npm run build   -> passes (including Obsidian 1.11.0 compatibility)
npx vitest run  -> 33 files, 490 tests passed
npx vitest run  -> 31 files, 478 tests passed
```

## Exact Next Step

Manually verify the option row below Refresh, the tree/flat switch, Show synced visibility, `+` / `−` disclosure, and individual/folder selection in Obsidian. The original `prepare-1.5.0` worktree is intentionally untouched and has pre-existing uncommitted changes.
Manually verify startup refresh/settings toggle in Obsidian, plus a moved-and-edited text file's Diff action.
