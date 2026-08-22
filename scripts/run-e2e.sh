#!/usr/bin/env bash
# Thin local-dev orchestration around scripts/e2e-harness.sh: provision the
# isolated branch/container, seed a baseline fixture, run the provider's
# vitest suite + the SyncManager suite, then clean up (even on failure). CI
# drives the same four steps directly from .github/workflows/ci.yml instead,
# so each shows up as its own job step.
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
# Only this provider's contract suite + the shared SyncManager/source-control
# workflow suites -- vitest.e2e.config.ts's `include` matches every
# e2e/suites/*.e2e.test.ts file, and the other two providers' suites would
# otherwise also try to run (and fail on missing credentials) regardless of
# --provider. source-control-flows gates its Extended scenarios to GitHub only
# (and 1000-file stress to E2E_STRESS=1) in-file.
npx vitest run -c vitest.e2e.config.ts \
    "e2e/suites/${provider}.e2e.test.ts" \
    e2e/suites/sync-manager.e2e.test.ts \
    e2e/suites/source-control-flows.e2e.test.ts
