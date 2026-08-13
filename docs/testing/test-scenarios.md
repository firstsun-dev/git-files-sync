# Test Scenarios

This document summarizes the major product behaviors, data-safety guarantees, and failure modes covered by Git File Sync's automated tests.

It is intentionally higher-level than the file-by-file inventory in [`docs/test-coverage.md`](../test-coverage.md). For priority and coverage status, see [`test-matrix.md`](test-matrix.md). For the real-provider harness and CI design, see [`real-provider-e2e.md`](real-provider-e2e.md).

## 1. Core synchronization

### Push

Validate that local changes can be written to the configured Git repository without corrupting remote state.

Representative scenarios:

- create a new remote file
- update an existing remote file
- push multiple files
- skip an unchanged file without creating an unnecessary commit
- update synchronization metadata after a successful write
- surface provider failures instead of reporting a false success

### Pull

Validate that remote state can be applied safely to the Obsidian vault.

Representative scenarios:

- pull a remote update into an existing local file
- pull a remote-only file
- create missing parent directories
- pull multiple files
- update synchronization metadata after a successful pull
- handle missing or failed remote reads

## 2. Conflict and overwrite safety

Conflict detection is a release-critical safety boundary. A stale local client must not silently overwrite newer remote content, and a skipped conflict must not be recorded as synchronized.

Representative scenarios:

- detect that the remote revision changed since the last synchronization
- distinguish synchronized state from a true two-sided conflict
- keep the local version when explicitly chosen
- keep the remote version when explicitly chosen
- skip a conflict without mutating the remote repository
- preserve the previous sync metadata when a conflict is not resolved

## 3. Rename and move integrity

A rename should remain a move, not become an accidental delete-plus-duplicate sequence.

Representative scenarios:

- detect a local rename
- move the remote path to the new path
- verify that the old remote path disappears
- preserve file contents at the new path
- perform the move in a single Git commit where the provider supports the batch operation
- surface rename failures without corrupting metadata

## 4. Batch synchronization

Batch operations must preserve the same safety guarantees as single-file operations.

Representative scenarios:

- push multiple files successfully
- report partial failures correctly
- process renamed files inside a batch
- preserve per-file progress reporting
- write the intended batch as one Git commit in the real-provider path

## 5. Filesystem, path, and content handling

Synchronization must preserve file identity and bytes across vault and repository path transformations.

Representative scenarios:

- map `vaultFolder` paths to repository-relative paths
- apply `rootPath` without double-prefixing or sibling-path collisions
- handle root-level and nested files
- create hidden parent directories when required
- synchronize hidden files when they are not ignored
- classify common binary extensions correctly
- preserve binary contents during push and pull
- avoid unnecessary binary writes when bytes are unchanged

## 6. Ignore behavior

Files excluded by ignore rules must not accidentally enter the synchronization set.

Representative scenarios:

- root `.gitignore`
- nested `.gitignore`
- local ignore rules with remote fallback
- negated rules
- directory-only rules
- deep wildcard rules
- hidden directories

## 7. Provider contract

GitHub, GitLab, and Gitea have different APIs, but the plugin expects them to satisfy the same synchronization contract.

The real-provider suites exercise the common contract against real Git servers:

- repository and branch connectivity
- create
- read
- update
- delete
- batch write
- rename / move

Remote state is verified independently through Git rather than by asking the provider implementation to read back its own write.

## 8. Provider-specific correctness

Some correctness guarantees exist only because a provider has unique API semantics.

### GitHub

Representative regression and behavior coverage includes:

- Git symlink creation with mode `120000`
- GraphQL HTTP 200 responses containing `errors[]` must still reject the operation
- concurrent writes that invalidate `expectedHeadOid` must recover without losing either write

### GitLab

GitLab exposes separate content and write-lock identities (`blob_id` and `last_commit_id`). Regression coverage protects the separation between file SHA and revision so that:

- a normal pull-edit-push flow does not produce a false conflict
- a genuinely stale revision is rejected
- the historical bug where a blob SHA was used as the optimistic-lock token remains reproducible and guarded
- batch writes after a pull remain valid

## 9. Real-provider E2E

The current real-provider E2E layer is a gray-box system test: it executes production `SyncManager` and provider implementations against real Git servers while replacing only the Obsidian filesystem/UI boundary required by the harness.

Typical flow:

```text
production SyncManager / provider
        -> real Git provider
        -> real repository mutation
        -> independent Git verifier
```

This layer catches provider API drift, optimistic-locking mistakes, commit-shape regressions, and synchronization bugs that mocks cannot represent reliably.

## 10. Packaged-plugin black-box E2E

A thinner, higher-level black-box suite is planned as the final refactoring safety net.

The canonical target is GitHub because it represents the most important production provider path. The suite should treat the packaged plugin artifact as the system under test and avoid importing internal classes such as `SyncManager` or provider implementations.

Planned user journey:

```text
fresh temporary Obsidian vault
        -> install packaged plugin artifact
        -> configure dedicated GitHub sandbox branch
        -> create local files
        -> push
        -> independently verify GitHub repository
        -> mutate repository remotely
        -> pull
        -> verify vault contents
        -> exercise conflict / rename / batch / delete
        -> clean up branch and vault
```

P0 black-box scenarios should remain unchanged during an internal refactor unless the product contract intentionally changes.

## 11. Compatibility coverage

Provider-version compatibility is separate from functional correctness. The goal is to execute the same provider contract against representative supported server versions rather than validating only the newest release.

This coverage is planned as a version matrix, especially for self-hosted GitLab and Gitea. Until that matrix is enabled, compatibility claims should continue to be treated separately from the real-provider functional suites.
