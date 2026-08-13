#!/usr/bin/env bash
# Canonical E2E branch-namespace identity generation. Sourced by
# scripts/e2e-harness.sh (provision) and the three cleanup layers
# (current-run cleanup lives in e2e-harness.sh too; PR-close cleanup,
# branch-delete cleanup, and scripts/e2e-janitor.sh source this file
# directly) so there is exactly one sanitization/naming algorithm, not
# several drifting apart. See docs/testing/real-provider-e2e.md.
#
# Namespace layout:
#   e2e/pr/<pr-number>/<provider>/run-<run-id>-<run-attempt>
#   e2e/branch/<sanitized-source-branch>-<short-hash>/<provider>/run-<run-id>-<run-attempt>
#
# Git branch names remain the lifecycle source of truth -- no database, no
# separate state registry.
set -euo pipefail

# Deterministic short hash so differently-slashed branch names that would
# otherwise sanitize to the same string (feature/foo-bar vs feature-foo/bar)
# can never collide. sha256sum (not sha1sum/md5sum) -- purely a
# collision-avoidance digest, not a security control, but SHA-1/MD5 trip
# Sonar's weak-hash rule (S4790) regardless of context, and sha256sum is
# just as available.
e2e_branch_hash() {
    local name="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$name" | sha256sum | cut -c1-8
    else
        printf '%s' "$name" | shasum -a 256 | cut -c1-8
    fi
}

# Lowercase, replace anything outside [a-z0-9] with '-', collapse repeats,
# trim leading/trailing '-'. Git ref segments forbid many characters anyway
# (spaces, `~^:?*[`, consecutive dots, `@{`), so this also keeps the result
# ref-safe on its own.
e2e_sanitize() {
    local name="$1"
    name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
    [ -n "$name" ] || name="branch"
    echo "$name"
}

# Stable per-source-branch identity: sanitized name plus a content hash of
# the *original* name, so sanitize-collisions (see e2e_branch_hash comment)
# still resolve to distinct identities.
e2e_branch_id() {
    local branch_name="$1"
    local sanitized; sanitized="$(e2e_sanitize "$branch_name")"
    local hash; hash="$(e2e_branch_hash "$branch_name")"
    echo "${sanitized}-${hash}"
}

# run_id/run_attempt are always passed in explicitly by the caller (typically
# GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT) rather than read from the environment
# here, so this file behaves identically in CI and local dev/test.
e2e_run_suffix() {
    local run_id="$1" run_attempt="$2"
    echo "run-${run_id}-${run_attempt}"
}

e2e_pr_namespace() {
    local pr_number="$1" provider="$2" run_id="$3" run_attempt="$4"
    echo "e2e/pr/${pr_number}/${provider}/$(e2e_run_suffix "$run_id" "$run_attempt")"
}

e2e_branch_namespace() {
    local branch_name="$1" provider="$2" run_id="$3" run_attempt="$4"
    echo "e2e/branch/$(e2e_branch_id "$branch_name")/${provider}/$(e2e_run_suffix "$run_id" "$run_attempt")"
}

# Prefixes used by cleanup layers to sweep a whole namespace (every
# provider, every run) rather than one run's single branch.
e2e_pr_prefix() {
    local pr_number="$1"
    echo "e2e/pr/${pr_number}/"
}

e2e_branch_prefix() {
    local branch_name="$1"
    echo "e2e/branch/$(e2e_branch_id "$branch_name")/"
}

# Single entrypoint e2e-harness.sh's `provision` calls: PR runs take
# precedence (pr_number set) over branch-only runs (source_branch).
e2e_test_branch() {
    local provider="$1" run_id="$2" run_attempt="$3" pr_number="${4:-}" source_branch="${5:-}"
    if [ -n "$pr_number" ]; then
        e2e_pr_namespace "$pr_number" "$provider" "$run_id" "$run_attempt"
    else
        : "${source_branch:?e2e_test_branch: source_branch required when pr_number is empty}"
        e2e_branch_namespace "$source_branch" "$provider" "$run_id" "$run_attempt"
    fi
}
