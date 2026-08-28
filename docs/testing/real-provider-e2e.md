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
  into `$E2E_RUNTIME_DIR`, not committed. Suites import these statically — `obsidian` and
  `@e2e-runtime/git-verifier` are both resolved via `vitest.e2e.config.ts`'s `alias` map to
  `$E2E_RUNTIME_DIR` at E2E runtime only. `e2e/runtime-modules.d.ts` gives
  `@e2e-runtime/git-verifier` a compile-time shape (backed by `e2e/verifier-runtime-types.ts`)
  so `npm run build`'s typecheck never needs the generated files to exist — no committed
  suite ever does a runtime-computed dynamic `import()`, so there's nothing scanner-visible
  for the Obsidian security lint rules to flag.

## Layout

- `scripts/e2e-harness.sh` — `provision` / `seed` / `verify` / `cleanup`. See its own header
  comment for the full command surface. `cleanup` here is layer 1 of the isolation model below —
  it only ever touches the single branch its own run owns.
- `scripts/e2e-namespace.sh` — the one canonical implementation of branch-name identity
  (`e2e/pr/<n>/**` / `e2e/branch/<id>/**`), sourced by `e2e-harness.sh`, `e2e-namespace-cleanup.sh`,
  and `e2e-janitor.sh`. See "Isolation model" below.
- `scripts/e2e-namespace-cleanup.sh` — layer 2: deletes a whole `e2e/pr/<n>/**` or
  `e2e/branch/<id>/**` namespace. Called by `.github/workflows/e2e-pr-cleanup.yml` /
  `e2e-branch-cleanup.yml`, never by the normal per-run job.
- `scripts/e2e-janitor.sh` — layer 3: TTL-based sweep of any leftover `e2e/**` branch, run by
  `.github/workflows/e2e-janitor.yml` on a schedule.
- `scripts/run-e2e.sh` — the shared local/CI entry point: provision → seed → vitest → cleanup.
  It allocates a unique temporary workdir when the caller does not supply one, so concurrent local
  runs cannot overwrite each other's repository, runtime adapters, or credentials.
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

## Isolation model

**Core invariant: cleanup is best-effort, isolation is mandatory.** A failed or cancelled run may
leave an orphan branch behind on the sandbox repo; the next run must still get completely
independent state regardless. Isolation comes from every run getting a *unique* branch name, never
from successful cleanup — the three cleanup layers below exist to bound how much garbage
accumulates, not to make isolation correct in the first place. Git branch names on the dedicated
sandbox repos remain the sole lifecycle source of truth; there is no separate database or
state registry.

### Branch namespace

All identity computation lives in `scripts/e2e-namespace.sh` — the single canonical
implementation, sourced by the normal run (`e2e-harness.sh`), both cleanup layers
(`e2e-namespace-cleanup.sh`), and the janitor (`e2e-janitor.sh`), so the naming/sanitization
algorithm can never drift between them.

PR runs:

```
e2e/pr/<pr-number>/<provider>/run-<run-id>-<run-attempt>
```

Branch-only runs (`push` to a non-PR branch, `workflow_dispatch`, `schedule`):

```
e2e/branch/<sanitized-source-branch>-<short-hash>/<provider>/run-<run-id>-<run-attempt>
```

The short hash (first 8 hex chars of a SHA-256 of the *original* branch name) exists so two
differently-slashed branch names that sanitize to the same string — `feature/foo-bar` and
`feature-foo/bar` both sanitize to `feature-foo-bar` — still get distinct identities and can never
collide. `run-<run-id>-<run-attempt>` (from `GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT`, or a
`local-<epoch>-<pid>` fallback outside CI) means a repeated push, a workflow rerun, and every
provider-matrix leg each get their own branch — nothing is ever reused across runs, and a previous
killed run's branch is simply never touched by the next one.

### Concurrency and cancellation

`.github/workflows/ci.yml`'s E2E jobs carry per-source/per-provider concurrency groups with
`cancel-in-progress: true`. Push and pull-request runs use the same branch identity, so a push to a
branch with an open PR cancels its duplicate instead of both competing for runner/provider
capacity. Manual dispatches and schedules use `<event>-<run-id>` instead: they must not cancel a
normal PR's required checks or a push's provider run. The two cleanup workflows share the
branch-based group naming used by push/PR runs, with
`cancel-in-progress: false`, so cleanup queues behind rather than races an active run.
The cancelled duplicate's `CI / Required Checks` treats the cancelled leg as a failure, but that
run is for the superseded commit — the surviving run (the one GitHub uses for the latest commit)
is responsible for the real provider result and release gate, so the cancelled duplicate's red
gate is harmless and doesn't start any release work (it gates `package`/`publish`).
**Cancellation is not a cleanup mechanism.** A cancelled run's `cleanup` step may never execute, or
may be mid-delete when the runner is terminated; the next run is still safe because it always
allocates a brand-new `run-<run-id>-<run-attempt>` branch rather than deleting and reusing the old
one.

### Cleanup hierarchy

```mermaid
flowchart TD
    A[Run starts] --> B[allocate unique branch\ne2e/pr/../run-id-attempt\nor e2e/branch/../run-id-attempt]
    B --> C[provision -> seed -> vitest -> verify]
    C --> D["Layer 1: current-run cleanup\n(scripts/e2e-harness.sh cleanup)\nif: always(), best-effort"]
    D -.may not run.-> E[orphan branch]
    F[PR closed] --> G["Layer 2: e2e-pr-cleanup.yml\ndelete e2e/pr/&lt;n&gt;/**"]
    H[source branch deleted] --> I["Layer 2: e2e-branch-cleanup.yml\ndelete e2e/branch/&lt;id&gt;/**"]
    G -.may also fail.-> E
    I -.may also fail.-> E
    E --> J["Layer 3: e2e-janitor.yml (scheduled)\ndelete any e2e/** branch older than TTL"]
```

1. **Layer 1 — current-run cleanup** (`scripts/e2e-harness.sh cleanup`, `if: always()` in
   `ci.yml`): deletes only the one branch this run itself created, with generic
   `git push origin --delete`. `E2E_KEEP_BRANCH=1` deliberately skips this for debugging. Never a
   wildcard, never touches another run's branch.
2. **Layer 2 — PR/branch lifecycle cleanup** (`.github/workflows/e2e-pr-cleanup.yml`,
   `e2e-branch-cleanup.yml`): authoritative once a PR closes (merged or not) or its source branch
   is deleted — removes the *entire* `e2e/pr/<n>/**` or `e2e/branch/<id>/**` namespace across every
   provider/run. `e2e-pr-cleanup.yml` uses `pull_request_target` so it always runs this repo's own
   trusted workflow/scripts with secrets available, and its `actions/checkout` step takes no `ref:`
   override — it resolves to the base branch that triggered the event, never the closing PR's own
   branch content. Both cleanup workflows use the same concurrency group names as the normal
   `provider-e2e` job with `cancel-in-progress: false`, so cleanup queues behind an active run for
   the same PR/branch/provider instead of racing it.
3. **Layer 3 — scheduled janitor** (`.github/workflows/e2e-janitor.yml` →
   `scripts/e2e-janitor.sh`, every 6h, `E2E_JANITOR_TTL_SECONDS` default 24h): catches whatever
   layers 1 and 2 missed — runner crashes, forced cancellations, workflow timeouts, a cleanup
   workflow itself failing, or network failure. Operates only on `refs/remotes/origin/e2e/**` on
   the dedicated sandbox repos (github/gitlab — gitea has no persistent branches, its whole
   container is disposable), using plain `git for-each-ref`/`git push --delete`; tolerates
   already-deleted refs and never aborts the whole sweep over one bad ref. Never reintroduces a
   Node-based sweeper (`scripts/e2e-sweep-branches.mjs` or similar) — generic git only.

The design goal is **not** "the sandbox repos are always perfectly clean" — it's that old garbage,
however it got there, can never contaminate a current run's state.

### Workspace isolation

`provider-e2e` runs on a persistent self-hosted fleet, so `E2E_WORKDIR` is pinned per
run/attempt/provider rather than relying on a fresh filesystem or a shared `/tmp` path:

```
$RUNNER_TEMP/git-files-sync-e2e/<run-id>/<run-attempt>/<provider>/
```

set once near the start of each E2E job so every later process shares it, and a
previous killed job's leftover files under a different run-id/attempt can never leak into the
current one. Locally, `scripts/run-e2e.sh` uses `mktemp` to allocate a unique workdir per invocation
and removes it after cleanup. `E2E_KEEP_BRANCH=1` deliberately preserves both the container/branch
and workdir for debugging.

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
| `E2E_WORKDIR` | any (optional) | shared scratch dir across provision/seed/vitest/cleanup; the wrapper defaults to a unique temporary directory |

Gitea needs Docker locally and nothing else. Its disposable container publishes port 3000 on a
Docker-assigned `127.0.0.1` port, so it never depends on the host's bridge subnet and parallel runs
do not contend for a fixed port.

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

`.github/workflows/ci.yml` runs five validation jobs **in parallel** right after a push/PR, with no
validation waiting on E2E:

- `CI / Lint` — `eslint .`
- `CI / Unit Test (Node 22|24)` — `vitest run --coverage`, matrix `fail-fast: false`
- `CI / Build` — `tsc -noEmit` + Obsidian 1.11.0 compat typecheck + esbuild; uploads
  `main.js`/`manifest.json`/`styles.css` as an artifact for ad-hoc PR install (non-main branches
  only)
- `CI / Provider E2E / gitea` — disposable Gitea on `ubuntu-latest`
- `CI / Provider E2E / <provider>` — the credentialed GitHub/GitLab matrix below

The E2E jobs are separated by trust boundary. Gitea runs on a fresh GitHub-hosted VM with only
`contents: read`; it is safe for fork PRs because it receives no repository secrets and cannot
access the persistent runner fleet. The credentialed `github`/`gitlab` matrix remains self-hosted,
and its job-level condition rejects fork PRs before runner allocation. Both depend on the
`changes` job's path gate (`src/services/**`,
`src/logic/sync-manager.ts`, `e2e/**`, `scripts/e2e-harness.sh`, `scripts/e2e-namespace.sh`, etc. —
computed by the `CI / Detect Changes` job, since GitHub Actions' own `on.*.paths` would gate the
*entire* workflow file, including the always-must-run validation/release jobs). It always runs in
full on `workflow_dispatch`, `schedule` (weekly, Monday 06:00 UTC, for API-drift detection), and
pushes to `main`. Each job carries a per-source/provider `concurrency` group (see "Isolation model"
above) and a run/attempt/provider-scoped workdir.

Two more workflows round out the isolation model's other cleanup layers — see "Isolation model"
above for what each does and why:

- `.github/workflows/e2e-pr-cleanup.yml` — `pull_request_target: [closed]`
- `.github/workflows/e2e-branch-cleanup.yml` — `delete` (branch ref)
- `.github/workflows/e2e-janitor.yml` — `schedule` (every 6h) + `workflow_dispatch`

**Secrets/variables** (repo-level, `firstsun-dev/git-files-sync`):

| Name | Kind |
|---|---|
| `E2E_GITHUB_TOKEN` | secret |
| `E2E_GITHUB_OWNER` | variable |
| `E2E_GITHUB_REPO` | variable |
| `E2E_GITLAB_PROJECT_ID` | secret (not a variable — it's treated as sensitive here) |
| `E2E_GITLAB_TOKEN` | secret |

**Fork PRs** only run the Gitea job on `ubuntu-latest`. The credentialed GitHub/GitLab job is
rejected at job level, so untrusted code is never scheduled on the self-hosted runner fleet.

**Missing credentials are always a hard failure**, never a silent skip, for any cell that
actually runs (`scripts/e2e-harness.sh`'s `normalize_env`/`: "${VAR:?...}"` checks required env
vars up front) — the job-level `if:` above is what decides whether a cell *should* run for a
given event; once it runs, it's expected to have what it needs.

## Release gating

```
changes ──► gitea-e2e [GitHub-hosted] ────────────────────────┐
        └─► provider-e2e [github | gitlab, self-hosted] ──────┤
lint ─────────────────────────────────────────────────────────┤
unit-test (Node 22|24) ───────────────────────────────────────┤──► required-checks ──► package
build ────────────────────────────────────────────────────────┘                  └──► publish (main only)
```

All five validation jobs start in parallel; a lint/unit/build error now surfaces in <1-2 min
instead of after the real-provider matrix. `CI / Required Checks` runs with `if: always()` and
passes only when every validation job reports `success` or `skipped` (a path-filtered-out or
fork-gated-off `provider-e2e` leg reports `success` because its steps are skipped, not failed).
Any other result — including a `cancelled` matrix leg replaced by a newer run in the same
concurrency group — fails the gate; the surviving run is the one whose gate result GitHub uses
for the latest commit. `Release / Package` and `Release / Publish` both run only after the gate
passes, so a real provider regression still blocks the release instead of shipping and being
caught after the fact. `Release / Publish` additionally requires `main`/`master` (semantic-release
only releases on those branches — see `.releaserc.json`).

**Branch protection** (not something this repo checkout can change — a GitHub repo-settings
change, left for whoever has admin access): add `CI / Required Checks` as the single required
status check. It aggregates Gitea, credentialed providers, lint, tests, and build while still
allowing structurally skipped jobs. Requiring only the aggregate avoids wedging a fork PR on
GitHub/GitLab checks it cannot produce.

## Cleanup / troubleshooting

- **Stale `e2e/pr/**` or `e2e/branch/**` branch** (GitHub/GitLab only — Gitea's whole container is
  removed by `cleanup`): normally handled by the cleanup hierarchy (see "Isolation model" above)
  without any manual step. To force it: `E2E_PROVIDER=github|gitlab scripts/e2e-janitor.sh`
  (TTL-based, `E2E_JANITOR_TTL_SECONDS` to override the 24h default) or, to remove one specific
  PR/branch's whole namespace immediately, `E2E_PROVIDER=... E2E_PR_NUMBER=<n>` (or
  `E2E_SOURCE_BRANCH=<name>`) `scripts/e2e-namespace-cleanup.sh`. Both need
  `E2E_GITHUB_OWNER`/`E2E_GITHUB_REPO`/`E2E_GITHUB_TOKEN` or `E2E_GITLAB_PROJECT_ID`/
  `E2E_GITLAB_TOKEN` in the environment, same as the harness.
- **Inspecting a failing run**: set `E2E_KEEP_BRANCH=1` before running so teardown is skipped,
  then look at the branch/container directly. Remember to clean it up yourself afterward (see
  above) — or just let the janitor catch it within its TTL.
- **Gitea container port/name clashes**: each name includes run ID, attempt, and PID, while Docker
  assigns its loopback host port. Concurrent runs also use separate `mktemp` workdirs. A container
  left by a hard-killed local process can be removed manually (`docker rm -f <name>`).
- **`E2E_PROVIDER is not set` error**: `vitest.e2e.config.ts` refuses to run directly under
  `npx vitest` — always go through `npm run test:e2e -- --provider <name>` (or the CI steps),
  which set it.

## Known gaps

- A real external fork PR has not yet exercised the fork event context end to end. Workflow
  contracts enforce the trust split, and targeted run 33048613679 proved the equivalent
  `Gitea success + credentialed providers skipped` path through downstream validation.
- Branch-protection required-check configuration (`CI / Required Checks`) is a manual follow-up
  for whoever has admin access to the repo.
- The official Obsidian community-plugin scanner rescan (as opposed to this repo's own
  grep-based self-audit, `docs/obsidian-scanner-audit.md`) hasn't been re-run against this
  harness from this checkout.
- The Phase 2 isolation model (namespace scheme, per-source/provider concurrency groups,
  `e2e-pr-cleanup.yml`, `e2e-branch-cleanup.yml`, `e2e-janitor.yml`) is verified by local
  unit-level exercises of `scripts/e2e-namespace.sh`/`e2e-namespace-cleanup.sh`/`e2e-janitor.sh`
  against throwaway local repos, plus YAML validation of the new/changed workflow files — not yet
  by an actual concurrent-PR/cancelled-run/janitor-TTL scenario on the real self-hosted fleet
  against the live sandbox repos (no self-hosted runner or sandbox credentials in this
  environment, same gap as the two items above).
