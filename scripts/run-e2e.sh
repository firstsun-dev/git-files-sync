#!/usr/bin/env bash
# Thin local-dev orchestration around scripts/e2e-harness.sh: provision the
# isolated branch/container, seed a baseline fixture, run the provider's
# vitest suites, then clean up (even on failure). CI calls this same script
# (see .github/workflows/ci.yml), so the suite list lives in exactly one
# place: scripts/e2e-suites.txt. Add a new shared suite there and both local
# and CI pick it up; scripts/check-e2e-suite-registration.mjs fails CI if a
# suite file isn't registered.
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
export E2E_WORKDIR="${E2E_WORKDIR:-${TMPDIR:-/tmp}/gfs-e2e-${provider}}"

cleanup() {
    scripts/e2e-harness.sh cleanup || true
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
SUITES=()
while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue;; esac
    SUITES+=("$(printf '%s' "$line" | sed "s/\${provider}/$provider/g")")
done < scripts/e2e-suites.txt

# vitest.e2e.config.ts's `include` matches every e2e/suites/*.e2e.test.ts, so
# the other two providers' suites would also try to run (and fail on missing
# credentials) if not explicitly limited to this list. source-control-flows
# gates its Extended scenarios to GitHub only (and 1000-file stress to
# E2E_STRESS=1) in-file.
npx vitest run -c vitest.e2e.config.ts "${SUITES[@]}"
