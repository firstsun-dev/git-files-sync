#!/bin/bash
set -e

echo "=== Harness Initialization ==="

echo "=== pnpm install ==="
pnpm install --frozen-lockfile

echo "=== pnpm run lint ==="
pnpm run lint

echo "=== pnpm test ==="
pnpm test

echo "=== pnpm run build ==="
pnpm run build

echo "=== Verification Complete ==="
