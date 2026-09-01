# Phase 1 — Source Control ViewModel Foundation

> **Historical migration roadmap. Do not use as current implementation
> guidance.** See `docs/source-control.md` for the current architecture.

## Goal

建立 Source Control UI 與 Sync domain 之間的 ViewModel layer。

本階段不修改同步行為，只整理資料流。

## Scope

- ChangeRepository
- SourceControlFilter
- SourceControlViewModel
- ChangeTreeBuilder

## Architecture

```
UI
 |
SourceControlViewModel
 |
SyncManager
```

## Modules

```
src/logic/source-control/
├── ChangeRepository.ts
├── SourceControlFilter.ts
├── SourceControlViewModel.ts
└── ChangeTreeBuilder.ts
```

## Filter

Supported:

- all
- changes
- ready-to-push
- remote-changes
- conflicts
- synced

## Rules

UI components consume ViewModel only.

No direct SyncManager access from UI.

## Tests

- ChangeRepository
- SourceControlViewModel
- ChangeTreeBuilder

Cases:

- local changes
- remote changes
- conflicts
- ready to push
- rename keeps ChangeId
