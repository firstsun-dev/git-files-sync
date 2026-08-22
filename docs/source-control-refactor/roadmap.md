# Source Control Refactor — Roadmap (v2)

> Supersedes `phase-1..4-*.md`. Those phase docs are kept only as historical
> design notes; this file is the authoritative current plan, grounded in the
> actual branch state as of 2026-08-22.

## Where we actually are

The committed branch `claude/source-control-foundation` (7 commits, 34 files,
+2378) delivered the **foundation** in three commits:

- ✅ Phase 1 — ViewModel foundation: `ChangeRepository`, `SourceControlFilter`,
  `SourceControlViewModel`, `ChangeTreeBuilder` (`76db082`)
- ✅ Phase 2 — Action unification: `SourceControlActionService` over
  `SyncWorkspace` (`70f6c9e`)
- ✅ Phase 3 — Source Control UI skeleton: `SourceControlView` + components
  (`7cec661`)

On top of that, the **active agent worktree** carries uncommitted WIP that
already performs **Phase A (wire new view as the only entry) and Phase E
(delete the legacy UI) together**, and it is verified green:

```
npx eslint .   -> 0 errors
npm run build  -> PASS (tsc + Obsidian 1.11.0 compat + esbuild)
npx vitest run -> 55 files / 531 tests PASS
```

WIP contents (all uncommitted):

- `src/main.ts`: registers `SourceControlItemView` under the **legacy** view
  type string `sync-status-view` (so pinned leaves migrate cleanly), rewires
  ribbon + `open-sync-status` command + startup refresh to
  `activateSourceControlView()`, constructs `ChangeRepository` /
  `PushSelectionStore` / `OperationState` / `SourceControlViewModel` /
  `SourceControlActionService` on the plugin, subscribes
  `sync.status` → `ChangeRepository.replace(toSyncChanges(...))`, and
  unsubscribes in `onunload`.
- `src/ui/source-control/SourceControlItemView.ts` (new, 78 lines): thin
  `ItemView` host that delegates rendering to `SourceControlView` and routes
  `onPush` / `loadDiffContent` to `plugin.sourceControlActions`.
- `src/logic/source-control/FileStatusAdapter.ts` (new, 57 lines):
  `toSyncChanges(statuses)` — the adapter from the existing
  `SyncStatusService` status map into `SyncChange[]` for `ChangeRepository`.
- Deletes: `src/ui/SyncStatusView.ts`, `src/ui/DiffView.ts`, all
  `src/ui/components/{ActionBar,FileListItem,FolderTreeItem,StatusTree}.ts`,
  all `src/ui/sync-status/*.ts`, and their tests.
- `styles.css`: −547 / +174 (legacy tree styles removed).

**Consequence:** the next agent must NOT redo Phase A or Phase E. They exist
as green WIP. The next agent's job is to (1) land that WIP with manual Obsidian
verification, then (2) move to Phase B.

## Architecture (verified against source)

```
SyncChange ── FileStatusAdapter ──▶ ChangeRepository
                                          │
                                 SourceControlViewModel ◀── PushSelectionStore
                                          │                  OperationState
                          ┌───────────────┴────────────────┐
                        Filter                            Selection
                          └───────────────┬────────────────┘
                                          ▼
                        SourceControlItemView (ItemView host, 78 lines)
                                          │ delegates render
                                          ▼
                                  SourceControlView (render, 204 lines)
                                          │ callbacks
                                          ▼
                          SourceControlActionService
                                          │
                                          ▼
                              SyncWorkspace (push/pull/delete/diff)
                                          │
                                          ▼
                          SyncManager → Provider
```

Entry wiring (Phase A, done as WIP): ribbon + command + startup →
`activateSourceControlView()` → `SOURCE_CONTROL_VIEW_TYPE` leaf →
`SourceControlItemView`.

## Phase A — Wire existing UI entry  ✅ DONE (uncommitted, green WIP)

See WIP contents above. Acceptance already met at the automated level:
new view is the sole registered entry; ribbon/command/startup all route
through it; old UI deleted.

**Remaining for "done" per DoD:** manual Obsidian verification in a real vault
(ribbon opens the new panel, tree/filter/push render, live modify/rename
refresh, pinned leaf migration, `onunload` cleanup). Then commit the WIP.

## Phase E — Legacy cleanup  ✅ DONE (same WIP as Phase A)

Old `SyncStatusView`, `DiffView`, `components/*`, `sync-status/*` and their
tests deleted; `styles.css` trimmed. No duplicate action handlers remain
(commands go through `SourceControlActionService`). Lands together with
Phase A.

## Phase B — Surface conflict as domain state  ◀ NEXT (real gap)

This is the largest real gap and the user's risk #2/#3. The conflict model
**already exists** in the executor layer — it must be *surfaced*, not
recreated:

- `src/logic/sync/types.ts`: `PushResults` already carries
  `conflicts`, `resolvedConflicts`, `skippedConflicts`, `conflictedPaths`,
  `errors`; `SyncResult` carries `conflicts` count.
- `src/logic/sync/ConflictResolver.ts`: `BatchPushConflict`,
  `findStale`, `applyRemote` — full conflict lifecycle.
- `src/logic/sync/PullCoordinator.ts`: `BatchOutcome = 'done' | 'unchanged' | 'conflict'`.

The gap is entirely in the Source Control layer:

1. **`OperationState`** (`src/logic/source-control/OperationState.ts`) only has
   `OperationStatus = 'idle' | 'running' | 'success' | 'failed'`. Add
   `'conflict'` (a.k.a. needs-resolution) — a **different lifecycle** from
   `'failed'` (resolvable, not an error).
2. **`SourceControlActionService.push/pull`** currently does
   `finishAll(targets, path => failed.has(path) ? 'failed' : 'success')`
   reading only `results.errors`. It must instead read
   `results.conflictedPaths` (and/or `results.conflicts > 0`) and mark those
   `'conflict'`, leaving genuine errors as `'failed'`. Reuse the executor's
   conflict semantics — do **not** create a parallel `ConflictState.ts`.
3. **`ExecutionResult`** (new, thin projection — *not* a new executor): batch
   push/pull return `{ completed: ChangeId[]; conflicts: ChangeId[]; failed:
   ChangeId[] }` so the UI can show "7 success, 3 conflict" instead of just
   success/failed. This is a projection of `PushResults`/`SyncResult`, derived
   in `SourceControlActionService`, not a new sync-domain type.
4. **`SourceControlViewModel`** surfaces conflict count + the conflict item
   list; `SourceControlFilter` already has a `'conflicts'` filter value — wire
   it to the new `'conflict'` operation status.
5. UI: a `CONFLICTS (n)` section listing conflicted changes with a
   `[Resolve All]` entry point (resolution UX is Phase C).

Tests first (TDD): `OperationState` conflict status; `ActionService` maps
`conflictedPaths` → `'conflict'` and returns `ExecutionResult` counts;
`ViewModel` exposes conflict list/count; filter `'conflicts'` resolves to the
new status.

## Phase C — Diff / conflict resolution UX

Reuses the existing `SyncWorkspace.getDiff` / `SyncDiffService` path that
`SourceControlActionService.loadDiffContent` already calls — no new diff
logic, only layout + resolution actions.

New UI:

- `src/ui/source-control/ConflictPanel.ts` — the `CONFLICTS (n)` list +
  per-item actions.
- `src/ui/source-control/DiffLayoutSelector.ts` — Desktop: `Tree | Diff`
  split; Mobile: `List → Diff` stack.

Actions (route through `SourceControlActionService.resolveConflict`, which
already exists for `'local' | 'remote'`):

- Accept Local → `resolveConflict(id, 'local')` (push local)
- Accept Remote → `resolveConflict(id, 'remote')` (pull remote)
- Manual Merge → opens an editor merge path (new; scope TBD).

## Phase D — Context menu migration

Currently no context menu in the new UI (verified: no `contextmenu` /
`addMenu` references in `src/ui/source-control/`). Unify right-click on a
change row:

```
Right-click on change row
  → changeId
  → SourceControlActionService.{push|pull|deleteRemote|deleteLocal|resolveConflict|loadDiffContent}
```

Menu items: Push, Pull, Open Diff, Delete Remote, Delete Local, Resolve
Conflict. No direct `SyncWorkspace`/`GitService` access from the menu — only
through `SourceControlActionService`.

## Ordering & risk notes

```
PR #127 foundation (merged)
        │
        ▼
A + E  ── land the green WIP: commit + manual Obsidian verify   ◀ do first
        │
        ▼
B  ── surface executor conflict state via OperationState + ExecutionResult
        │
        ▼
C  ── diff / conflict resolution UX (reuses existing diff path)
        │
        ▼
D  ── context menu → ActionService
```

Risk notes from the review, confirmed against source:

1. **`SourceControlView.ts` is 204 lines** — but the WIP already split the
   `ItemView` host (`SourceControlItemView`, 78 lines) from the render logic.
   Do not grow `SourceControlView` further; keep it a pure renderer over the
   ViewModel.
2. **Conflict ≠ failed.** `OperationState` must distinguish `'conflict'`
   (needs-resolution, resolvable) from `'failed'` (error). Different
   lifecycle. Phase B.
3. **Batch needs `ExecutionResult`.** Without it the UI can only show
   success/failed, not "7 success, 3 conflict". Phase B.