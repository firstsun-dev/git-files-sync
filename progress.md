# Session Progress Log

Completed work is archived in [archive/](./archive/), one file per calendar month.

## Current State

**Last Updated:** 2026-08-31
**Active Feature:** Issue #142 — move real-provider E2E from `e2e/` to `e2e-tests/provider/` and replace `E2E_RUNTIME_DIR` per-run generation with committed static runtime files. Working tree changes complete, uncommitted.
**Branch / PR:** `refactor/e2e-tests-scanner-boundary`, branched off `claude/source-control-foundation` (PR #129, still open). Intended to retarget/rebase onto `main` once #129 merges — see #142 for the full plan.

**Open risk, not yet resolved**: this PR's core premise — that a directory rename from `e2e/` to `e2e-tests/` makes committing `fetch`/`node:child_process` `.ts` files scanner-safe — is unverified against the actual Obsidian community-plugin scanner, and contradicts this repo's own prior audit (`docs/obsidian-scanner-audit.md`), which found the scanner flagged those exact APIs while committed under `e2e/` regardless of directory. Proceeded on explicit user instruction; flagged in `docs/testing/real-provider-e2e.md`'s "Known gaps" and `docs/obsidian-scanner-audit.md`'s Phase 2 section. **A real scanner rescan is required before trusting this.**

Below that: the previous "Outstanding Items"/"Verification Evidence" entries track separate, still-open work on PR #129 / `claude/source-control-foundation` — not superseded by this entry.

## Outstanding Items

1. Run the new two-client e2e suite on a Linux/CI shell (local macOS system bash 3.2 can't run `scripts/e2e-harness.sh provision` — pre-existing `${var@Q}` bash-4-ism, not this session's change): `npm run test:e2e -- --provider gitea` exercises `e2e/suites/two-client-sync.e2e.test.ts` (now registered in `scripts/e2e-suites.txt`).
2. Manual Obsidian verification of the prior UI rounds (see handoff); commit working tree; push → CI → merge flow.
3. P0-4 (delete/modify) and P0-5 (rename/modify) are written as SAFETY INVARIANTS, not semantics: if production's current behavior silently loses content, the test goes RED — file `fix(sync): prevent silent data loss on divergent operations` follow-up in that case (per plan, likely a separate PR).
4. Next phases (not started): Phase 4 divergence matrix (add/add, rename/rename, reverse delete/modify, mixed batch), Phase 5 offline/restart, Phase 6 failure/recovery, Phase 7 stress (scheduled/manual only).

## Verification Evidence

This session (follow-up round on the same PR — `test(e2e): isolate and streamline two-client sync scenarios`):

- Phase 1 (correctness, requested follow-up to the prior round): extracted the vaultFolder path-mapping rules (`filterPathByVaultFolder`/`filterFilesByVaultFolder`/`getNormalizedVaultPath`/`getVaultPathFromNormalized`) into a new pure module `src/logic/sync/vault-folder-scope.ts`, shared by `src/main.ts` (delegates now, behavior unchanged), `SyncScanner.toRepoPath` (delegates now, behavior unchanged), and `two-client-sync-scenario.ts`'s `TwoClient` wiring (now imports the same functions instead of a hand-copied duplicate) — so production and the E2E fixture can never silently drift apart on this logic again.
- Phase 2 (remove redundant work):
  - P0-1: dropped the second `s.baseline(other, ...)` — `other` was baselined then immediately treated as "A creates a new file", which was actually exercising modify, not create. `other` is now a genuine create (never baselined), one fewer real provider push + verifier read, and the test now actually covers the create→remote→pull path its comment claims.
  - P0-2: dropped its trailing `expectIdempotent(ctx)` + second `expectTwoClientConvergence(ctx)` — idempotency-under-repeated-sync is already covered by P0-1's own `expectIdempotent`; P0-2's contract is "concurrent edits on different files both survive", which the first `expectTwoClientConvergence` + explicit remote-content checks already prove. Removes 3 extra full sync rounds (`A.sync/B.sync/A.sync`) worth of provider round trips per run.
  - `convergence-assertions.ts`: added `captureRemoteSnapshot`/`RemoteSnapshot` — one `getFile` per tracked path + one `listFiles`, captured once — and `expectConverged`/`expectMetadataConsistent` now accept an optional snapshot instead of each independently re-fetching the same remote files. `expectTwoClientConvergence` captures one snapshot and passes it to both, roughly halving the verifier calls per convergence check.
- Phase 3 (measurement): `captureRemoteSnapshot` is now wrapped in the existing opt-in `timed()` helper (`E2E_TIMING_DEBUG=1`) as `"remote snapshot (verifier)"`, alongside the prior round's `refresh`/`sync`/`baseline` timings — covers the plan's tree-listing/refresh/push/pull/verifier attribution list. Per-test total duration is already reported natively by vitest's own output; not hand-rolled separately.
- Explicitly NOT done this round (per plan): no GitLab-provider-side server-side `rootPath` tree-listing optimization, no timeout/retry changes, no production sync **semantics** changes — `main.ts`/`SyncScanner.ts` changes here are a pure logic-preserving extraction only.
- `npx eslint .` — 0 errors, 1 pre-existing unrelated warning (`obsidian-request-url.ts`'s unused `_T` generic).
- `npm run build` (tsc + Obsidian 1.11.0 compat typecheck + esbuild) — passed.
- `npx vitest run` — 68 files / 862 tests passed (same count as before this round — the extraction is behavior-preserving, no new/removed unit tests).
- **Not verified in this environment**: a real multi-suite E2E run proving the new P0-1/P0-2 timings land in the plan's target ranges (35–50s / 25–40s) and that GitLab stops hitting 120s — needs `scripts/run-e2e.sh --provider gitlab|github|gitea` against a real provisioned branch/CI (no Docker daemon / provider credentials in this environment).

This session (test(e2e): isolate two-client sync scope — follow-up to the CI-run-33358507732 triage):

- Root cause of the P0-1..P0-5 slowness/timeout risk: `two-client-sync.e2e.test.ts`'s fixture (`createSyncManagerFixture()`) built settings with `rootPath: ''`/`vaultFolder: ''`, and `TwoClient`'s `SyncStatusRefreshService` wiring bypassed vault-folder filtering entirely (`filterFilesByVaultFolder: files => files`, `filterPathByVaultFolder: () => true`). Every `refresh()` therefore listed and classified the WHOLE shared branch's remote tree — every other suite's `e2e-sc-*` fixtures included — not just this run's `e2e-tc-<runId>/` namespace.
- Fixed via the real production rootPath/vaultFolder model, not a test-only filter: `createSyncManagerFixture({ scoped: true })` (new opt-in option, `e2e-tests/provider/support/sync-manager-fixture.ts`) now generates its `runId` up front and configures BOTH the git service's own `rootPath` (`e2e-tests/provider/config/env.ts`'s `contextFor`/`githubContext`/`gitlabContext`/`giteaContext` now take a `rootPath` param, threaded into `service.updateConfig`) and `settings.vaultFolder` to the same `e2e-tc-<runId>` value. Because `vaultFolder` and `rootPath` are set identically, the local-vault-path ⇄ repo-relative-path round trip cancels out symmetrically: `SyncScanner.toRepoPath` strips `vaultFolder` before calling the service, and the service's own `rootPath` re-adds the same prefix when resolving the real remote path — so push/pull targets are unchanged, but `SyncStatusRefreshService.getNormalizedRemotePath` (already reading `settings().rootPath`) now actually scopes remote-tree classification, and `filterFilesByVaultFolder`/`filterPathByVaultFolder`/`getNormalizedPath`/`getVaultPath` in `two-client-sync-scenario.ts`'s `TwoClient` wiring were changed from test-only bypasses to the same vaultFolder-prefix logic `src/main.ts` uses in production.
- Added a fail-fast scope-leakage guard: `TwoClient.refresh()` now asserts every classified change's path starts with `e2e-tc-<runId>/` immediately after refresh, so a future regression in this isolation fails in seconds instead of surfacing as a 120s suite timeout.
- Added opt-in timing diagnostics (`e2e-tests/provider/support/timing-diagnostics.ts`, gated on `E2E_TIMING_DEBUG=1`, silent otherwise) around `refresh`/`sync`/`baseline`, so a future slow CI run can be attributed to a specific phase (tree listing / refresh / push / pull) instead of only "the test approached 120s".
- Scope: E2E fixture/support/diagnostics only — did not touch `E2E_TEST_TIMEOUT_MS`, retry policy, or `src/` production sync code. `path()`-based test bodies in `two-client-sync.e2e.test.ts` (P0-1..P0-5) needed no changes — the vaultFolder/rootPath symmetry keeps their existing `s.path('...')` full-path convention working unchanged.
- `npx eslint .` — 0 errors, 1 pre-existing unrelated warning (`obsidian-request-url.ts`'s unused `_T` generic).
- `npm run build` (tsc + Obsidian 1.11.0 compat typecheck + esbuild) — passed.
- `npx vitest run` — 68 files / 862 tests passed.
- **Not verified in this environment**: an actual multi-suite-sharing-one-branch E2E run proving the leakage is gone in practice (needs `scripts/run-e2e.sh --provider gitlab|github|gitea` against a real provisioned branch/CI, per the plan's verification matrix — this environment has no Docker daemon / provider credentials).

This session (#142 — e2e/ → e2e-tests/provider/ scanner-boundary move, static runtime files):

- Moved `e2e/{config,shim,suites,support}` → `e2e-tests/provider/{config,shim,suites,support}` (git mv, history preserved); deleted `e2e/runtime-modules.d.ts` and `e2e/verifier-runtime-types.ts`.
- Replaced `scripts/e2e-harness.sh`'s `generate_runtime()` (which wrote `obsidian-request-url.ts`/`window-timers.ts`/`git-verifier.ts` per-run into `$E2E_RUNTIME_DIR`) with committed static files at `e2e-tests/provider/runtime/{obsidian-request-url,window-timers}.ts` and `e2e-tests/provider/support/git-verifier.ts`. `GitVerifier` now reads its clone path from `process.env.E2E_WORKDIR` at call time instead of a shell-baked constructor default — verified directly against a throwaway local git repo (`listFiles`/`getFile`/`listCommitShas` all correct).
- Side effect: removing `generate_runtime()` also removed the file's only `${var@Q}` bash-4-ism, which previously blocked `scripts/e2e-harness.sh provision` under macOS system bash 3.2 (see "Outstanding Items" #1 below — that specific blocker no longer applies, though a live run still needs Docker, which this sandbox doesn't have running).
- Updated `scripts/run-e2e.sh`, `scripts/e2e-suites.txt`, `vitest.e2e.config.ts`, `tsconfig.json`, `eslint.config.mts`, `.github/workflows/ci.yml` (`e2e-relevant` filter: `e2e/**` → `e2e-tests/**`, added `scripts/e2e-suites.txt`/`vitest.e2e.config.ts`, added `src/logic/sync/**`/`src/logic/source-control/**` — these were exercised by the E2E suites but not previously watched by the path filter) for the new layout.
- Extended `tests/ci-workflow.test.ts` with contract assertions for the new paths and for the absence of `E2E_RUNTIME_DIR`/`generate_runtime`/`@e2e-runtime`.
- Manually replayed `scripts/run-e2e.sh`'s forward/reverse suite-manifest checks against the new paths (bash snippet, no Docker needed) — both pass.
- `npx eslint .` — 0 errors, 1 pre-existing-shape warning (unused `_T` generic in the committed `AbstractInputSuggest<_T>` stand-in, matches obsidian's real generic shape).
- `npm run build` (tsc + Obsidian 1.11.0 compat typecheck + esbuild) — passed.
- `npx vitest run` — 68 files / 857 tests passed.
- **Not verified in this environment**: an actual local Gitea E2E run (`npm run test:e2e -- --provider gitea`) — Docker is installed but its daemon isn't reachable/running in this sandbox. The suite-manifest and `GitVerifier` logic were validated by other means above, but the full provision→seed→vitest→cleanup path was not exercised end-to-end here.
- Filed #143 (`test: reduce real-provider API pressure`) as a separate follow-up for CI retry/tiering — out of scope for this PR, not touched here.

This session (Source Control error-handling fixes, code-review follow-up + small cleanups):

- `DiffStatProvider.clear()` now also clears the per-row `generations` map (previously only `cache`/`queued`/`active` were cleared, so `generations` grew unbounded across refreshes); added a white-box regression test.
- `styles.css` `.batch-conflict-row`: replaced the ambiguous multicol-spec `column-gap` with the unambiguous `gap` shorthand (same grid layout, fixes an "Unexpected browser feature 'multicolumn' is only partially supported by Obsidian 1.9.12" lint warning).
- `npx eslint .` — 0 errors; `npx vitest run` — 68 files / 850 tests passed; `npm run build` — passed.


- Fixed 4 review findings against `SourceControlActionService.ts` / `PushExecutor.ts`: (1) `resolveConflict`'s local-push branch now checks `PushResults.errors` instead of assuming success whenever the workspace call doesn't throw; (2) `sync()`'s `planPush`/`planPull`/`confirmPlan` phase is now wrapped in `try/catch` (extracted into `planSync()`) so a planning rejection fails the batch and notifies instead of becoming an unhandled rejection; (3) `PushExecutor` now isolates local metadata bookkeeping (`updateMetadata`/`clearMetadata`) from the remote mutation call via `persistMetadata`/`persistMetadataClear`, so a metadata-write failure after a successful remote commit/push/delete no longer misreports the whole chunk as failed; (4) `sync()`'s remote-commit and pull phases (extracted into `commitRemoteBucket()`/`applyPullBucket()`) now have independent error boundaries, so a pull failure no longer fails already-succeeded push/delete targets.
- `npx eslint .` — 0 errors
- `npm run build` (+ Obsidian 1.11.0 compat typecheck) — passed
- `npx vitest run` — 68 files / 849 tests passed (5 new regression tests added: 1 in `PushExecutor.test.ts`, 4 in `SourceControlActionService.test.ts`)

Prior session (Multi-client E2E hardening):

- `npx eslint .` — 0 errors (4 new files, no warnings)
- `npx vitest run` — 68 files / 844 tests passed
- `npm run build` (+ Obsidian 1.11.0 compat typecheck) — passed
- `E2E_RUNTIME_DIR=<stub> E2E_PROVIDER=gitea npx vitest -c vitest.e2e.config.ts run e2e/suites/two-client-sync.e2e.test.ts` — suite collects all 5 P0 tests and wires real mocks/fixtures; fails only at provider-credential load (expected locally without harness env). Full run requires CI/`run-e2e.sh` (blocked locally by pre-existing bash-3.2 `${var@Q}` issue in `scripts/e2e-harness.sh`).
- New files: `e2e/support/two-client-sync-scenario.ts`, `e2e/support/convergence-assertions.ts`, `e2e/suites/two-client-sync.e2e.test.ts`; extended `e2e/shim/fake-vault.ts` (paths/getFiles/getAbstractFileByPath/adapter.list/adapter.stat for the real refresh pipeline), `e2e/support/sync-manager-fixture.ts` (conflictResolver getter), `scripts/e2e-suites.txt` (suite registration).

This session (CI run 33358507732 triage — `feat(source-control): replace sync status panel with the source control workflow`, PR #129):

- Diagnosed the `github` provider E2E leg: `firstsun-dev/obsidian-sync-test`'s `main` branch had accumulated ~1,307 leftover `bench-61-*` files from an old manual perf run, never cleaned up. Every CI run clones that bloated `main`, and the two-client-sync suite's per-file remote pulls against it exhausted GitHub's API rate limit (2,669 "rate limit exceeded" hits in the log), cascading into failures across the whole run's retries. Fixed by removing the `bench-61-*` debris from `main` directly (outside this repo).
- Diagnosed the `gitlab` leg (clean fixture repo, no pollution) and found the same underlying symptom independent of repo size: `two-client-sync.e2e.test.ts`'s P0-1..P0-4 tests each hang silently for exactly their 120s `testTimeout` with zero log output — consistent with a stalled `fetch()` that never resolves rather than an application-level deadlock, since `e2e-tests/provider/runtime/obsidian-request-url.ts`'s `requestUrl` shim had no network timeout at all.
- Fixed: added a 30s `AbortSignal.timeout` to the shim's `fetch()` call so a stalled connection fails fast with a clear error instead of masquerading as a hang until the suite's own timeout. Does not by itself prove/disprove a real sync-logic deadlock — if CI still times out here after this fix, that's stronger evidence of an actual bug in `two-client-sync`, not infra flakiness (see #143 for the pre-existing "reduce real-provider API pressure" follow-up).
- `npx eslint e2e-tests/provider/runtime/obsidian-request-url.ts` — 0 errors, 1 pre-existing warning (unused `_T` generic).
- `npm run build` (tsc + Obsidian 1.11.0 compat typecheck + esbuild) — passed.
- `npx vitest run` — 68 files / 862 tests passed.

Prior round evidence (UI refactor rounds above) — see git log + [archive/2026-08.md](./archive/2026-08.md) at next archive pass.