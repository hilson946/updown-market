#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== forge test =="
pnpm test:contracts

echo "== forge coverage =="
pnpm coverage

if command -v slither >/dev/null 2>&1; then
  echo "== slither =="
  pnpm audit:slither
else
  echo "slither not found; skipping"
fi

if command -v halmos >/dev/null 2>&1; then
  echo "== halmos =="
  (cd packages/contracts && forge clean)
  halmos --root packages/contracts --contract HalmosPayoutProperties --function check_ --solver-timeout-assertion 30000
else
  echo "halmos not found; skipping"
fi
