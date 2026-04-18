#!/usr/bin/env bash
# scripts/hub.sh — Thin wrapper around worker/cli/hub.js.
# Invoked by the /arcanon:* slash commands so they don't each need to repeat
# the Node binary + path resolution.
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
HUB_CLI="${PLUGIN_ROOT}/worker/cli/hub.js"

if ! command -v node >/dev/null 2>&1; then
  echo "arcanon: Node.js is required (>= 20). Install Node and re-run." >&2
  exit 127
fi

exec node "$HUB_CLI" "$@"
