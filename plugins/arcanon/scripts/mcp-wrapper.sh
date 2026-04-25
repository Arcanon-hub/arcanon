#!/usr/bin/env bash
# Arcanon — mcp-wrapper.sh
# Resolves CLAUDE_PLUGIN_ROOT and execs the MCP server.
# All install / self-heal logic lives in scripts/install-deps.sh (SessionStart hook).
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [[ -z "${PLUGIN_ROOT}" ]]; then
  PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

exec node "${PLUGIN_ROOT}/worker/mcp/server.js"
