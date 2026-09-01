# Source Control — Current Architecture

The Source Control side panel is the plugin's only sync UI. There is no
separate "sync status" view; `docs/source-control-refactor/` describes the
historical migration into this architecture and is not current guidance.

## Call chain

```
SourceControlItemView (src/ui/source-control/SourceControlItemView.ts)
  └─ SourceControlView (src/ui/source-control/SourceControlView.ts)
       └─ SourceControlActionService (src/logic/source-control/SourceControlActionService.ts)
            └─ SyncWorkspace (src/logic/sync/SyncWorkspace.ts)
                 └─ SyncManager + executors (src/logic/sync/, e.g. PushExecutor,
                    PullExecutor, RemoteDeleteExecutor)
```

- `SourceControlItemView` is the `ItemView` Obsidian mounts; it owns no
  rendering logic itself and delegates to `SourceControlView`.
- `SourceControlView` renders the change tree, Sync Queue, and diff surfaces
  (`src/ui/components/`, `src/ui/source-control/DiffTabView.ts`), and turns
  clicks into calls on `SourceControlActionService`.
- `SourceControlActionService` converts Source Control intent (push / pull /
  delete-remote / delete-local / resolve-conflict) into `SyncWorkspace` calls
  and reports outcome via `OperationState`. It never talks to a git provider
  directly.
- `SyncWorkspace` is the execution boundary: it drives the real `SyncManager`
  and provider-mutating executors (`PushExecutor`, `PullExecutor`,
  `RemoteDeleteExecutor`, etc.), which in turn call `GitServiceInterface`
  (`src/services/`).

## Compatibility identifiers (do not remove)

- `SOURCE_CONTROL_VIEW_TYPE = 'sync-status-view'` — kept so pinned leaves and
  saved workspace layouts from before the Source Control migration resolve to
  the current `SourceControlItemView` instead of breaking.
- The `open-sync-status` command id — same reason; it already routes to
  `activateSourceControlView()`.

## Legacy surface (removed, do not reintroduce)

`SyncStatusView` and `ui/sync-status/*` were the pre-migration UI and no
longer exist in `src/`. An ESLint `no-restricted-imports` rule
(`eslint.config.*`) blocks reintroducing imports from those paths.
