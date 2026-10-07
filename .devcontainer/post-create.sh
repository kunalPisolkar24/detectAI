#!/usr/bin/env bash
set -euo pipefail

# Idempotent tooling setup. Safe to re-run.
# Pinned to match CI (.github/workflows): node 20, pnpm 10, go 1.25,
# python 3.11, bun latest, terraform 1.9.8, poetry via pipx.

if command -v corepack >/dev/null 2>&1; then
  corepack enable || true
  corepack prepare pnpm@10 --activate || npm install -g pnpm@10
else
  npm install -g pnpm@10
fi

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command -v poetry >/dev/null 2>&1; then
  pipx install poetry
  pipx ensurepath || true
fi

# System dep for document-parser (python-magic), mirrors its Dockerfile.
if ! ldconfig -p 2>/dev/null | grep -q libmagic; then
  sudo apt-get update && sudo apt-get install -y --no-install-recommends libmagic1
fi

echo "--- dev container tooling ---"
node --version || true
pnpm --version || true
go version || true
python3 --version || true
poetry --version || true
bun --version || true
terraform version | head -n 1 || true
aws --version || true
docker --version || true
gh --version | head -n 1 || true
make --version | head -n 1 || true
echo "-----------------------------"
echo "Next: make help | cp infra/docker/local/.env.example infra/docker/local/.env | make local-up"
