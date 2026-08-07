# Obsidian Scanner Audit — E2E Removal

## Baseline

The official scanner's pre-removal result reported 22 `fetch` findings, four
`globalThis` findings, two findings each for `node:crypto`,
`node:child_process`, and `node:util`, plus bare-timer and unnecessary
assertion warnings. The source audit maps them as follows.

| Finding | Exact pre-removal location | Classification |
| --- | --- | --- |
| `fetch` (22) | `e2e/verifier/gitea-verifier.ts` (3); `e2e/verifier/github-verifier.ts` (5); `e2e/verifier/gitlab-verifier.ts` (3); `e2e/provision/github-provision.ts` (4); `e2e/provision/gitea-provision.ts` (3); `e2e/provision/gitlab-provision.ts` (3); `e2e/shim/obsidian-request-url.ts` (1) | E2E/Node tooling |
| `globalThis` (4) | `e2e/shim/window-timers.ts:12` (1), `e2e/shim/window-timers.ts:13` (3) | E2E/Node tooling |
| `node:crypto` (2) | `e2e/namespace.ts:1`; `e2e/provision/gitea-provision.ts:1` | E2E/Node tooling |
| `node:child_process` (2) | `e2e/provision/docker.ts:1`; `e2e/provision/gitea-provision.ts:2` | E2E/Node tooling |
| `node:util` (2) | `e2e/provision/docker.ts:2`; `e2e/provision/gitea-provision.ts:3` | E2E/Node tooling |
| bare timers | `e2e/provision/docker.ts:53`; `e2e/suites/github.e2e.test.ts:33` | E2E/Node tooling |
| unnecessary assertions | `e2e/config/env.ts:83` (`projectId as string`, `token as string`) | E2E/Node tooling |

The repository also had test-bootstrap `globalThis` use in `tests/**` and a
Node `child_process` import in `scripts/typecheck-compat.mjs`; these are unit
test support and retained Node build tooling respectively, not shipping
runtime. No baseline finding maps to `src/**`: provider HTTP uses
`BaseGitService.safeRequest()` and Obsidian `requestUrl()`.

## Post-removal source audit

| Check | Result |
| --- | --- |
| Direct native `fetch()` in `src/**` | None (the only text match is a comment in `src/services/gitlab-service.ts`) |
| `globalThis` in `src/**` | None |
| Bare timers in `src/**` | None; all use `window.*` |
| `node:(crypto|child_process|util)` in `src/**` | None |
| Retained Node built-in | `scripts/typecheck-compat.mjs:17` uses `node:child_process` for build tooling |
| Built `main.js` Node imports | None |

The official rescan must be recorded here with its submitted release result
after the normal 1.5.7 release workflow completes.
