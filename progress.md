# Session Progress Log

Completed work is archived in [archive/](./archive/), one file per calendar month.

## Current State

**Last Updated:** 2026-08-13
**Active Feature:** Real-provider E2E Phase 2 (multi-run isolation) implemented on `test/real-provider-e2e`, not yet pushed/PR'd. Phase 0+1 CI is green end-to-end including real GitHub/GitLab E2E runs; Gitea leg temporarily disabled in CI pending runner-topology follow-up (see Outstanding Items) — code untouched, passes locally.
**Parallel Work:** PR #87 (4x Dependabot security alerts via npm overrides) and Issue #57 (live-credential smoke test).

## Outstanding Items

0. **Open the Phase 0+1+2 PR** — no PR exists yet for `test/real-provider-e2e` -> `main`; open one
   covering all three phases once pushed (see item below re: the gitea leg first).
0a. **Re-enable the gitea leg in CI** (`.github/workflows/ci.yml`, "Determine whether this provider leg should run" step) — disabled 2026-08-13 after two rounds of real-CI-only failures (host-port/127.0.0.1 unreachable from this self-hosted fleet's sibling-container topology, then a curl hang) got fixed but a third run wasn't attempted before the user asked to pause it; harness code (`scripts/e2e-harness.sh`'s gitea path, `e2e/suites/gitea.e2e.test.ts`) is unchanged and passes locally every time (`npm run test:e2e -- --provider gitea`). While disabled, fork PRs get zero E2E coverage (gitea is normally the only leg that needs no secrets). Resolve before opening the PR, or explicitly defer.
1. **feat-025 manual verification** — Tree view code is complete and all automated checks pass; manual Obsidian verification in a real vault remains for user to confirm functionality (tree hierarchy, folder expand/collapse, checkboxes, Show synced toggle).
2. **PR #87** — Dependabot security patches via npm overrides; awaiting review/merge.
3. **Issue #57** — Live-credential smoke test; pre-existing, relevant before pushing major sync work.

## Latest Evidence

- [x] Real-provider E2E Phase 2 (multi-run isolation): added `scripts/e2e-namespace.sh` (single
  canonical `e2e/pr/<n>/<provider>/run-<id>-<attempt>` / `e2e/branch/<sanitized-id>/<provider>/
  run-<id>-<attempt>` identity generator, sourced by every other layer — no branch-naming logic
  duplicated anywhere else), `scripts/e2e-namespace-cleanup.sh` (layer 2: deletes a whole PR/branch
  namespace), `scripts/e2e-janitor.sh` (layer 3: TTL sweep, default 24h, of any leftover `e2e/**`
  branch, generic `git for-each-ref`/`push --delete`, tolerant of already-deleted refs — no
  Node-based sweeper reintroduced). Removed `e2e-harness.sh`'s old `sweep` subcommand (superseded
  by the janitor) and its ad hoc `gfs-e2e-<provider>-<run>` naming. `ci.yml`'s `provider-e2e` job
  now sets `E2E_WORKDIR` to `$RUNNER_TEMP/git-files-sync-e2e/<run-id>/<run-attempt>/<provider>`
  (was a shared `e2e-<provider>` dir), passes `E2E_PR_NUMBER`/`E2E_SOURCE_BRANCH` through for
  `provision`, and carries a per-source/provider `concurrency` group
  (`e2e-pr-<n>-<provider>`/`e2e-branch-<branch>-<provider>`, `cancel-in-progress: true`) so a
  repeated push/rerun cancels its own predecessor instead of both running. Added
  `.github/workflows/e2e-pr-cleanup.yml` (`pull_request_target: [closed]`, no `ref:` override on
  checkout so it only ever runs this repo's own trusted code/secrets, never the closing PR's
  branch) and `e2e-branch-cleanup.yml` (`delete` event) — both share the same concurrency-group
  naming as `provider-e2e` with `cancel-in-progress: false` so cleanup queues behind rather than
  races an active run. Added `.github/workflows/e2e-janitor.yml` (schedule, every 6h, plus
  `workflow_dispatch`). Rewrote `docs/testing/real-provider-e2e.md`'s "Isolation model" section
  (namespace scheme, concurrency/cancellation semantics, 3-layer cleanup hierarchy with a Mermaid
  diagram, self-hosted workdir isolation) and updated Layout/CI/Cleanup/Known-gaps to match.
  Verification: `npx eslint .` — 0 errors; `npm run build` (incl. Obsidian 1.11.0 compat
  typecheck) — clean; `npx vitest run` — 527 passed; `python3 -c yaml.safe_load(...)` on all 4
  touched/new workflow YAML files — all parse; `bash -n` on all 4 shell scripts — all parse;
  functional dry-runs against throwaway local git repos (not the real sandboxes) for
  `e2e_test_branch`/`e2e_branch_id` collision resolution (`feature/foo-bar` vs `feature-foo/bar`
  hash to different identities), the janitor's TTL sweep (old branch deleted, recent branch and an
  unrelated `feature/keep-me` branch both left untouched), and `e2e-namespace-cleanup.sh`'s prefix
  match (`e2e/pr/123/**` matches only that PR's two provider branches, not PR 456 or the
  branch-only namespace); **real end-to-end run against a live local Gitea sandbox**
  (`npm run test:e2e -- --provider gitea`) with the new harness/namespace code — 14/14 E2E tests
  passed including a real Docker provision/seed/cleanup cycle; confirmed
  `E2E_PROVIDER=github scripts/e2e-harness.sh provision` still hard-fails on missing
  `E2E_GITHUB_OWNER` (never a silent skip) with the new identity plumbing in place. Not yet
  exercised against live GitHub/GitLab sandboxes or the real self-hosted runner fleet from this
  checkout (no credentials/runner access here) — see `docs/testing/real-provider-e2e.md`'s "Known
  gaps".
- [x] Real-provider E2E: pushed to `origin/test/real-provider-e2e`, real CI run against `firstsun-dev/git-files-sync`'s self-hosted fleet (run 31666859288) fully green: `E2E / github` (3m15s) and `E2E / gitlab` (3m54s) both passed for real against live sandboxes, `E2E / github`+`gitlab`+`gitea` gate, and the full downstream `CI` (lint, test Node 22/24, package, build/release) all green. Getting there took 3 fix-and-repush rounds off real CI failures the local-only verification hadn't caught: (1) the generated `GitVerifier`'s git calls had no `GIT_ASKPASS`/`GIT_TERMINAL_PROMPT` in the separate vitest-step process — fixed by persisting them (paths/flags only, not the token itself) into `e2e.env`; (2) gitea provisioning timed out on `127.0.0.1:<host-port>` — this runner fleet is itself a sibling container of the Docker daemon, so a published host port isn't reachable from it; switched to the container's own bridge IP; (3) that same curl call could hang indefinitely with no `--max-time`, silently blowing past the health-check loop's own retry budget — added `--max-time` everywhere and a retry-with-backoff on `docker inspect` returning an empty IP. Gitea leg then temporarily disabled in CI per user request (still passes locally) — see Outstanding Items.
- [x] Real-provider E2E Phase 1 (Shell/Git harness rewrite): replaced the Node-based `e2e/provision`/`e2e/verifier`/`e2e/providers`/`e2e/shim/{obsidian-request-url,window-timers}`/`scripts/run-e2e*.mjs` (fetch/globalThis/node:child_process/node:crypto in committed `.ts` — the exact APIs `docs/obsidian-scanner-audit.md` flagged) with `scripts/e2e-harness.sh` (provision/seed/verify/cleanup/sweep — Shell + Git CLI: `git push <sha>:refs/heads/<branch>` for GitHub/GitLab branch isolation, plain `docker`/`curl` for Gitea's disposable container+repo, `GIT_ASKPASS` generated per-run under `$RUNNER_TEMP`/`$E2E_WORKDIR`, never persisted) plus `scripts/run-e2e.sh` (local orchestration wrapper). Node-only glue the suites still need at runtime (real `requestUrl` shim, `window` timer alias, a git-CLI-backed verifier) is generated by `provision` into `$E2E_RUNTIME_DIR` and loaded via runtime-computed dynamic `import()` — never committed — so `e2e/**/*.ts` went back into `tsconfig.json`'s `include`/`eslint.config.mts`'s scope clean. Ported all 4 suites (github/gitlab/gitea/sync-manager) to the new `SyncManager.pushFiles` API and the generated verifier. `npx eslint .` — 0 errors; `npm run build` — clean; `npx vitest run` — 527 passed; **real end-to-end run against a live local Gitea sandbox** (`npm run test:e2e -- --provider gitea`) — 14/14 E2E tests passed (gitea contract suite + SyncManager suite), including a real Docker container provision/seed/cleanup cycle. GitHub/GitLab E2E legs are written and typecheck/lint clean but weren't run live (no sandbox credentials in this environment) — same known gap the pre-Phase-1 harness had, documented in `docs/testing/real-provider-e2e.md`'s "Known gaps". Self-audit of `docs/obsidian-scanner-audit.md`'s grep method against the new tree: zero hits for `fetch`/`globalThis`/`node:crypto`/`node:child_process`/`node:util`/bare-timers in `e2e/**` or `src/**`.
- [x] Real-provider E2E Phase 0 reconcile: merged `origin/main` (scanner-driven E2E removal, v1.5.8) into `test/real-provider-e2e-work`, keeping the old `e2e/**` tree temporarily (added `e2e/**`/`vitest.e2e.config.ts` to `eslint.config.mts` `globalIgnores` as an interim measure — not in `tsconfig.json` `include` either, both to be resolved for real by the Phase 1 harness rewrite), then merged `origin/claude/unify-push-pull-pipeline` (new unified `SyncManager.pushFiles` API) cleanly (disjoint file sets, only `package-lock.json` auto-merged). `npx eslint .` — 0 errors; `npm run build` (incl. Obsidian 1.11.0 compat typecheck) — clean; `npx vitest run` — 527 tests passed.
- [x] `fix(sync): ensure parent dirs exist when reverting file moves` (issue #94): extracted `ensureParentDirs()` to `src/utils/vault-path.ts` and called it before rename in both `revertMove` and `revertMoveGroup`, fixing "folder does not exist" error when reverting moves to deleted parent folders. `npx eslint .` — 0 errors; `npm run build` — clean; `npx vitest run` — 502 tests passed.
- [x] `fix(gitlab): fix sha/revision semantics for optimistic locking` (issue #101, PR #113, merged): `GitFile.sha` now consistently represents blob identity across providers; added `GitFile.revision` for provider-specific write control.

Full history of completed features (feat-001 through feat-024) archived to [archive/2026-07.md](./archive/2026-07.md). August work archived to [archive/2026-08.md](./archive/2026-08.md).
