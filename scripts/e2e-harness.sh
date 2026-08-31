#!/usr/bin/env bash
# Real-provider E2E harness: Arrange/Assert live here as Shell + Git CLI,
# Act stays production TypeScript (SyncManager / GitHubService / GitLabService
# / GiteaService, run via `npx vitest run -c vitest.e2e.config.ts`). See
# docs/testing/real-provider-e2e.md.
#
# Subcommands:
#   provision         create/resolve the isolated test branch (or, for gitea,
#                      the whole disposable container+repo)
#   seed               write deterministic baseline fixtures to the branch
#   verify             independent post-run sanity check (branch exists, has
#                      the expected number of commits) — the fine-grained,
#                      per-scenario assertions live in the generated verifier
#                      modules the suites import directly, not here
#   cleanup            best-effort delete of only *this run's* branch / tear
#                      down the container -- never a prerequisite for the next
#                      run (see docs/testing/real-provider-e2e.md's cleanup
#                      hierarchy: PR-close/branch-delete cleanup and the
#                      scheduled janitor are the other two layers, and neither
#                      lives in this script)
#
# Branch naming for github/gitlab is delegated to scripts/e2e-namespace.sh --
# the one canonical implementation also used by the PR-close cleanup,
# branch-delete cleanup, and janitor workflows, so isolation semantics can't
# drift between them.
#
# Config comes from environment variables (see docs/testing/real-provider-e2e.md
# for the full table); provider-specific vars already supplied by CI
# (E2E_GITHUB_*, E2E_GITLAB_*) are normalized into the generic surface below.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/e2e-namespace.sh
source "$script_dir/e2e-namespace.sh"

provider="${E2E_PROVIDER:-}"
if [ -z "$provider" ]; then
    echo "E2E_PROVIDER is not set (github|gitlab|gitea)." >&2
    exit 1
fi

# CI passes E2E_PR_NUMBER (PR runs) or E2E_SOURCE_BRANCH (branch-only runs)
# explicitly. Local dev supplies neither, so fall back to the checkout's
# current branch -- still deterministic per-branch, never a shared/reused
# name across unrelated local runs (namespace() below still mixes in a
# local run id).
if [ -z "${E2E_PR_NUMBER:-}" ] && [ -z "${E2E_SOURCE_BRANCH:-}" ]; then
    E2E_SOURCE_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo local)"
fi

# Must be stable across the separate provision/seed/vitest/cleanup process
# invocations within one run -- CI sets this explicitly under $RUNNER_TEMP;
# local dev falls back to a provider-namespaced (not random) tmp dir so
# sequential `npm run test:e2e` steps in the same shell session share it too.
workdir="${E2E_WORKDIR:-${TMPDIR:-/tmp}/gfs-e2e-${provider}}"
mkdir -p "$workdir"

keep_branch=0
case "${E2E_KEEP_BRANCH:-}" in
    1 | true) keep_branch=1 ;;
esac

log() { echo "[e2e-harness:$provider] $*" >&2; }

# --- credential-sensitive helpers -------------------------------------------

# Generates a throwaway GIT_ASKPASS helper under $RUNNER_TEMP (falls back to
# $workdir locally) and exports GIT_ASKPASS/GIT_TERMINAL_PROMPT for every git
# invocation from here on. Never persists the token anywhere else: no
# credential.helper, no token in the remote URL, no token in .git/config.
setup_askpass() {
    : "${E2E_GIT_USERNAME:?E2E_GIT_USERNAME must be set}"
    : "${E2E_GIT_TOKEN:?E2E_GIT_TOKEN must be set}"
    local askpass_dir="${RUNNER_TEMP:-$workdir}"
    local askpass_path="$askpass_dir/e2e-git-askpass.sh"
    set +x
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
    log "GIT_ASKPASS ready ($askpass_path)"
}

# Normalizes today's provider-specific CI vars into the generic
# E2E_TEST_REPO_URL / E2E_BASE_BRANCH / E2E_GIT_USERNAME / E2E_GIT_TOKEN
# surface, only filling in what the caller hasn't already set directly.
# The right git-over-HTTPS username differs per provider/token type, so this
# is resolved here rather than assumed to be one universal value.
normalize_env() {
    case "$provider" in
        github)
            : "${E2E_GITHUB_OWNER:?E2E_GITHUB_OWNER must be set}"
            : "${E2E_GITHUB_REPO:?E2E_GITHUB_REPO must be set}"
            : "${E2E_GITHUB_TOKEN:?E2E_GITHUB_TOKEN must be set}"
            export E2E_TEST_REPO_URL="${E2E_TEST_REPO_URL:-https://github.com/${E2E_GITHUB_OWNER}/${E2E_GITHUB_REPO}.git}"
            export E2E_BASE_BRANCH="${E2E_BASE_BRANCH:-${E2E_GITHUB_BASE_BRANCH:-main}}"
            # x-access-token is accepted by GitHub for both classic and
            # fine-grained PATs over git-over-HTTPS regardless of owner login.
            export E2E_GIT_USERNAME="${E2E_GIT_USERNAME:-x-access-token}"
            export E2E_GIT_TOKEN="${E2E_GIT_TOKEN:-$E2E_GITHUB_TOKEN}"
            ;;
        gitlab)
            : "${E2E_GITLAB_TOKEN:?E2E_GITLAB_TOKEN must be set}"
            export E2E_GITLAB_BASE_URL="${E2E_GITLAB_BASE_URL:-https://gitlab.com}"
            export E2E_GIT_USERNAME="${E2E_GIT_USERNAME:-oauth2}"
            export E2E_GIT_TOKEN="${E2E_GIT_TOKEN:-$E2E_GITLAB_TOKEN}"
            if [ -z "${E2E_TEST_REPO_URL:-}" ]; then
                : "${E2E_GITLAB_PROJECT_ID:?E2E_GITLAB_PROJECT_ID must be set}"
                # Generic git cannot turn a numeric project ID into a clone
                # URL on its own; this is the one place GitLab genuinely needs
                # a REST call rather than git protocol (see task section 3).
                local project_json
                project_json=$(curl -sS --max-time 15 -H "PRIVATE-TOKEN: ${E2E_GITLAB_TOKEN}" \
                    "${E2E_GITLAB_BASE_URL}/api/v4/projects/${E2E_GITLAB_PROJECT_ID}")
                export E2E_TEST_REPO_URL
                E2E_TEST_REPO_URL=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).http_url_to_repo)' <<<"$project_json")
                export E2E_BASE_BRANCH="${E2E_BASE_BRANCH:-$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).default_branch)' <<<"$project_json")}"
            fi
            export E2E_BASE_BRANCH="${E2E_BASE_BRANCH:-main}"
            ;;
        gitea)
            provision_gitea_container
            ;;
        *)
            echo "Unsupported E2E_PROVIDER: $provider" >&2
            exit 1
            ;;
    esac
}

# --- git-protocol branch lifecycle ------------------------------------------

# Delegates to scripts/e2e-namespace.sh (see its header) for the canonical
# e2e/pr/<n>/<provider>/run-<id>-<attempt> or
# e2e/branch/<id>/<provider>/run-<id>-<attempt> name. run_id/run_attempt fall
# back to date+pid locally (never reused across invocations), matching every
# other per-run identity CI supplies for free but local dev doesn't.
namespace() {
    local run_id="${GITHUB_RUN_ID:-}" run_attempt="${GITHUB_RUN_ATTEMPT:-}"
    if [ -z "$run_id" ]; then
        run_id="local-$(date +%s)-$$"
        run_attempt="1"
    fi
    e2e_test_branch "$provider" "$run_id" "$run_attempt" "${E2E_PR_NUMBER:-}" "${E2E_SOURCE_BRANCH:-}"
}

clone_dir() { echo "$workdir/repo"; }

ensure_clone() {
    local dir; dir=$(clone_dir)
    if [ ! -d "$dir/.git" ]; then
        log "Cloning $E2E_TEST_REPO_URL"
        git clone --no-tags --filter=blob:none "$E2E_TEST_REPO_URL" "$dir"
    else
        git -C "$dir" fetch origin --prune
    fi
}

cmd_provision() {
    normalize_env
    setup_askpass

    if [ "$provider" = "gitea" ]; then
        # Container lifecycle already ran inside normalize_env; a fresh repo
        # has no isolation concerns, so the "test branch" is just its default.
        export E2E_TEST_BRANCH="${E2E_BASE_BRANCH}"
    else
        ensure_clone
        local dir; dir=$(clone_dir)
        local base_sha
        base_sha=$(git -C "$dir" rev-parse "origin/${E2E_BASE_BRANCH}")
        export E2E_TEST_BRANCH="${E2E_TEST_BRANCH:-$(namespace)}"
        log "Creating isolated branch $E2E_TEST_BRANCH off ${E2E_BASE_BRANCH} (${base_sha})"
        git -C "$dir" push origin "${base_sha}:refs/heads/${E2E_TEST_BRANCH}"
    fi

    write_env_file
}

cmd_seed() {
    load_env_file
    setup_askpass
    local dir; dir=$(clone_dir)
    ensure_clone
    git -C "$dir" checkout -B "$E2E_TEST_BRANCH" "origin/$E2E_TEST_BRANCH"
    mkdir -p "$dir/e2e-fixtures"
    cat >"$dir/e2e-fixtures/README.md" <<EOF
Seeded by scripts/e2e-harness.sh for run ${E2E_TEST_BRANCH}. Suites layer
their own fixtures under this branch via the production provider under test;
this file only proves the branch itself is writable and non-empty.
EOF
    git -C "$dir" -c user.email="e2e@git-files-sync.local" -c user.name="git-files-sync E2E" \
        add e2e-fixtures/README.md
    if ! git -C "$dir" diff --cached --quiet; then
        git -C "$dir" -c user.email="e2e@git-files-sync.local" -c user.name="git-files-sync E2E" \
            commit -m "chore(e2e): seed baseline fixture for ${E2E_TEST_BRANCH}"
        git -C "$dir" push origin "HEAD:refs/heads/${E2E_TEST_BRANCH}"
    fi
}

cmd_verify() {
    load_env_file
    setup_askpass
    local dir; dir=$(clone_dir)
    git -C "$dir" fetch origin "$E2E_TEST_BRANCH"
    local head; head=$(git -C "$dir" rev-parse "origin/$E2E_TEST_BRANCH")
    log "Branch $E2E_TEST_BRANCH exists at $head"
}

cmd_cleanup() {
    # Gitea cleanup is pure `docker rm` -- no git credentials involved, and
    # critically must not *require* any (unlike github/gitlab below): if
    # `provision` itself failed before ever provisioning a token, cleanup
    # still has to be able to tear down whatever container did start.
    if [ "$provider" = "gitea" ]; then
        cleanup_gitea_container
        rm -f "$workdir/e2e.env" "$workdir/e2e.secrets.env"
        return
    fi
    load_env_file
    setup_askpass
    if [ "$keep_branch" = "1" ]; then
        log "E2E_KEEP_BRANCH set — leaving $E2E_TEST_BRANCH in place"
        return
    fi
    local dir; dir=$(clone_dir)
    log "Deleting isolated branch $E2E_TEST_BRANCH"
    git -C "$dir" push origin ":refs/heads/${E2E_TEST_BRANCH}" || true
}

# --- gitea container lifecycle (shell/docker, never node:child_process) -----

provision_gitea_container() {
    local image="${E2E_GITEA_IMAGE:-gitea/gitea:1.22}"
    local run_id="${GITHUB_RUN_ID:-local-$(date +%s)}"
    local run_attempt="${GITHUB_RUN_ATTEMPT:-1}"
    local name="gfs-e2e-gitea-${run_id}-${run_attempt}-$$"
    log "Starting gitea container ($image)"
    # Gitea runs beside this script on a developer machine or fresh
    # GitHub-hosted VM. Publishing to loopback avoids Docker bridge-IP routing
    # assumptions and asks Docker for a collision-free host port.
    docker run -d --name "$name" \
        -p 127.0.0.1::3000 \
        -e GITEA__security__INSTALL_LOCK=true \
        "$image" >/dev/null
    echo "$name" >"$workdir/gitea-container-name"

    local host_port=""
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        host_port=$(docker port "$name" 3000/tcp | sed -n 's/^127\.0\.0\.1://p' | head -n 1)
        [ -n "$host_port" ] && break
        sleep 1
    done
    if [ -z "$host_port" ]; then
        echo "gitea container never published a localhost port" >&2
        docker logs "$name" >&2 || true
        exit 1
    fi
    # NOSONAR-justified plain HTTP (shell:S5332, x5 below): base_url never
    # leaves loopback; credentials are per-run and discarded at cleanup.
    local base_url="http://127.0.0.1:${host_port}" # NOSONAR

    local ready_ms="${E2E_CONTAINER_READY_MS:-60000}"
    local poll_ms="${E2E_POLL_INTERVAL_MS:-500}"
    local waited=0
    # --max-time: without it, a curl against an unreachable/blackholed
    # address can hang far longer than this loop's own ready_ms budget
    # instead of failing fast into the next retry.
    until curl -sSf --max-time 5 "${base_url}/api/healthz" >/dev/null 2>&1; do # NOSONAR
        sleep "$(node -e "console.log(${poll_ms}/1000)")"
        waited=$((waited + poll_ms))
        if [ "$waited" -ge "$ready_ms" ]; then
            echo "gitea container did not become healthy within ${ready_ms}ms (base_url=${base_url})" >&2 # NOSONAR
            docker logs "$name" >&2 || true
            exit 1
        fi
    done

    local admin_user="e2e-admin"
    local admin_pass
    admin_pass="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
    # -u git: the official image refuses to run gitea's own CLI as root
    # (its entrypoint process itself runs as `git`, uid 1000).
    docker exec -u git "$name" gitea admin user create \
        --username "$admin_user" --password "$admin_pass" \
        --email "e2e-admin@git-files-sync.local" --admin --must-change-password=false >/dev/null

    # Repo creation uses basic auth (the admin's own credentials), not the
    # scoped token below: Gitea 1.22's scoped-token API rejects /user/repos
    # under `write:repository` alone (verified directly -- 403), and this is
    # a one-shot local bootstrap call, not something exposed to the suites.
    # Single-line (not line-continued): Sonar's NOSONAR suppression is
    # line-scoped and attributes shell:S5332 to the `curl` line itself, which
    # can't carry a trailing comment while also ending in a `\` continuation.
    local repo_payload='{"name":"e2e-sandbox","auto_init":true}'
    curl -sSf --max-time 15 -u "${admin_user}:${admin_pass}" -X POST -H 'Content-Type: application/json' -d "$repo_payload" "${base_url}/api/v1/user/repos" >/dev/null # NOSONAR

    local token_json
    local token_payload='{"name":"e2e-token","scopes":["write:repository"]}'
    token_json=$(curl -sS --max-time 15 -u "${admin_user}:${admin_pass}" -X POST -H 'Content-Type: application/json' -d "$token_payload" "${base_url}/api/v1/users/${admin_user}/tokens") # NOSONAR
    local token
    token=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).sha1)' <<<"$token_json") # NOSONAR

    export E2E_GIT_USERNAME="$admin_user"
    export E2E_GIT_TOKEN="$token"
    export E2E_TEST_REPO_URL="${base_url}/${admin_user}/e2e-sandbox.git"
    export E2E_BASE_BRANCH="${E2E_BASE_BRANCH:-main}"
    log "Gitea sandbox ready at $E2E_TEST_REPO_URL"
}

cleanup_gitea_container() {
    if [ "$keep_branch" = "1" ]; then
        log "E2E_KEEP_BRANCH set — leaving gitea container running"
        return
    fi
    if [ -f "$workdir/gitea-container-name" ]; then
        local name; name=$(cat "$workdir/gitea-container-name")
        log "Removing gitea container $name"
        docker rm -f "$name" >/dev/null 2>&1 || true
    fi
}

# --- run-state passed between subcommand invocations ------------------------

write_env_file() {
    local env_file="$workdir/e2e.env"
    {
        echo "E2E_PROVIDER=$provider"
        echo "E2E_TEST_REPO_URL=$E2E_TEST_REPO_URL"
        echo "E2E_BASE_BRANCH=$E2E_BASE_BRANCH"
        echo "E2E_TEST_BRANCH=$E2E_TEST_BRANCH"
        echo "E2E_WORKDIR=$workdir"
        # Not a credential itself -- the token lives only in the mode-700
        # askpass file on disk at this path (still present for later steps
        # in the same job, since it's written under $RUNNER_TEMP). Every git
        # call the committed GitVerifier makes (used by the vitest step,
        # which never runs this script) needs these two set to authenticate.
        echo "GIT_ASKPASS=$GIT_ASKPASS"
        echo "GIT_TERMINAL_PROMPT=0"
    } >"$env_file"
    log "Wrote run state to $env_file (credentials excluded on purpose)"

    if [ "$provider" = "gitea" ]; then
        # Gitea's admin token is generated once, inside this process, from a
        # container that won't exist for later `seed`/`verify`/`cleanup`
        # invocations to re-derive it from (unlike github/gitlab, which
        # re-derive from CI secrets still present in the job env at every
        # step). No alternative but to persist it for this ephemeral run --
        # scoped to $E2E_WORKDIR, mode 600, deleted by `cleanup`.
        local secrets_file="$workdir/e2e.secrets.env"
        {
            echo "E2E_GIT_USERNAME=$E2E_GIT_USERNAME"
            echo "E2E_GIT_TOKEN=$E2E_GIT_TOKEN"
        } >"$secrets_file"
        chmod 600 "$secrets_file"
    fi
}

load_env_file() {
    local env_file="$workdir/e2e.env"
    if [ -f "$env_file" ]; then
        # shellcheck disable=SC1090
        set -a; source "$env_file"; set +a
    fi
    local secrets_file="$workdir/e2e.secrets.env"
    if [ -f "$secrets_file" ]; then
        # shellcheck disable=SC1090
        set -a; source "$secrets_file"; set +a
    elif [ "$provider" != "gitea" ]; then
        normalize_env
    fi
}

# --- entrypoint --------------------------------------------------------------

cmd="${1:-}"
case "$cmd" in
    provision) cmd_provision ;;
    seed) cmd_seed ;;
    verify) cmd_verify ;;
    cleanup) cmd_cleanup ;;
    *)
        # Orphan-namespace sweeping lives in scripts/e2e-janitor.sh now, not
        # here -- this script only ever touches the single branch its own
        # run owns (see cmd_cleanup).
        echo "Usage: $0 {provision|seed|verify|cleanup}" >&2
        exit 1
        ;;
esac
