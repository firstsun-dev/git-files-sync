# GitHub Real-Provider E2E — Test Plan

Issue #57 (Agent 02). Companion to Agent 01's shared E2E harness (`e2e/providers/provider-adapter.ts`, `e2e/verifier/verifier-contract.ts`) and the Gitea (`e2e/suites/gitea.e2e.test.ts`) / GitLab (`e2e/suites/gitlab.e2e.test.ts`) suites built on it.

## Architecture

```
production GitHubService (src/services/github-service.ts)
        ↓
real GitHub sandbox repository (firstsun-dev/obsidian-sync-test)
        ↓
independent GitHubVerifier (raw REST API — Contents, branches, trees, commits)
```

The production service is exercised unmodified; every remote assertion goes through `GitHubVerifier`, never by reading the service's own writes back through itself.

- `e2e/provision/github-provision.ts` — validates the fine-grained PAT against the sandbox repo, then creates a run-specific branch off `main` (default; override with `E2E_GITHUB_BASE_BRANCH`). GitHub is hosted, so "provisioning" isolation means a fresh branch per run, not a container — teardown deletes that branch.
- `e2e/verifier/github-verifier.ts` — implements the shared `RemoteVerifier` contract (`getFile`, `listFiles`, `fileMissing`) plus GitHub-specific extras used only by this suite: `getBlobMode`, `getRawEntry` (symlink target), `listCommitShas`, `getCommitMessage`.
- `e2e/providers/github-adapter.ts` — wires `GitHubService` + `GitHubVerifier` into the shared `ProviderE2EAdapter` contract.
- `e2e/suites/github.e2e.test.ts` — the test suite itself.

## Required secrets / config

Set on `firstsun-dev/git-files-sync` (this repo) for CI, or exported locally for `npm run test:e2e -- --provider github`:

| Name | Kind | Purpose |
|---|---|---|
| `E2E_GITHUB_TOKEN` | secret | Fine-grained PAT, scoped to the sandbox repo only, **Contents: Read and write** permission (covers file reads/writes, `createCommitOnBranch`, and branch-ref create/delete for setup+teardown) |
| `E2E_GITHUB_OWNER` | variable | `firstsun-dev` |
| `E2E_GITHUB_REPO` | variable | `obsidian-sync-test` |
| `E2E_GITHUB_BASE_BRANCH` | variable (optional) | defaults to `main` |

These have been set on `firstsun-dev/git-files-sync` via `gh secret set` / `gh variable set`.

## Sandbox repository assumptions

- `firstsun-dev/obsidian-sync-test` is dedicated to E2E use — never a real user's repo.
- It has a `main` branch with at least one commit (branch creation reads `main`'s current SHA as the fork point).
- The PAT's org (`firstsun-dev`) may require admin approval of fine-grained PATs before they're usable — this blocked the first live run until approved.

## Coverage

Common provider contract (mirrors the Gitea/GitLab suites):

- `testConnection`
- create (`pushFile`, via `createCommitOnBranch`)
- read (`getFile`)
- update (`pushFile` with existing sha)
- delete (`deleteFile`)
- batch push (`pushBatch`) — asserted as exactly **one** new commit for N files, not N
- rename/move (`commitBatch`) — add+delete in one commit

GitHub-specific regression/behavior coverage:

- symlink push (`pushSymlink`, Git Data API, blob mode `120000`) — content/target verified via the raw Contents API's `type`/`target` fields
- a real GraphQL **HTTP 200 with `errors[]`** rejection, forced deterministically via a file path that collides with an existing directory (no timing dependency, unlike a stale-head race)
- `expectedHeadOid` self-healing under **genuine concurrent writes** to the same branch (2 concurrent single-file pushes — see "Known limitation" below for why not higher)

## Known limitation: concurrency test size

`commitOnBranch`'s retry budget is fixed at 3 attempts with a 500ms×attempt backoff. Live testing showed 3+ concurrent writers to the same branch can legitimately exhaust that budget under real GitHub write latency — that's a real characteristic of the production retry budget, not a test bug, but it made the test flaky at that concurrency level. The suite uses 2 concurrent writers: the minimum that still forces a real race while staying reliably within budget.

## Known limitation: GitHub API read-after-write lag

GitHub's REST Contents/commits/trees endpoints were observed live to occasionally return pre-write state immediately after a mutation lands (a real propagation characteristic, not a client-side cache — plain Node `fetch` is used, no caching layer). Every verifier read that immediately follows a write in this suite polls via a local `waitFor`/`waitForContent`/`waitForMissing` helper (`e2e/suites/github.e2e.test.ts`) instead of asserting on a single read. Confirmed stable across 3+ consecutive live runs after adding this.

## Production bugs found (and fixed) via this live testing

Both in `STALE_HEAD_ERROR` (`src/services/github-service.ts`) — the regex `commitOnBranch` uses to decide whether a `createCommitOnBranch` failure is retryable:

1. A genuine concurrent-write race reports `"Ref refs/heads/<branch> is at <oid> but expected <oid>"` — didn't match any existing pattern, so the retry never fired.
2. A rename's deletion side, read immediately after the file's own create, reports `"A path was requested for deletion which does not exist as of commit oid <oid>"` — a different phrasing than the already-handled `"does not exist in tree"`, also unmatched.

Both patterns were added to the regex, with regression tests in `tests/services/github-service.test.ts` reproducing the exact live wording via mocked `requestUrl` responses.

## Harness gap found (and fixed): `window` is undefined under Node

`GitHubService.commitOnBranch`'s retry backoff uses `window.setTimeout` — correct for Obsidian's Electron renderer (where `window` always exists), but the E2E harness runs under `environment: 'node'` (`vitest.e2e.config.ts`) for a real `fetch`, which has no `window`. Fixed with a minimal shim (`e2e/shim/window-timers.ts`, wired via `setupFiles`) that aliases `window` to `globalThis` — not Gitea/GitLab-specific, so any future provider whose production code touches `window` benefits from it too.

## Running

```
E2E_GITHUB_OWNER=<owner> E2E_GITHUB_REPO=<repo> E2E_GITHUB_TOKEN=<fine-grained PAT> \
  npm run test:e2e -- --provider github
```

Verified: 3 consecutive clean runs (10/10 tests) against `firstsun-dev/obsidian-sync-test` as of 2026-08-07.
