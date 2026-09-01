# Architecture

This document is the canonical architecture guide for the current `git-files-sync` implementation.

Historical design notes and refactor plans are useful context, but they are **not** current implementation guidance. When code and an old plan disagree, follow this document and the current code boundaries.

## 1. System layers

```text
Obsidian / UI
    ↓
Source Control application layer
    ↓
SyncWorkspace
    ↓
Sync domain
    ↓
GitServiceInterface
    ↓
GitHub / GitLab / Gitea
```

The dependency direction should normally flow downward. Results and state flow back upward through return values, stores, subscriptions, or interaction ports rather than by introducing reverse imports.

## 2. High-level modules

| Layer | Module | Owns | Interacts with | Must not own |
| --- | --- | --- | --- | --- |
| Plugin runtime | `src/main.ts` | Obsidian lifecycle, command/view/event registration | settings, `createSyncRuntime`, UI | sync/Source Control constructor graph, sync planning, conflict algorithms, provider-specific workflow |
| Plugin runtime | `createSyncRuntime` (`src/runtime/createSyncRuntime.ts`) | wires `SyncManager`, `SyncStatusRefreshService`, `SyncDiffService`, `SyncWorkspace`, and the Source Control application layer together | the constructors it composes | Obsidian lifecycle events, commands, views, ribbons |
| UI | `src/ui/source-control/*` | rendering, user interaction, Source Control composition | `SourceControlViewModel`, `SourceControlActionService` | provider API calls, sync classification rules |
| Application | `ChangeRepository` | authoritative Source Control `SyncChange` snapshot | `FileStatusAdapter`, ViewModel, action services | remote Git or filesystem access |
| Application | `SyncSelectionStore` | queued selection and explicit per-change action override | ViewModel, current repository snapshot | sync execution |
| Application | `ChangeActionPolicy` | allowed/default action for each change kind | ViewModel, selection reconciliation, intent execution | UI rendering, network calls |
| Application | `SourceControlViewModel` | read-only projection of application state for UI | repository, selection, operation/refresh state | side effects, provider calls, filesystem writes |
| Application | `SourceControlActionService` | stable UI-facing facade for immediate Source Control commands | `SyncWorkspace`, `SyncIntentExecutor` | provider-specific logic, duplicated sync planning |
| Application | `SyncIntentExecutor` | one Sync Queue workflow: resolve intent, plan, confirm, execute, aggregate | repository, action policy, `SyncWorkspace`, notifier | UI DOM, provider API implementation |
| Boundary | `SyncWorkspace` | application-to-sync execution boundary | `SyncManager`, refresh service, diff service | Source Control rendering |
| Sync domain | `SyncManager` | compatibility/domain facade for sync operations | coordinators, executors, metadata/status services | Source Control UI state |
| Sync domain | `PushCoordinator` | batch push use case including planning/conflict/review/commit coordination | planner, conflict resolver, push executor | Source Control selection state |
| Sync domain | `PullCoordinator` | batch pull planning and application | pull executor, conflict flow | Source Control UI rendering |
| Sync domain | `SyncPlanner` | sync plan construction | coordinators | network/UI side effects |
| Sync domain | `ConflictResolver` | conflict validation and resolution coordination | interaction port, provider state | Source Control rendering |
| Sync domain | `PushExecutor` | provider-side batch mutations | `GitServiceInterface`, metadata | UI state |
| Sync domain | `PullExecutor` | local file application for pulls | Obsidian vault, metadata | Source Control UI state |
| Sync domain | `RemoteDeleteExecutor` | remote deletion execution | `GitServiceInterface` | UI |
| Sync domain | `SyncStatusRefreshService` | orchestrates discovery → resolve → reconcile → publish, plus incremental create/modify/delete/rename event handling | `SyncFileDiscovery`, `SyncStatusResolver`, `RenameReconciler`, status store | Source Control rendering, the three algorithms below (delegates to their owning class) |
| Sync domain | `SyncFileDiscovery` | vault/hidden-file/remote-tree/gitignore/symlink discovery, remote-only vs local-deleted classification | vault, provider, gitignore, status store | status resolution, rename reconciliation |
| Sync domain | `SyncStatusResolver` | local-vs-remote status resolution: SHA/content comparison, baseline diff direction, `FileStatus` classification | provider, sync manager, status store | discovery, rename reconciliation |
| Sync domain | `RenameReconciler` | out-of-band (external) rename detection by orphan/candidate blob-sha matching | sync manager, status store | discovery, status resolution |
| Sync domain | `SyncStatusService` | observable `FileStatus` store and status classification | refresh/sync domain, adapters | UI orchestration |
| Sync domain | `SyncMetadataStore` | last-synced SHA and rename metadata persistence | manager/executors/coordinators | presentation |
| Sync domain | `SyncDiffService` | diff content/stat loading and cache | status store, blob loader, workspace, `DiffStat` | sync orchestration |
| Sync domain | `DiffStat` (`src/logic/sync/DiffStat.ts`) | pure +/- diff-stat computation and the `DiffStatLoadResult` contract | diff utilities | UI rendering, provider calls |
| Interaction boundary | `SyncInteractionPort` | domain-facing confirmation/conflict interaction contract | domain, Obsidian adapter | provider implementation |
| UI adapter | `ObsidianSyncInteraction` | Obsidian modal/notice implementation of interaction port | `SyncInteractionPort`, modal UI | sync algorithms |
| Infrastructure | `GitServiceInterface` | provider abstraction used by the sync domain | concrete provider services | UI/application state |
| Infrastructure | `BaseGitService` | shared provider HTTP, encoding and error behavior | concrete provider services | sync workflow |
| Infrastructure | `GitHubService` / `GitLabService` / `GiteaService` | provider-specific Git API behavior | remote Git service | Source Control UI |
| Infrastructure | `GitignoreManager` | `.gitignore` evaluation for remote/local scope | refresh/scanning logic | UI behavior |
| Shared | settings model/helpers | persisted configuration and configuration rules | runtime, providers, sync | settings rendering concerns when avoidable |
| Shared | `utils/*` | low-level reusable helpers | low-level consumers | application workflow state |

## 3. Core runtime flows

### Status/read flow

```text
Vault + Remote Git
    ↓
SyncStatusRefreshService
    ↓
SyncStatusService
    ↓
FileStatusAdapter
    ↓
ChangeRepository
    ↓
SourceControlViewModel
    ↓
SourceControlView
```

Status classification belongs in the sync/status path. The UI must not repair or reinterpret an incorrect status by adding presentation-only exceptions.

### Immediate action flow

```text
SourceControlView
    ↓
SourceControlActionService
    ↓
SyncWorkspace
    ↓
SyncManager / executors
    ↓
GitServiceInterface or Obsidian Vault
```

### Sync Queue flow

```text
SourceControlView
    ↓
SourceControlActionService.sync()
    ↓
SyncIntentExecutor
    ↓
resolve current ChangeId + revalidate explicit action
    ↓
build one merged Sync Plan
    ↓
confirm once
    ↓
SyncWorkspace
    ├─ remote mutation bucket (max one provider batch)
    └─ local pull bucket
```

## 4. Architecture rules

### MUST

- Source Control execution must cross the sync boundary through `SyncWorkspace`.
- `SourceControlViewModel` reads must be observational and side-effect free.
- Provider-specific behavior must stay behind `GitServiceInterface` and concrete provider services.
- A status/change classification rule must have one source of truth rather than being duplicated in UI and domain code.
- Explicit Sync Queue actions must be revalidated against the current change kind immediately before planning/execution.
- One Sync Queue action must produce one merged review/confirmation flow.
- Remote mutations from one Sync Queue execution must be grouped into at most one provider mutation batch when supported by the current workflow.
- Existing compatibility identifiers such as `sync-status-view` and `open-sync-status` must be preserved unless a migration explicitly removes them.

### MUST NOT

- UI code must not import concrete `GitHubService`, `GitLabService`, or `GiteaService` to fix a feature or bug.
- Source Control application code must not bypass `SyncWorkspace` to call `SyncManager`, coordinators, executors, or providers directly.
- Sync-domain modules must not import `src/ui/source-control/*`.
- `getState()`, render methods, or projection helpers must not mutate selection, metadata, filesystem, or remote state.
- Bug fixes must not duplicate status, rename, conflict, or action-selection rules in a second layer.
- Provider differences must not be handled by scattering `serviceType === ...` checks through Source Control or UI code when the provider abstraction can own the behavior.

## 5. Change placement guide

Use the owning module first. The shortest patch is not automatically the correct patch.

| Problem | Primary owner | Do not fix by |
| --- | --- | --- |
| Source Control displays the wrong label/icon/layout | UI presentation / `SourceControlViewModel` projection | changing `SyncManager` |
| A row chooses the wrong push/pull/delete action | `ChangeActionPolicy`, `SyncSelectionStore`, or `SyncIntentExecutor` | adding special-case `if` logic in `SourceControlView` |
| A file is classified incorrectly (`modified`, `remote-only`, `local-deleted`, conflict direction) | `SyncStatusRefreshService` / `SyncStatusService` classification path | correcting the status only in UI |
| Local/remote files are missing from refresh results | `SyncStatusRefreshService`, scope/gitignore logic | fetching the provider directly from ViewModel/UI |
| Rename/move is detected incorrectly | sync metadata + rename reconciliation in the sync refresh/domain path | duplicating rename detection in UI or provider service |
| Push plan/conflict behavior is wrong | `PushCoordinator`, `SyncPlanner`, `ConflictResolver` | reproducing the algorithm in `SourceControlActionService` |
| Pull application is wrong | `PullCoordinator` / `PullExecutor` | adding filesystem writes to ViewModel/UI |
| GitHub-only API behavior is wrong | `GitHubService` (or shared `BaseGitService` if common) | checking GitHub inside Source Control application code |
| GitLab/Gitea/provider-common HTTP behavior is wrong | provider implementation or `BaseGitService` | copy/pasting workarounds into all callers |
| Diff content/stat is wrong | `SyncDiffService` / diff presentation components depending on the defect | performing ad-hoc provider reads from the row component |

If the owning module cannot fix a bug without crossing a forbidden boundary, improve the boundary first instead of adding a shortcut.

## 6. Current hotspots

Some current modules have high responsibility density. That is not permission to bypass them, and file size alone is not a reason to split them.

- `main.ts`: reduced to Obsidian lifecycle (settings load/save, command/view/ribbon/vault-event registration). The sync/Source Control constructor graph now lives in `createSyncRuntime` (`src/runtime/createSyncRuntime.ts`).
- `SyncStatusRefreshService`: reduced to orchestration (discovery → resolve → reconcile → publish) plus the incremental create/modify/delete/rename handlers. Discovery, status resolution, and rename reconciliation each now have a single owner: `SyncFileDiscovery`, `SyncStatusResolver`, `RenameReconciler`.
- `SourceControlView`: reduced by extracting the "Sync Queue" and "Repository Changes" regions into `SyncQueueSection`/`RepositoryChangesSection` (`src/ui/source-control/`, pure state+callbacks render functions matching `FilterMenu`/`SourceControlHeader`). Still owns the diff pane, scroll-state management, and section composition.
- `PushCoordinator`: large, but still centered on one batch-push use case; split only when a stable responsibility boundary is identified.

Future refactors should reduce these hotspots while preserving the dependency direction in this document.

## 7. Documentation hierarchy

- `docs/architecture.md` — canonical repo-wide architecture and dependency rules.
- `docs/source-control.md` — current Source Control subsystem details and invariants.
- `docs/bug-fix-guidelines.md` — required workflow for bug fixes and small changes.
- `docs/source-control-refactor/*` — historical migration/refactor records only; not current implementation guidance.

When an architectural boundary changes, update this document in the same PR as the code change.
