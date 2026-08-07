# Real-provider E2E

Issue #57. Real `SyncManager`/`GitHubService`/`GitLabService`/`GiteaService` code run
against real GitHub, GitLab, and Gitea servers, with every remote assertion made through an
independent verifier (raw REST calls, never the service under test reading back its own
write). See `e2e/` for the harness itself:

- `e2e/providers/` — one adapter per provider (`provision()` -> real, already-configured
  `GitServiceInterface`; `teardown()`).
- `e2e/provision/` — GitHub/GitLab: validates credentials against a dedicated sandbox
  repo/project and creates a run-specific branch. Gitea: provisions a pinned Docker container
  from scratch.
- `e2e/verifier/` — one `RemoteVerifier` per provider, raw API calls only.
- `e2e/suites/{github,gitlab,gitea}.e2e.test.ts` — provider contract suites (create/read/
  update/delete/batch/rename, plus provider-specific regressions).
- `e2e/suites/sync-manager.e2e.test.ts` — one suite, parametrized by `E2E_PROVIDER`, covering
  `SyncManager` itself (push/pull/conflict/rename/delete/batch) against a real provider with an
  in-memory fake Vault (`e2e/shim/fake-vault.ts`) standing in for the Obsidian filesystem
  boundary — see that file's header comment for why the vault is the only thing faked.

## Running locally

```sh
npm run test:e2e -- --provider gitea    # no credentials needed, runs a real Gitea in Docker
npm run test:e2e -- --provider github   # needs E2E_GITHUB_* below
npm run test:e2e -- --provider gitlab   # needs E2E_GITLAB_* below
```

Each command runs that provider's contract suite *and* the SyncManager suite in one process
(`scripts/run-e2e.mjs`). Export credentials in your shell before running (there is no
`.env`-style file loader in this harness — plain `process.env`, matching `e2e/config/env.ts`):

| Var | Required for | Notes |
|---|---|---|
| `E2E_GITHUB_OWNER` | github | e.g. `firstsun-dev` |
| `E2E_GITHUB_REPO` | github | dedicated sandbox repo — **never** a real user's repo |
| `E2E_GITHUB_TOKEN` | github | fine-grained PAT, scoped to that one repo, Contents: Read and write |
| `E2E_GITHUB_BASE_BRANCH` | github (optional) | defaults to `main` |
| `E2E_GITLAB_PROJECT_ID` | gitlab | dedicated sandbox project |
| `E2E_GITLAB_TOKEN` | gitlab | token with `api` scope on that project — `write_repository` alone is not enough, the verifier and branch setup use REST endpoints outside its coverage |
| `E2E_GITLAB_BASE_URL` | gitlab (optional) | defaults to `https://gitlab.com` |
| `E2E_KEEP_BRANCH` | any (optional) | `1`/`true` skips teardown (branch for GitHub/GitLab, container for Gitea) so you can inspect a failing run |

Gitea needs Docker locally and nothing else — see `e2e/provision/gitea-provision.ts`.

## CI

`.github/workflows/ci.yml` runs a `provider-e2e` matrix job (`github`, `gitlab`, `gitea`) via
`scripts/run-e2e-ci.mjs`, gated on relevant paths (`src/services/**`,
`src/logic/sync-manager.ts`, `e2e/**`, etc. — computed by the `changes` job, since GitHub
Actions' own `on.*.paths` would gate the *entire* workflow file, including the always-must-run
`CI`/release job). It always runs in full on `workflow_dispatch`, `schedule` (weekly, Monday
06:00 UTC, for API-drift detection), and pushes to `main`.

**Secrets/variables** (repo-level, `firstsun-dev/git-files-sync`; confirmed already configured
via `gh secret list` / `gh variable list` while wiring this workflow):

| Name | Kind |
|---|---|
| `E2E_GITHUB_TOKEN` | secret |
| `E2E_GITHUB_OWNER` | variable |
| `E2E_GITHUB_REPO` | variable |
| `E2E_GITLAB_PROJECT_ID` | secret (not a variable — it's treated as sensitive here) |
| `E2E_GITLAB_TOKEN` | secret |

**Fork PRs** only run the Gitea cell (checked in the `Determine whether this provider leg should
run` step — GitHub Actions job-level `if:` can't reference the `matrix` context, so this can't
live on the job itself; it gates every later step instead) — GitHub/GitLab need
real credentials that must never be exposed to an untrusted fork's workflow run. Gitea needs no
repo secrets at all, so it's safe to run unconditionally.

**Missing credentials are always a hard failure**, never a silent skip, for any cell that
actually runs (`scripts/run-e2e-ci.mjs` checks required env vars up front) — the job-level `if:`
above is what decides whether a cell *should* run for a given event; once it runs, it's expected
to have what it needs.

## Release gating

```
changes -> provider-e2e [github | gitlab | gitea, parallel] -> e2e-gate -> CI (shared workflow, includes semantic-release)
```

`e2e-gate` runs with `if: always()` and treats `provider-e2e`'s aggregate result as pass-through
on `success` or `skipped` (the latter covers path-filtered-out runs), and a hard failure on
anything else — so a real provider regression blocks the release instead of shipping and being
caught after the fact.

**Branch protection** (not something this repo checkout can change — a GitHub repo-settings
change, left for whoever has admin access): add `E2E / gitea` as a required status check.
GitHub/GitLab (`E2E / github`, `E2E / gitlab`) are deliberately **not** required at the
branch-protection level, so a fork PR (which only runs Gitea) is never wedged by checks it
structurally cannot produce — internal-PR/main-branch release gating still depends on them
through the `e2e-gate`/`CI` job dependency chain above, just not through branch protection.

## Cleanup / troubleshooting

- **Stale `gfs-e2e-<provider>-*` branch** (GitHub/GitLab only — Gitea's whole container is
  destroyed in `afterAll`): `scripts/run-e2e-ci.mjs` runs `scripts/e2e-sweep-branches.mjs`
  before every CI run, which best-effort deletes any branch of that pattern older than 24h. Run
  it manually (`node scripts/e2e-sweep-branches.mjs --provider github`) if you need it sooner.
- **Inspecting a failing run**: set `E2E_KEEP_BRANCH=1` before running so teardown is skipped,
  then look at the branch/container directly. Remember to clean it up yourself afterward, or let
  the sweeper (GitHub/GitLab) catch it after 24h.
- **Gitea container port/name clashes**: every Docker resource is namespaced per run
  (`e2e/namespace.ts`, `gfs-e2e-gitea-<run-id>-<attempt>` in CI, `gfs-e2e-gitea-local-<random>`
  locally), so concurrent runs on the same Docker host don't collide — a leftover container from
  an interrupted local run can just be removed manually (`docker rm -f <name>`).
- **`E2E_PROVIDER is not set` error**: the E2E vitest config (`vitest.e2e.config.ts`) refuses to
  run directly under `npx vitest` — always go through `npm run test:e2e -- --provider <name>` (or
  `scripts/run-e2e-ci.mjs` in CI), which sets it.

## Known gaps

- SyncManager E2E against GitHub/GitLab is written to the same harness as Gitea (no
  provider-specific code) but has only been run end-to-end locally against Gitea (Docker,
  no external credentials available in that environment) — not yet actually executed against
  live GitHub/GitLab sandboxes. Lint/build/typecheck pass for all three.
- The `provider-e2e` matrix job targets `runs-on: [self-hosted, linux, x64, 32gb-ram]` per the
  issue's runner-fleet revision; its actual execution on that fleet, and the `e2e-gate` ->
  `CI` dependency chain end-to-end in a real workflow run, are unverified from this checkout
  (no self-hosted runner access here).
- Branch-protection required-check configuration (`E2E / gitea`) is a manual follow-up for
  whoever has admin access to the repo.
