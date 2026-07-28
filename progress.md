# Session Progress Log

Completed work is archived in [archive/](./archive/), one file per calendar month.

## Current State

**Last Updated:** 2026-07-28
**Active Feature:** None — shared sync-status state is complete on `codex/sync-status-service-1-5`, based on `github/prepare-1.5.0`.

## Status

### What's Done

- [x] feat-001..023 and the move-detection fixes — see [archive/2026-07.md](./archive/2026-07.md).
- [x] `refactor(sync-status): centralize status classification` (`c610dde`): introduced a pure `SyncStatusService` and routed full refresh, fallback content comparison, live edits, rename/move, remote-only discovery, and optimistic push completion through its one status policy.
- [x] `refactor(sync-status): share status state with sync manager` (`9cefb25`): the service owns the shared status map and publishes snapshots; SyncManager records confirmed syncs there, and SyncStatusView subscribes instead of holding its own map.
- [x] `test(sync): guard never-pushed rename status` (`e586fc2`): verifies `trackRename` leaves missing metadata absent and the view carries the renamed row as Local only, never as moved.
- [x] `fix(sync): honor ignore patterns for direct push` (`61ca728`): the Ribbon, context-menu, and command single-file Push paths now stop before a vault read or remote call when a user ignore pattern matches. Batch Push filters ignored paths too; saving relevant settings rebuilds the ignore matcher immediately.

### What's In Progress

- None.

### What's Next

1. Push `codex/sync-status-service-1-5` and open a PR into `prepare-1.5.0` when ready.
2. Manually verify the sync panel in Obsidian: new local/remote files, edited synced file, in-app file/folder move, external move with no rename event, and a direct Push of a file matching a newly-added user ignore pattern.
3. Issue #57 live-credential smoke test remains relevant before merging push/pull/delete work.

## Evidence of Completion

- [x] `npx eslint .` — 0 errors
- [x] `npm run build` — passes, including Obsidian 1.11.0 compatibility typecheck
- [x] `npx vitest run` — 31 files, 471 tests passed
- [ ] Manual verification inside Obsidian — outstanding
