#!/usr/bin/env bash
set -euo pipefail

check="${1:-}"
case "$check" in
  lint)
    npm run lint
    ;;
  test)
    npm test
    ;;
  build)
    npm run build
    ;;
  *)
    echo "Usage: scripts/run-preflight.sh <lint|test|build>" >&2
    exit 2
    ;;
esac
