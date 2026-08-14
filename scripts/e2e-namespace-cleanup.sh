#!/usr/bin/env bash
# Layer-2 namespace cleanup (see docs/testing/real-provider-e2e.md's cleanup
# hierarchy): PR-close deletes the whole e2e/pr/<n>/** namespace, source-
# branch-delete deletes the whole e2e/branch/<id>/** namespace. Identity/
# prefix computation is delegated to scripts/e2e-namespace.sh -- the same
# canonical implementation the normal E2E run (scripts/e2e-harness.sh) and
# the janitor (scripts/e2e-janitor.sh) use, so a PR/branch's cleanup prefix
# can never drift from the prefix its own runs actually wrote under.
#
# Intended to run only from trusted workflow code (this repo's own default
# branch) -- callers (.github/workflows/e2e-pr-cleanup.yml,
# e2e-branch-cleanup.yml) must never check out or execute the closing PR's
# own branch content while sandbox credentials are present in the job env.
#
# Usage:
#   E2E_PROVIDER=github|gitlab E2E_PR_NUMBER=123 scripts/e2e-namespace-cleanup.sh
#   E2E_PROVIDER=github|gitlab E2E_SOURCE_BRANCH=feature/foo scripts/e2e-namespace-cleanup.sh
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/e2e-namespace.sh
source "$script_dir/e2e-namespace.sh"

provider="${E2E_PROVIDER:-}"
if [ -z "$provider" ]; then
    echo "E2E_PROVIDER is not set (github|gitlab)." >&2
    exit 1
fi
if [ "$provider" = "gitea" ]; then
    echo "[e2e-namespace-cleanup:gitea] gitea has no persistent branches -- nothing to do." >&2
    exit 0
fi

if [ -n "${E2E_PR_NUMBER:-}" ]; then
    prefix="$(e2e_pr_prefix "$E2E_PR_NUMBER")"
elif [ -n "${E2E_SOURCE_BRANCH:-}" ]; then
    prefix="$(e2e_branch_prefix "$E2E_SOURCE_BRANCH")"
else
    echo "Set E2E_PR_NUMBER or E2E_SOURCE_BRANCH." >&2
    exit 1
fi

log() { echo "[e2e-namespace-cleanup:$provider] $*" >&2; }

setup_askpass() {
    local askpass_dir="${RUNNER_TEMP:-$workdir}"
    local askpass_path="$askpass_dir/e2e-namespace-cleanup-askpass.sh"
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

workdir="${E2E_WORKDIR:-${TMPDIR:-/tmp}/gfs-e2e-nscleanup-${provider}}"
mkdir -p "$workdir"

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
        echo "Unsupported E2E_PROVIDER: $provider (github|gitlab only)" >&2
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

deleted=0
failed=0

# `**` recurses across the multi-segment hierarchy under the prefix (see
# scripts/e2e-namespace.sh); scoping the pattern to that exact prefix is the
# safety boundary -- this script can only ever see/touch refs already under
# this one PR's or branch's own namespace.
while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    branch="${ref#refs/remotes/origin/}"
    log "Deleting $branch"
    if git -C "$dir" push origin ":refs/heads/${branch}"; then
        deleted=$((deleted + 1))
    else
        # Tolerates already-deleted refs (layer-1 cleanup or a previous
        # cleanup run already got there) -- never fails the whole sweep over
        # one ref.
        log "Failed to delete $branch (already gone, or transient) -- continuing"
        failed=$((failed + 1))
    fi
done < <(git -C "$dir" for-each-ref "refs/remotes/origin/${prefix}**" --format='%(refname)')

log "Deleted $deleted, $failed failed/already-gone (namespace: ${prefix}**)"
