#!/usr/bin/env bash
# Real-provider E2E harness: Arrange/Assert live here as Shell + Git CLI,
# Act stays production TypeScript (SyncManager / GitHubService / GitLabService
# / GiteaService, run via `npx vitest run -c vitest.e2e.config.ts`). See
# docs/testing/real-provider-e2e.md.
#
# Subcommands:
#   provision         create/resolve the isolated test branch (or, for gitea,
#                      the whole disposable container+repo) and generate the
#                      Node-only vitest runtime adapters under $E2E_RUNTIME_DIR
#   seed               write deterministic baseline fixtures to the branch
#   verify             independent post-run sanity check (branch exists, has
#                      the expected number of commits) — the fine-grained,
#                      per-scenario assertions live in the generated verifier
#                      modules the suites import directly, not here
#   cleanup            delete the isolated branch / tear down the container
#   sweep              best-effort delete of stale run branches (github/gitlab)
#
# Config comes from environment variables (see docs/testing/real-provider-e2e.md
# for the full table); provider-specific vars already supplied by CI
# (E2E_GITHUB_*, E2E_GITLAB_*) are normalized into the generic surface below.
set -euo pipefail

provider="${E2E_PROVIDER:-}"
if [ -z "$provider" ]; then
    echo "E2E_PROVIDER is not set (github|gitlab|gitea)." >&2
    exit 1
fi

# Must be stable across the separate provision/seed/vitest/cleanup process
# invocations within one run -- CI sets this explicitly under $RUNNER_TEMP;
# local dev falls back to a provider-namespaced (not random) tmp dir so
# sequential `npm run test:e2e` steps in the same shell session share it too.
workdir="${E2E_WORKDIR:-${TMPDIR:-/tmp}/gfs-e2e-${provider}}"
runtime_dir="${E2E_RUNTIME_DIR:-$workdir/runtime}"
mkdir -p "$workdir" "$runtime_dir"

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
                project_json=$(curl -sS -H "PRIVATE-TOKEN: ${E2E_GITLAB_TOKEN}" \
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

namespace() {
    local suffix="${GITHUB_RUN_ID:-}${GITHUB_RUN_ATTEMPT:+-$GITHUB_RUN_ATTEMPT}"
    if [ -z "$suffix" ]; then suffix="$(date +%s)-$$"; fi
    echo "gfs-e2e-${provider}-${suffix}"
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

    generate_runtime
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
    load_env_file
    setup_askpass
    if [ "$provider" = "gitea" ]; then
        cleanup_gitea_container
        rm -f "$workdir/e2e.secrets.env"
        return
    fi
    if [ "$keep_branch" = "1" ]; then
        log "E2E_KEEP_BRANCH set — leaving $E2E_TEST_BRANCH in place"
        return
    fi
    local dir; dir=$(clone_dir)
    log "Deleting isolated branch $E2E_TEST_BRANCH"
    git -C "$dir" push origin ":refs/heads/${E2E_TEST_BRANCH}" || true
}

cmd_sweep() {
    normalize_env
    setup_askpass
    ensure_clone
    local dir; dir=$(clone_dir)
    local cutoff_epoch=$(($(date +%s) - 86400))
    git -C "$dir" for-each-ref "refs/remotes/origin/gfs-e2e-${provider}-*" \
        --format='%(refname:short) %(committerdate:unix)' |
        while read -r ref ts; do
            if [ "${ts:-0}" -lt "$cutoff_epoch" ]; then
                local branch="${ref#origin/}"
                log "Sweeping stale branch $branch"
                git -C "$dir" push origin ":refs/heads/${branch}" || true
            fi
        done
}

# --- generated vitest runtime (never committed) -----------------------------

# Everything under here is Node-only glue (fetch/globalThis/node:child_process)
# equivalent to what used to live in e2e/shim + e2e/verifier as committed
# .ts files -- generated fresh per run instead, so the checked-in suites stay
# free of the APIs the Obsidian scanner flags. See section 6/7 of the task
# and docs/testing/real-provider-e2e.md.
generate_runtime() {
    mkdir -p "$runtime_dir/verifier"

    cat >"$runtime_dir/obsidian-request-url.ts" <<'EOF'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';

export async function requestUrl(request: RequestUrlParam | string): Promise<RequestUrlResponse> {
    const params: RequestUrlParam = typeof request === 'string' ? { url: request } : request;
    const shouldThrow = params.throw ?? true;
    const headers: Record<string, string> = { ...params.headers };
    if (params.contentType && !headers['Content-Type']) headers['Content-Type'] = params.contentType;
    const res = await fetch(params.url, { method: params.method ?? 'GET', headers, body: params.body });
    const arrayBuffer = await res.arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    let json: unknown;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    const response: RequestUrlResponse = { status: res.status, headers: Object.fromEntries(res.headers.entries()), arrayBuffer, text, json };
    if (shouldThrow && res.status >= 400) {
        const error = new Error(`Request failed, status ${res.status}`);
        (error as Error & { status: number }).status = res.status;
        throw error;
    }
    return response;
}

export class Modal {
    app: unknown;
    constructor(app?: unknown) { this.app = app; }
    open(): void {}
    close(): void {}
}
export class PluginSettingTab { constructor(_app?: unknown, _plugin?: unknown) {} }
export class TextComponent {}
export class AbstractInputSuggest<_T> { constructor(_app: unknown, _inputEl: unknown) {} }
export class TFolder { path: string; constructor(path: string) { this.path = path; } }
export class Setting { constructor(_containerEl?: unknown) {} }
export class TFile {
    path: string;
    name: string;
    constructor(path: string) { this.path = path; this.name = path.split('/').pop() ?? path; }
}
export class Notice {
    constructor(_message?: string, _timeout?: number) {}
    setMessage(): this { return this; }
    hide(): void {}
}
export const Platform = { isDesktopApp: false, isMobile: false };
export class FileSystemAdapter { getBasePath(): string { return '/e2e/fake-vault'; } }
EOF

    cat >"$runtime_dir/window-timers.ts" <<'EOF'
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}
EOF

    local repo_dir; repo_dir=$(clone_dir)
    cat >"$runtime_dir/verifier/git-verifier.ts" <<EOF
import { execFileSync } from 'node:child_process';

/**
 * Independent verifier backed by plain git CLI against the isolated clone
 * this harness already checked out -- never the service under test reading
 * back its own writes. Generated per-run by scripts/e2e-harness.sh, not
 * committed (see docs/testing/real-provider-e2e.md).
 */
export class GitVerifier {
    constructor(private readonly repoDir: string = ${repo_dir@Q}) {}

    private git(args: string[]): string {
        return execFileSync('git', ['-C', this.repoDir, ...args], { encoding: 'utf-8' });
    }

    private fetch(ref: string): void {
        this.git(['fetch', 'origin', ref]);
    }

    async getFile(path: string, ref: string): Promise<{ content: string; sha: string } | null> {
        this.fetch(ref);
        try {
            const sha = this.git(['rev-parse', \`origin/\${ref}:\${path}\`]).trim();
            const content = this.git(['show', \`origin/\${ref}:\${path}\`]);
            return { content, sha };
        } catch {
            return null;
        }
    }

    async listFiles(ref: string): Promise<string[]> {
        this.fetch(ref);
        return this.git(['ls-tree', '-r', '--name-only', \`origin/\${ref}\`])
            .split('\\n')
            .filter(Boolean);
    }

    async fileMissing(path: string, ref: string): Promise<boolean> {
        return (await this.getFile(path, ref)) === null;
    }

    async listCommitShas(ref: string, perPage = 30): Promise<string[]> {
        this.fetch(ref);
        return this.git(['log', '--format=%H', '-n', String(perPage), \`origin/\${ref}\`])
            .split('\\n')
            .filter(Boolean);
    }

    /** Git tree mode at path (e.g. "120000" for a symlink). */
    async getBlobMode(path: string, ref: string): Promise<string | null> {
        this.fetch(ref);
        const line = this.git(['ls-tree', \`origin/\${ref}\`, '--', path]).trim();
        if (!line) return null;
        return line.split(/\\s+/)[0] ?? null;
    }

    async getCommitMessage(sha: string): Promise<string> {
        return this.git(['log', '-1', '--format=%B', sha]).trim();
    }

    /** Last commit sha that touched path -- GitLab's optimistic-locking "revision". */
    async getRevision(path: string, ref: string): Promise<string | null> {
        this.fetch(ref);
        const sha = this.git(['log', '-1', '--format=%H', \`origin/\${ref}\`, '--', path]).trim();
        return sha || null;
    }
}
EOF
    log "Generated vitest runtime adapters under $runtime_dir"
}

# --- gitea container lifecycle (shell/docker, never node:child_process) -----

provision_gitea_container() {
    local image="${E2E_GITEA_IMAGE:-gitea/gitea:1.22}"
    local name="gfs-e2e-gitea-$$"
    log "Starting gitea container ($image)"
    docker run -d --name "$name" -p 0:3000 \
        -e GITEA__security__INSTALL_LOCK=true \
        "$image" >/dev/null
    echo "$name" >"$workdir/gitea-container-name"

    local host_port
    host_port=$(docker port "$name" 3000/tcp | head -1 | cut -d: -f2)
    local base_url="http://127.0.0.1:${host_port}"

    local ready_ms="${E2E_CONTAINER_READY_MS:-60000}"
    local poll_ms="${E2E_POLL_INTERVAL_MS:-500}"
    local waited=0
    until curl -sSf "${base_url}/api/healthz" >/dev/null 2>&1; do
        sleep "$(node -e "console.log(${poll_ms}/1000)")"
        waited=$((waited + poll_ms))
        if [ "$waited" -ge "$ready_ms" ]; then
            echo "gitea container did not become healthy within ${ready_ms}ms" >&2
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
    curl -sSf -u "${admin_user}:${admin_pass}" -X POST -H 'Content-Type: application/json' \
        -d '{"name":"e2e-sandbox","auto_init":true}' \
        "${base_url}/api/v1/user/repos" >/dev/null

    local token_json
    token_json=$(curl -sS -u "${admin_user}:${admin_pass}" -X POST \
        -H 'Content-Type: application/json' \
        -d '{"name":"e2e-token","scopes":["write:repository"]}' \
        "${base_url}/api/v1/users/${admin_user}/tokens")
    local token
    token=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).sha1)' <<<"$token_json")

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
        echo "E2E_RUNTIME_DIR=$runtime_dir"
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
    sweep) cmd_sweep ;;
    *)
        echo "Usage: $0 {provision|seed|verify|cleanup|sweep}" >&2
        exit 1
        ;;
esac
