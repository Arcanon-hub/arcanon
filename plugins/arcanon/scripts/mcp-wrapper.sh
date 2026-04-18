#!/usr/bin/env bash
# Arcanon — mcp-wrapper.sh
# Self-healing MCP server launcher.
# Checks for runtime deps before exec'ing server.js.
# If deps are missing (first-session race), installs them inline.
# All output to stderr — stdout must stay clean for MCP JSON-RPC.

_R="${CLAUDE_PLUGIN_ROOT:-}"
[ -z "$_R" ] && _R="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Self-healing: if better-sqlite3 is missing, install deps before launching
if [ ! -d "${_R}/node_modules/better-sqlite3" ]; then
  echo "[arcanon] installing runtime deps (first run)..." >&2
  if command -v npm >/dev/null 2>&1; then
    npm install --prefix "${_R}" \
      --omit=dev --no-fund --no-audit --package-lock=false \
      >"${_R}/.npm-install.log" 2>&1
    INSTALL_EXIT=$?
    head -50 "${_R}/.npm-install.log" >&2
    rm -f "${_R}/.npm-install.log"
    if [ $INSTALL_EXIT -ne 0 ]; then
      echo "[arcanon] dep install failed — MCP server may not start" >&2
      rm -rf "${_R}/node_modules"
    fi
  else
    echo "[arcanon] npm not found — cannot install deps" >&2
  fi
fi

exec node "${_R}/worker/mcp/server.js"
