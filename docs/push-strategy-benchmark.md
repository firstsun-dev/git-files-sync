# GitHub push strategy benchmark (#61)

## Procedure

Use a disposable repository and branch. For each file count (1, 5, 10, 25, 50, 100, 200), generate equal-size unique files, run the GraphQL path and then the developer-only `pushBatchViaGitDataApiForBenchmark` path on separate branches, and record the opt-in `PushTimingRecord` plus the REST wall time. Do not run this against a user vault or production branch.

The GraphQL record is enabled only by registering `setPushTimingHandler`; it contains no file paths, contents, token, repository identity, or network transmission. `providerProcessingMs` is intentionally `null`, because Obsidian's `requestUrl` API does not expose server-only timing.

## Deterministic request-count result

| Files | GraphQL requests | Git Data API requests | Git Data API request waves (8 concurrent blobs) |
| ---: | ---: | ---: | ---: |
| 1 | 2 | 6 | 6 |
| 5 | 2 | 10 | 6 |
| 10 | 2 | 15 | 7 |
| 25 | 2 | 30 | 9 |
| 50 | 2 | 55 | 12 |
| 100 | 2 | 105 | 18 |
| 200 | 2 | 205 | 30 |

GraphQL performs a branch-head read and one mutation; the caller marks the committed paths synced without a tree readback. Git Data API performs a ref read, commit read, one blob upload per file, tree creation, commit creation, and ref update. The table is covered by service tests for both implementations.

## Decision

Keep GraphQL as the production strategy for every supported batch size (1–200). There is no request-count crossover: Git Data API starts with four additional round trips and adds one request per file. The REST path remains developer-only so provider benchmarks can challenge this conclusion without adding a user-facing strategy switch.
