# Test Matrix

This document is the high-level test catalog for Git File Sync. It classifies product behaviors by risk and shows which testing layers currently protect them.

Priority is a **product-risk classification**, not an implementation order.

| Priority | Meaning |
|---|---|
| **P0** | Release-critical correctness or data safety. Failure can cause data loss, silent overwrite, broken core synchronization, or a release that should not ship. |
| **P1** | Important functionality, common edge cases, provider differences, or correctness problems that are serious but usually recoverable. |
| **P2** | Lower-frequency edge cases, UX behavior, and defensive coverage that should not normally block a release by itself. |

Coverage legend:

- `✅` automated coverage exists at this layer
- `◐` partial or indirect coverage exists
- `—` not applicable / intentionally covered elsewhere
- `Planned` identified gap, not yet implemented

For scenario rationale, see [`test-scenarios.md`](test-scenarios.md). For code-level inventory, see [`docs/test-coverage.md`](../test-coverage.md). For the real-provider harness, see [`real-provider-e2e.md`](real-provider-e2e.md).

## Core synchronization

| ID | Priority | Scenario | Unit / Integration | Real-provider E2E | Packaged black-box | Expected outcome |
|---|---|---|:---:|:---:|:---:|---|
| SYNC-001 | **P0** | Push a new local file | ✅ | ✅ | Planned | Remote file is created with identical content and sync metadata is recorded. |
| SYNC-002 | **P0** | Push a modified file | ✅ | ✅ | Planned | Remote content is updated without losing unrelated repository state. |
| SYNC-003 | **P0** | Pull a remote update | ✅ | ✅ | Planned | Local vault receives the exact remote content and metadata advances. |
| SYNC-004 | **P0** | Pull a remote-only file | ✅ | ◐ | Planned | Missing local file is created safely. |
| SYNC-005 | P1 | Push an unchanged file | ✅ | ✅ | Planned | No unnecessary remote mutation or commit is created. |
| SYNC-006 | **P0** | Batch push | ✅ | ✅ | Planned | All intended files are synchronized and the batch commit shape is correct. |
| SYNC-007 | P1 | Batch partial failure | ✅ | — | — | Failed files are reported without hiding successful results. |
| SYNC-008 | **P0** | Delete remote file | ✅ | ✅ | Planned | Only the intended path is deleted and local sync metadata is cleared. |

## Conflict and data safety

| ID | Priority | Scenario | Unit / Integration | Real-provider E2E | Packaged black-box | Expected outcome |
|---|---|---|:---:|:---:|:---:|---|
| SAFE-001 | **P0** | Remote changed since last sync | ✅ | ✅ | Planned | Stale baseline is detected before overwrite. |
| SAFE-002 | **P0** | Local and remote both changed | ✅ | ✅ | Planned | Neither side is silently overwritten. |
| SAFE-003 | **P0** | Resolve conflict by keeping local | ✅ | — | Planned | Local content becomes authoritative only after explicit resolution. |
| SAFE-004 | **P0** | Resolve conflict by keeping remote | ✅ | — | Planned | Remote content becomes authoritative only after explicit resolution. |
| SAFE-005 | **P0** | Skip unresolved conflict | ✅ | ✅ | Planned | Remote state remains unchanged and metadata is not falsely advanced. |
| SAFE-006 | P1 | Provider write fails | ✅ | ◐ | — | Failure surfaces to the caller and state remains recoverable. |

## Rename and move integrity

| ID | Priority | Scenario | Unit / Integration | Real-provider E2E | Packaged black-box | Expected outcome |
|---|---|---|:---:|:---:|:---:|---|
| MOVE-001 | **P0** | Rename a synchronized file | ✅ | ✅ | Planned | Old path disappears and new path contains identical content. |
| MOVE-002 | **P0** | Rename/move is represented atomically | ◐ | ✅ | Planned | Move is committed without an intermediate duplicate/loss state. |
| MOVE-003 | P1 | Rename inside batch | ✅ | ◐ | — | Rename does not corrupt other batch operations. |
| MOVE-004 | P1 | Rename failure | ✅ | — | — | Error is surfaced and metadata remains consistent. |

## Filesystem, path, and content handling

| ID | Priority | Scenario | Unit / Integration | Real-provider E2E | Packaged black-box | Expected outcome |
|---|---|---|:---:|:---:|:---:|---|
| PATH-001 | **P0** | `vaultFolder` path mapping | ✅ | — | Planned | Local path maps to the correct repository-relative path. |
| PATH-002 | **P0** | `rootPath` mapping | ✅ | ◐ | Planned | Repository prefix is applied exactly once and cannot collide with siblings. |
| PATH-003 | P1 | Nested directory creation | ✅ | ◐ | — | Required parent directories are created safely. |
| PATH-004 | P1 | Hidden files/directories | ✅ | — | — | Hidden paths synchronize when not ignored. |
| FILE-001 | **P0** | Binary push preserves bytes | ✅ | — | Planned | Remote bytes match local bytes exactly. |
| FILE-002 | **P0** | Binary pull preserves bytes | ✅ | — | Planned | Local bytes match remote bytes exactly. |
| FILE-003 | P1 | Binary unchanged detection | ✅ | — | — | Equal binary contents do not cause unnecessary writes. |

## Ignore behavior

| ID | Priority | Scenario | Unit / Integration | Real-provider E2E | Packaged black-box | Expected outcome |
|---|---|---|:---:|:---:|:---:|---|
| IGN-001 | P1 | Root `.gitignore` | ✅ | — | — | Ignored files are excluded from synchronization. |
| IGN-002 | P1 | Nested `.gitignore` | ✅ | — | — | Nested rules apply within the correct subtree. |
| IGN-003 | P1 | Negated rules | ✅ | — | — | Explicitly re-included files are synchronized. |
| IGN-004 | P1 | Directory-only and deep wildcard rules | ✅ | — | — | Gitignore semantics remain consistent for complex patterns. |

## Common provider contract

These scenarios are executed against real provider implementations. GitHub, GitLab, and Gitea each have dedicated real-provider suites.

| ID | Priority | Scenario | GitHub | GitLab | Gitea | Packaged black-box |
|---|---|---|:---:|:---:|:---:|:---:|
| PROV-001 | **P0** | Repository + branch connectivity | ✅ | ✅ | ✅ | Planned (GitHub canonical) |
| PROV-002 | **P0** | Create file | ✅ | ✅ | ✅ | Planned (GitHub canonical) |
| PROV-003 | **P0** | Read file | ✅ | ✅ | ✅ | Planned (GitHub canonical) |
| PROV-004 | **P0** | Update file | ✅ | ✅ | ✅ | Planned (GitHub canonical) |
| PROV-005 | **P0** | Delete file | ✅ | ✅ | ✅ | Planned (GitHub canonical) |
| PROV-006 | **P0** | Batch write | ✅ | ✅ | ✅ | Planned (GitHub canonical) |
| PROV-007 | **P0** | Rename / move | ✅ | ✅ | ✅ | Planned (GitHub canonical) |

> Current harness support does not mean every provider leg is equally stable in CI. See [`real-provider-e2e.md`](real-provider-e2e.md) for current runner-specific limitations.

## Provider-specific regressions

| ID | Priority | Provider | Scenario | Coverage | Expected outcome |
|---|---|---|---|:---:|---|
| GH-001 | P1 | GitHub | Create Git symlink | ✅ | Blob mode is `120000` and content is the link target. |
| GH-002 | **P0** | GitHub | GraphQL HTTP 200 with `errors[]` | ✅ | Operation rejects and repository remains unchanged. |
| GH-003 | **P0** | GitHub | Concurrent writes / stale `expectedHeadOid` | ✅ | Retry/self-heal preserves both intended writes. |
| GL-001 | **P0** | GitLab | Separate blob SHA from optimistic-lock revision | ✅ | Pull-edit-push succeeds without false conflict. |
| GL-002 | **P0** | GitLab | Genuine stale revision | ✅ | Stale write is rejected and concurrent remote content survives. |
| GL-003 | P1 | GitLab | Historical SHA-as-revision bug reproduction | ✅ | Regression remains demonstrably reproducible and guarded. |
| GL-004 | P1 | GitLab | Batch push after pull | ✅ | Batch write succeeds using correct revision semantics. |

## CI and operational regression protection

| ID | Priority | Scenario | Coverage | Expected outcome |
|---|---|---|:---:|---|
| CI-001 | P1 | Provider-relevant path detection | ✅ | Expensive provider E2E runs only when relevant, except full scheduled/main runs. |
| CI-002 | **P0** | E2E failure gates release | ✅ | A real provider regression prevents the downstream release workflow. |
| CI-003 | P1 | Scheduled API-drift check | ✅ | Provider regressions can be detected without a code change. |
| CI-004 | P1 | Cleanup after E2E | ✅ | Isolated branches/instances are removed after the run. |
| CI-005 | P1 | Fork PR secret isolation | ✅ / limited while Gitea CI leg is disabled | Repository secrets are not exposed to untrusted fork code. |

## Planned packaged-plugin black-box P0 suite

The black-box suite is intentionally small. It should validate user-observable behavior from a fresh vault using the packaged plugin artifact and a dedicated GitHub sandbox branch. Internal classes must not be imported by these scenarios.

| ID | Priority | User journey | Status |
|---|---|---|---|
| BB-001 | **P0** | Fresh vault -> install plugin -> configure GitHub -> push new files -> verify remote | Planned |
| BB-002 | **P0** | Remote mutation -> plugin pull -> verify vault | Planned |
| BB-003 | **P0** | Local + remote divergence -> conflict -> no silent overwrite | Planned |
| BB-004 | **P0** | Rename/move -> push -> old path absent, new path correct | Planned |
| BB-005 | **P0** | Batch push from vault -> one correct remote state | Planned |
| BB-006 | **P0** | Delete -> verify intended remote path only | Planned |
| BB-007 | **P0** | Binary round-trip | Planned |

These scenarios are intended to be the refactoring guardrail: internal architecture may change, but existing P0 black-box scenarios should not need modification unless the product contract intentionally changes.

## Compatibility matrix

Provider-version compatibility is planned separately from functional correctness.

| ID | Priority | Target | Status |
|---|---|---|---|
| COMPAT-001 | P1 | Gitea minimum supported version | Planned |
| COMPAT-002 | P1 | Representative Gitea current/stable version | Planned |
| COMPAT-003 | P1 | GitLab minimum supported version | Planned |
| COMPAT-004 | P1 | Representative GitLab current/stable version | Planned |

The version matrix should run the same provider contract rather than creating version-specific test semantics.

## P0 release contract

A release should not proceed when automated P0 coverage that is part of the release gate fails.

The P0 contract protects:

1. push / pull correctness
2. conflict and overwrite safety
3. rename / delete integrity
4. batch synchronization
5. binary-content integrity where automated
6. repository path mapping
7. common provider CRUD / batch / rename contract
8. provider-specific concurrency and optimistic-locking correctness

The planned packaged-plugin black-box suite will strengthen this contract further by validating the complete GitHub user journey independently of internal module structure.
