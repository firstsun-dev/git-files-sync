# Real-provider E2E

Issue #57. Real `SyncManager`/`GitHubService`/`GitLabService`/`GiteaService` code run against
real GitHub, GitLab, and Gitea servers, with every remote assertion made independently of the
service under test — never the service reading back its own write.

## Responsibility boundary

```
GitHub Actions
    |
    +-- environment/secrets/services
    |
    +-- Shell + Git: Arrange   (scripts/e2e-harness.sh provision, seed)
    |
    +-- TypeScript production provider: Act   (npx vitest -c vitest.e2e.config.ts)
    |
    +-- Shell + Git: independent Assert   (scripts/e2e-harness.sh verify + the git-CLI
    |                                       verifier vitest suites import)
    |
    +-- Shell + Git: Cleanup   (scripts/e2e-harness.sh cleanup)
```

This replaced an earlier Node-based harness (`e2e/provision`, `e2e/verifier`, `e2e/providers`,
`e2e/shim`, `scripts/run-e2e*.mjs`) that used `fetch`/`node:child_process`/`node:crypto` directly
in committed `.ts` files. The Obsidian community-plugin scanner flags those APIs wherever they
appear in the repo, regardless of directory — it doesn't matter that E2E code never ships in
`main.js`. See `docs/obsidian-scanner-audit.md`.

**The fix isn't "move it to a differently-named folder"** — it's that no committed `.ts` file
uses those APIs at all:

- `scripts/e2e-harness.sh` (Shell, not TypeScript) owns branch/container lifecycle: creating the
  isolated test branch via plain `git push <sha>:refs/heads/<branch>` (no REST branch-creation
  calls except the one GitLab numeric-project-ID resolution git genuinely can't do), and the
  Gitea Docker container lifecycle via the `docker` CLI directly — never
  `node:child_process`.
- Everything Node-only that the suites still need at runtime (the real `requestUrl` shim
  production services import from `obsidian`, the `window.setTimeout` alias, and a small
  git-CLI-backed verifier) is **generated fresh per run** by `scripts/e2e-harness.sh provision`
  into `$E2E_RUNTIME_DIR`, not committed. Suites only import a type-only contract
  (`e2e/verifier-runtime-types.ts`) statically, and load the concrete implementation via a
  runtime-computed dynamic `import()` — so `npm run build`'s typecheck never needs the generated
  files to exist, and there's nothing scanner-visible for them to flag.

## Layout

- `scripts/e2e-harness.sh` — `provision` / `seed` / `verify` / `cleanup` / `sweep`. See its own
  header comment for the full command surface.
- `scripts/run-e2e.sh` — thin local-dev wrapper: provision → seed → vitest → cleanup (CI drives
  the same four steps directly as separate job steps instead).
- `e2e/config/env.ts` — reads the env vars `provision` resolved and constructs the real,
  already-configured `GitServiceInterface` per provider (`githubContext`/`gitlabContext`/
  `giteaContext`).
- `e2e/verifier-runtime-types.ts` — type-only `GitVerifier` contract the generated git-CLI
  verifier implements.
- `e2e/shim/fake-vault.ts` — real in-memory Obsidian Vault/App stand-in (not a `vi.fn()` mock);
  the only thing faked, since the point of this harness is exercising real `SyncManager` +
  real provider code against a real Git server.
- `e2e/suites/{github,gitlab,gitea}.e2e.test.ts` — provider contract suites (create/read/
  update/delete/batch/rename, plus provider-specific regressions).
- `e2e/suites/sync-manager.e2e.test.ts` — one suite, parametrized by `E2E_PROVIDER`, covering
  `SyncManager.pushFiles`/`pullFile`/`trackRename`/`clearMetadata` against a real provider.

## Running locally

```sh
npm run test:e2e -- --provider gitea    # no credentials needed, runs a real Gitea in Docker
npm run test:e2e -- --provider github   # needs E2E_GITHUB_* below
npm run test:e2e -- --provider gitlab   # needs E2E_GITLAB_* below
```

| Var | Required for | Notes |
|---|---|---|
| `E2E_GITHUB_OWNER` | github | e.g. `firstsun-dev` |
| `E2E_GITHUB_REPO` | github | dedicated sandbox repo — **never** a real user's repo |
| `E2E_GITHUB_TOKEN` | github | fine-grained PAT, scoped to that one repo, Contents: Read and write |
| `E2E_GITHUB_BASE_BRANCH` | github (optional) | defaults to `main` |
| `E2E_GITLAB_PROJECT_ID` | gitlab | dedicated sandbox project (numeric ID) |
| `E2E_GITLAB_TOKEN` | gitlab | token with `api` scope on that project |
| `E2E_GITLAB_BASE_URL` | gitlab (optional) | defaults to `https://gitlab.com` |
| `E2E_GITEA_IMAGE` | gitea (optional) | defaults to `gitea/gitea:1.22` |
| `E2E_KEEP_BRANCH` | any (optional) | `1`/`true` skips teardown (branch for GitHub/GitLab, container for Gitea) so you can inspect a failing run |
| `E2E_WORKDIR` | any (optional) | shared scratch dir across provision/seed/vitest/cleanup; defaults to a provider-namespaced tmp dir |

Gitea needs Docker locally and nothing else.

### Git authentication

`scripts/e2e-harness.sh` generates a throwaway `GIT_ASKPASS` helper under `$RUNNER_TEMP` (or
`$E2E_WORKDIR` locally) at the start of `provision`, exports `GIT_ASKPASS`/
`GIT_TERMINAL_PROMPT=0` for every git invocation, and never persists the token anywhere else — no
remote-URL embedding, no `.git/config` credential storage, no `credential.helper`, no token in
command-line args or logs. GitHub uses `x-access-token` as the git username (works for both
classic and fine-grained PATs); GitLab uses `oauth2`. Gitea's per-run admin token has no other
source of truth after its container is created, so it's the one credential persisted to a
`chmod 600` file scoped to `$E2E_WORKDIR`, deleted by `cleanup`.

## CI

`.github/workflows/ci.yml` runs a `provider-e2e` matrix job (`github`, `gitlab`, `gitea`) as five
steps per leg — provision, seed, the real vitest run, independent verify, cleanup (`if: always()`
so cleanup runs even if an earlier step failed) — gated on relevant paths (`src/services/**`,
`src/logic/sync-manager.ts`, `e2e/**`, `scripts/e2e-harness.sh`, etc. — computed by the `changes`
job, since GitHub Actions' own `on.*.paths` would gate the *entire* workflow file, including the
always-must-run `CI`/release job). It always runs in full on `workflow_dispatch`, `schedule`
(weekly, Monday 06:00 UTC, for API-drift detection), and pushes to `main`.

**Secrets/variables** (repo-level, `firstsun-dev/git-files-sync`):

| Name | Kind |
|---|---|
| `E2E_GITHUB_TOKEN` | secret |
| `E2E_GITHUB_OWNER` | variable |
| `E2E_GITHUB_REPO` | variable |
| `E2E_GITLAB_PROJECT_ID` | secret (not a variable — it's treated as sensitive here) |
| `E2E_GITLAB_TOKEN` | secret |

**Fork PRs** only run the Gitea cell (checked in the `Determine whether this provider leg should
run` step — GitHub Actions job-level `if:` can't reference the `matrix` context, so this can't
live on the job itself; it gates every later step instead) — GitHub/GitLab need real credentials
that must never be exposed to an untrusted fork's workflow run. Gitea needs no repo secrets at
all, so it's safe to run unconditionally.

**Missing credentials are always a hard failure**, never a silent skip, for any cell that
actually runs (`scripts/e2e-harness.sh`'s `normalize_env`/`: "${VAR:?...}"` checks required env
vars up front) — the job-level `if:` above is what decides whether a cell *should* run for a
given event; once it runs, it's expected to have what it needs.

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
structurally cannot produce.

## Cleanup / troubleshooting

- **Stale `gfs-e2e-<provider>-*` branch** (GitHub/GitLab only — Gitea's whole container is
  removed by `cleanup`): `scripts/e2e-harness.sh sweep` best-effort deletes any branch of that
  pattern older than 24h, using `git for-each-ref`/`git push --delete` — no REST calls.
- **Inspecting a failing run**: set `E2E_KEEP_BRANCH=1` before running so teardown is skipped,
  then look at the branch/container directly. Remember to clean it up yourself afterward, or run
  `scripts/e2e-harness.sh sweep`.
- **Gitea container port/name clashes**: each run's container is named `gfs-e2e-gitea-$$` (PID)
  and binds to a Docker-assigned host port, so concurrent local runs don't collide; a leftover
  container from an interrupted run can be removed manually (`docker rm -f <name>`).
- **`E2E_PROVIDER is not set` error**: `vitest.e2e.config.ts` refuses to run directly under
  `npx vitest` — always go through `npm run test:e2e -- --provider <name>` (or the CI steps),
  which set it.

## Known gaps

- SyncManager E2E against GitHub/GitLab uses the same harness as Gitea (no provider-specific
  code) but has only been exercised end-to-end locally against Gitea (Docker, no external
  credentials available in this environment) — not yet actually executed against live
  GitHub/GitLab sandboxes from this checkout.
- The `provider-e2e` matrix job targets `runs-on: [self-hosted, linux, x64, 32gb-ram]`; its
  actual execution on that fleet, and the `e2e-gate` -> `CI` dependency chain end-to-end in a
  real workflow run, are unverified from this checkout (no self-hosted runner access here).
- Branch-protection required-check configuration (`E2E / gitea`) is a manual follow-up for
  whoever has admin access to the repo.
- The official Obsidian community-plugin scanner rescan (as opposed to this repo's own
  grep-based self-audit, `docs/obsidian-scanner-audit.md`) hasn't been re-run against this
  harness from this checkout.
