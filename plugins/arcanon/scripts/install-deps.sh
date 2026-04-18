#!/usr/bin/env bash
# Ligamen — install-deps.sh
# SessionStart hook: installs MCP runtime dependencies into CLAUDE_PLUGIN_ROOT.
# Diff-based idempotency: skips if runtime-deps.json matches sentinel in CLAUDE_PLUGIN_DATA.
# Non-blocking: always exits 0.
set -euo pipefail

# Non-blocking trap: any unexpected error exits 0 silently
trap 'exit 0' ERR

# Resolve CLAUDE_PLUGIN_ROOT: use env var if set, otherwise fall back to script-relative path
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  _R="${CLAUDE_PLUGIN_ROOT}"
else
  _R="$(cd "$(dirname "$0")/.." && pwd)"
fi

# Guard: CLAUDE_PLUGIN_DATA must be set (not running in plugin context — dev mode)
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" ]]; then
  exit 0
fi

# Guard: jq must be available
command -v jq >/dev/null 2>&1 || exit 0

# Guard: npm must be available
command -v npm >/dev/null 2>&1 || exit 0

# Sentinel comparison (diff-based idempotency)
SENTINEL="${CLAUDE_PLUGIN_DATA}/.arcanon-deps-installed.json"
MANIFEST="${_R}/runtime-deps.json"

# Guard: runtime-deps.json must exist
if [[ ! -f "$MANIFEST" ]]; then
  exit 0
fi

# Skip if sentinel matches manifest AND better-sqlite3 dir exists (double check)
if diff -q "$MANIFEST" "$SENTINEL" >/dev/null 2>&1 && [ -d "${_R}/node_modules/better-sqlite3" ]; then
  exit 0
fi

# Install deps using package.json in CLAUDE_PLUGIN_ROOT (--omit=dev skips devDependencies)
# All npm output goes to stderr — stdout must stay clean for hook JSON output
if npm install --prefix "${_R}" \
  --omit=dev --no-fund --no-audit --package-lock=false \
  2>&1 | head -50 >&2; then
  # Install succeeded: write sentinel
  cp "$MANIFEST" "$SENTINEL"
else
  # Install failed: clean up partial node_modules and remove sentinel so next session retries
  rm -rf "${_R}/node_modules"
  rm -f "$SENTINEL"
  exit 0
fi

exit 0
