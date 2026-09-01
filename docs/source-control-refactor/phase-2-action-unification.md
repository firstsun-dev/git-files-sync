# Phase 2 — Sync Action Unification

> **Historical migration roadmap. Do not use as current implementation
> guidance.** See `docs/source-control.md` for the current architecture.

## Goal

統一 Source Control、Context Menu、Single File 操作的 pipeline。

## Architecture

```
User Action
    |
SourceControlActionService
    |
SyncPlan
    |
SyncExecutor
    |
Git Provider
```

## New Module

```
src/logic/source-control/
└── SourceControlActionService.ts
```

## Actions

- Push
- Pull
- Delete Remote
- Delete Local
- Resolve Conflict

## Rules

ActionService:

DO:
- convert user intent to SyncPlan

DO NOT:
- execute git operation
- classify changes

## Flows

Single file:

```
changeId
 -> ActionService
 -> SyncPlan
 -> Executor
```

Batch:

```
changeIds
 -> ActionService
 -> SyncPlan
```

## Tests

- single push
- batch push
- pull
- conflict resolution
- invalid ChangeId
