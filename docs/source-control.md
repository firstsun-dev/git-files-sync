# Source Control — Current Architecture

The Source Control side panel is the plugin's only sync UI. Historical
migration notes live under `docs/source-control-refactor/`; they are not
current implementation guidance.

## Call chain

```text
SourceControlItemView
  └─ SourceControlView
       ├─ SourceControlViewModel        # read-side projection
       └─ SourceControlActionService    # immediate action facade
            ├─ SyncIntentExecutor       # Sync Queue use-case only
            └─ SyncWorkspace            # immediate actions
                 └─ SyncManager + executors
                      └─ GitServiceInterface
```

## Responsibility boundaries

- `ChangeRepository` is the authoritative Source Control snapshot populated
  from `sync.status`. Snapshot replacements notify dependent read-side state.
- `SyncSelectionStore` owns queued selection plus explicit per-change action
  overrides. It reconciles stale selection/overrides when the repository
  snapshot changes.
- `SourceControlViewModel` is a read-only projection. `getState()` must not
  mutate selection or execution state.
- `SourceControlActionService` is the UI-facing facade for immediate push,
  pull, delete, conflict resolution, diff loading, and the stable `sync()`
  entry point.
- `SyncIntentExecutor` owns the Sync Queue workflow: resolve current intent,
  bucket by action, build one merged plan, confirm once, commit the remote
  mutation bucket once, apply the local pull bucket, and aggregate results.
- `SyncWorkspace` remains the execution boundary. Source Control code never
  talks directly to a provider.

## Sync Queue invariant

One Sync click produces one explicit-intent workflow. Requested action
choices are revalidated against the change's current kind before execution;
a stale/illegal override falls back to the current default. Remote mutations
(push/move/delete/keep-local/keep-remote) are committed as one provider
batch, while pulls are local-only and applied after that remote bucket.

## Compatibility identifiers (do not remove)

- `SOURCE_CONTROL_VIEW_TYPE = 'sync-status-view'` — retained so saved/pinned
  leaves from before the Source Control migration continue to resolve.
- `open-sync-status` command id — retained for the same compatibility reason;
  it routes to the current Source Control view.

## Legacy surface (removed, do not reintroduce)

`SyncStatusView` and `ui/sync-status/*` were the pre-migration UI and no
longer exist in `src/`. ESLint restrictions prevent those imports from being
reintroduced.
