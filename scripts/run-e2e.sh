#!/usr/bin/env bash
# Thin local-dev orchestration around scripts/e2e-harness.sh: provision the
# isolated branch/container, seed a baseline fixture, run the provider's
# vitest suites, then clean up (even on failure). CI calls this same script
# (see .github/workflows/ci.yml), so the suite list lives in exactly one
# place: scripts/e2e-suites.txt. Add a new shared suite there and both local
# and CI pick it up; this script's own forward/reverse checks below fail the
# run if a suite file isn't registered (or a manifest entry doesn't exist).
set -euo pipefail

provider=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --provider) provider="$2"; shift 2 ;;
        --provider=*) provider="${1#*=}"; shift ;;
        *) shift ;;
    esac
done
if [ -z "$provider" ]; then
    echo "Usage: npm run test:e2e -- --provider <github|gitlab|gitea>" >&2
    exit 1
fi

export E2E_PROVIDER="$provider"
created_workdir=0
if [ -z "${E2E_WORKDIR:-}" ]; then
    E2E_WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/gfs-e2e-${provider}.XXXXXX")
    created_workdir=1
fi
export E2E_WORKDIR

cleanup() {
    scripts/e2e-harness.sh cleanup || true
    if [ "$created_workdir" -eq 1 ] \
        && [[ ! "${E2E_KEEP_BRANCH:-}" =~ ^(1|true)$ ]]; then
        # Only remove the exact mktemp directory this invocation created.
        case "$E2E_WORKDIR" in
            "${TMPDIR:-/tmp}/gfs-e2e-${provider}."*) rm -rf -- "$E2E_WORKDIR" ;;
        esac
    fi
}
trap cleanup EXIT

scripts/e2e-harness.sh provision
# Credentials/run-state provision resolved (E2E_TEST_BRANCH, E2E_RUNTIME_DIR,
# and -- gitea only -- the generated container token) live in $E2E_WORKDIR,
# written by a separate child process; load them into this shell before the
# vitest step needs them.
# shellcheck disable=SC1091
set -a; source "$E2E_WORKDIR/e2e.env"; [ -f "$E2E_WORKDIR/e2e.secrets.env" ] && source "$E2E_WORKDIR/e2e.secrets.env"; set +a

scripts/e2e-harness.sh seed

# Suite manifest: scripts/e2e-suites.txt (single source of truth). ${provider}
# expands to the active provider's contract suite; the rest are shared suites.
# `|| [ -n "$line" ]` keeps the last line even without a trailing newline.
PROVIDERS=(github gitlab gitea)
manifest_has_dynamic=0
SHARED_SUITES=()
while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue;; esac
    if [[ "$line" == *'${provider}'* ]]; then
        manifest_has_dynamic=1
        continue
    fi
    SHARED_SUITES+=("$line")
done < scripts/e2e-suites.txt

if [ "$manifest_has_dynamic" -ne 1 ]; then
    echo "scripts/e2e-suites.txt is missing a \${provider} line -- provider-specific suites (github/gitlab/gitea) would not run." >&2
    exit 1
fi

SUITES=("e2e/suites/${provider}.e2e.test.ts" "${SHARED_SUITES[@]}")

# Forward check: every manifest entry (after ${provider} expansion) must
# exist on disk -- catches a typo'd or deleted suite path in the manifest.
for suite in "${SUITES[@]}"; do
    if [[ ! -f "$suite" ]]; then
        echo "E2E suite not found: $suite" >&2
        exit 1
    fi
done

# Reverse check: every e2e/suites/*.e2e.test.ts file on disk must be either a
# known provider suite (github/gitlab/gitea -- covered by the ${provider}
# line regardless of which provider this run targets) or a shared suite
# explicitly registered in the manifest. Catches a new suite file added
# without wiring it into scripts/e2e-suites.txt, which would otherwise pass
# CI without ever running (the exact "fake green" this guards against).
is_shared_suite() {
    local candidate="$1" s
    for s in "${SHARED_SUITES[@]}"; do
        [[ "$s" == "$candidate" ]] && return 0
    done
    return 1
}
unregistered=()
for file in e2e/suites/*.e2e.test.ts; do
    [ -e "$file" ] || continue
    base="$(basename "$file" .e2e.test.ts)"
    is_known_provider=0
    for p in "${PROVIDERS[@]}"; do
        [ "$base" = "$p" ] && is_known_provider=1 && break
    done
    [ "$is_known_provider" -eq 1 ] && continue
    is_shared_suite "$file" || unregistered+=("$file")
done
if [ "${#unregistered[@]}" -gt 0 ]; then
    echo "Unregistered E2E suite file(s) -- add to scripts/e2e-suites.txt:" >&2
    printf '  %s\n' "${unregistered[@]}" >&2
    exit 1
fi

echo "[run-e2e] running suites: ${SUITES[*]}" >&2

# vitest.e2e.config.ts's `include` matches every e2e/suites/*.e2e.test.ts, so
# the other two providers' suites would also try to run (and fail on missing
# credentials) if not explicitly limited to this list. source-control-flows
# gates its Extended scenarios to GitHub only (and 1000-file stress to
# E2E_STRESS=1) in-file.
npx vitest run -c vitest.e2e.config.ts "${SUITES[@]}"
