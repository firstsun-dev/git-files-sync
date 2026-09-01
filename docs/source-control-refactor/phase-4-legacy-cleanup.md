# Phase 4 — Legacy Cleanup

> **Historical migration roadmap. Do not use as current implementation
> guidance.** See `docs/source-control.md` for the current architecture.

## Goal

移除舊 Source Control orchestration，保留同步核心能力。

## Remove

- old status mapping
- duplicated action handling
- legacy SyncStatusView logic

## Final Architecture

```
UI
 |
ViewModel
 |
ActionService
 |
SyncPlan
 |
Executor
 |
Provider
```

## SyncManager

Before:

- UI state
- classification
- execution

After:

- sync facade

## Test Cleanup

Remove:

- duplicated implementation tests

Keep:

- sync integration tests
- provider tests
- conflict tests

## Acceptance

- UI has no sync logic
- no duplicate action pipeline
- existing behavior preserved
- architecture docs updated
