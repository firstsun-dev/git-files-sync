#!/usr/bin/env bash
set -euo pipefail

check="${1:-}"
case "$check" in
  lint)
    pnpm run lint
    ;;
  test)
    pnpm test
    ;;
  build)
    pnpm run build
    ;;
  *)
    echo "Usage: scripts/run-preflight.sh <lint|test|build>" >&2
    exit 2
    ;;
esac
