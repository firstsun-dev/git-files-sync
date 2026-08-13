#!/usr/bin/env bash
# Scheduled orphan cleanup for e2e/** branches on dedicated E2E sandbox
# repos only (github/gitlab -- gitea's per-run isolation is a whole
# disposable container torn down by scripts/e2e-harness.sh's own `cleanup`,
# so there is nothing persistent for this script to sweep there).
#
# This is layer 3 of the cleanup hierarchy (see
# docs/testing/real-provider-e2e.md): current-run cleanup (layer 1, in
# scripts/e2e-harness.sh) and PR-close/branch-delete cleanup (layer 2, the
# e2e-pr-cleanup.yml / e2e-branch-cleanup.yml workflows) are both
# best-effort and can both fail to run at all (runner killed, SIGTERM,
# cleanup workflow itself failing). This script's only job is to garbage-
# collect whatever they left behind, gated on a TTL -- it is NOT what makes
# isolation between runs correct (that's namespace uniqueness; see
# scripts/e2e-namespace.sh). Never restores scripts/e2e-sweep-branches.mjs
# or any other Node-based sweeper -- generic git only.
#
# Usage: E2E_PROVIDER=github|gitlab scripts/e2e-janitor.sh
set -euo pipefail
# Per-branch delete failures are handled explicitly (if/else around the
# `git push --delete` below), not by disabling -e -- one stale/already-
# deleted/racy ref must never abort the whole sweep, but any other failure
# (bad credentials, unreachable remote) should still fail loudly.

provider="${E2E_PROVIDER:-}"
if [ -z "$provider" ]; then
    echo "E2E_PROVIDER is not set (github|gitlab)." >&2
    exit 1
fi
if [ "$provider" = "gitea" ]; then
    echo "[e2e-janitor:gitea] gitea has no persistent branches to sweep -- nothing to do." >&2
    exit 0
fi

ttl_seconds="${E2E_JANITOR_TTL_SECONDS:-86400}"
workdir="${E2E_WORKDIR:-${TMPDIR:-/tmp}/gfs-e2e-janitor-${provider}}"
mkdir -p "$workdir"

log() { echo "[e2e-janitor:$provider] $*" >&2; }

# --- credentials / remote resolution ----------------------------------------
# Narrow, read-only reimplementation of e2e-harness.sh's normalize_env: this
# script must never take that function's gitea-container-provisioning branch
# (guarded against above), so it isn't sourced from there.

setup_askpass() {
    local askpass_dir="${RUNNER_TEMP:-$workdir}"
    local askpass_path="$askpass_dir/e2e-janitor-askpass.sh"
    {
        printf '#!/bin/sh\n'
        printf 'case "$1" in\n'
        printf '  *sername*) printf %%s "%s" ;;\n' "$E2E_GIT_USERNAME"
        printf '  *assword*) printf %%s "%s" ;;\n' "$E2E_GIT_TOKEN"
        printf 'esac\n'
    } >"$askpass_path"
    chmod 700 "$askpass_path"
    export GIT_ASKPASS="$askpass_path"
    export GIT_TERMINAL_PROMPT=0
}

case "$provider" in
    github)
        : "${E2E_GITHUB_OWNER:?E2E_GITHUB_OWNER must be set}"
        : "${E2E_GITHUB_REPO:?E2E_GITHUB_REPO must be set}"
        : "${E2E_GITHUB_TOKEN:?E2E_GITHUB_TOKEN must be set}"
        repo_url="https://github.com/${E2E_GITHUB_OWNER}/${E2E_GITHUB_REPO}.git"
        export E2E_GIT_USERNAME="x-access-token"
        export E2E_GIT_TOKEN="$E2E_GITHUB_TOKEN"
        ;;
    gitlab)
        : "${E2E_GITLAB_TOKEN:?E2E_GITLAB_TOKEN must be set}"
        : "${E2E_GITLAB_PROJECT_ID:?E2E_GITLAB_PROJECT_ID must be set}"
        base_url="${E2E_GITLAB_BASE_URL:-https://gitlab.com}"
        project_json=$(curl -sS --max-time 15 -H "PRIVATE-TOKEN: ${E2E_GITLAB_TOKEN}" \
            "${base_url}/api/v4/projects/${E2E_GITLAB_PROJECT_ID}")
        repo_url=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).http_url_to_repo)' <<<"$project_json")
        export E2E_GIT_USERNAME="oauth2"
        export E2E_GIT_TOKEN="$E2E_GITLAB_TOKEN"
        ;;
    *)
        echo "Unsupported E2E_PROVIDER for janitor: $provider (github|gitlab only)" >&2
        exit 1
        ;;
esac
setup_askpass

dir="$workdir/repo"
if [ ! -d "$dir/.git" ]; then
    log "Cloning $repo_url"
    git clone --no-tags --filter=blob:none "$repo_url" "$dir"
else
    git -C "$dir" fetch origin --prune
fi

now_epoch=$(date +%s)
cutoff_epoch=$((now_epoch - ttl_seconds))

swept=0
kept=0
failed=0

# `**` (not a single `*`) is required for for-each-ref to recurse across the
# multi-segment e2e/pr/<n>/<provider>/<run> and
# e2e/branch/<id>/<provider>/<run> hierarchy -- see scripts/e2e-namespace.sh.
# Scoping the pattern to `e2e/**` up front, rather than filtering a broader
# listing in shell, is the actual safety boundary: this script can only ever
# see/touch refs already under that prefix.
while IFS=' ' read -r ref ts; do
    [ -n "$ref" ] || continue
    branch="${ref#refs/remotes/origin/}"
    ts_val="${ts:-0}"
    if [ "$ts_val" -ge "$cutoff_epoch" ]; then
        kept=$((kept + 1))
        continue
    fi
    log "Sweeping stale branch $branch (age $((now_epoch - ts_val))s > ttl ${ttl_seconds}s)"
    if git -C "$dir" push origin ":refs/heads/${branch}"; then
        swept=$((swept + 1))
    else
        # Tolerates already-deleted refs (a concurrent janitor run, or
        # layer-1/layer-2 cleanup racing this one) and any other
        # single-branch failure -- never let one bad ref abort the sweep.
        log "Failed to delete $branch (already gone, or transient) -- continuing"
        failed=$((failed + 1))
    fi
done < <(git -C "$dir" for-each-ref 'refs/remotes/origin/e2e/**' --format='%(refname) %(committerdate:unix)')

log "Swept $swept, kept $kept (within TTL), $failed delete attempts failed/already-gone"
exit 0
