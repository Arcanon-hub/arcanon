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

# --disable-warning=ExperimentalWarning: node:sqlite is experimental until Node
# 25.7 and prints a warning to stderr on load; without this it corrupts CLI
# --json output (callers merge stderr) and the worker JSON log. Available since
# Node 21.3 (floor is 22.13). Mirrors the flag in .mcp.json and worker-start.sh.
exec node --disable-warning=ExperimentalWarning "$HUB_CLI" "$@"
