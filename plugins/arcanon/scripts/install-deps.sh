#!/usr/bin/env bash
# Arcanon — install-deps.sh
# SessionStart hook: ensures MCP runtime dependencies are installed and the
# better-sqlite3 native binding actually loads. Single source of truth for
# runtime deps is plugins/arcanon/package.json.
#
# Sentinel: sha256(jq -c -S '.dependencies + .optionalDependencies' package.json)
# Stored at ${CLAUDE_PLUGIN_DATA}/.arcanon-deps-sentinel (single hex line).
#
# Non-blocking: every path exits 0. Genuine failures log to stderr; runtime
# self-surfaces via the worker / MCP server when the user invokes a feature.
set -euo pipefail
trap 'exit 0' ERR

# ---------------------------------------------------------------------------
# Plugin root resolution (env var preferred; script-relative fallback)
# ---------------------------------------------------------------------------
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
else
  PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

# ---------------------------------------------------------------------------
# Tooling guards (each missing tool → silent exit 0; not our problem here)
# ---------------------------------------------------------------------------
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" ]]; then
  exit 0  # Dev mode: not running under Claude Code plugin lifecycle
fi
command -v jq   >/dev/null 2>&1 || exit 0
command -v npm  >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

# Platform-portable sha256 (matches lib/db-path.sh + session-start.sh pattern)
if command -v shasum >/dev/null 2>&1; then
  HASHER=(shasum -a 256)
elif command -v sha256sum >/dev/null 2>&1; then
  HASHER=(sha256sum)
else
  exit 0  # No hasher available
fi

# Optional timeout binary (macOS may have it as gtimeout via Homebrew coreutils)
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN=(timeout 5)
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN=(gtimeout 5)
else
  TIMEOUT_BIN=()  # No timeout — node will run to completion or fail naturally
fi

# ---------------------------------------------------------------------------
# Required input: package.json (single source of truth post-Phase 107)
# ---------------------------------------------------------------------------
PACKAGE_JSON="${PLUGIN_ROOT}/package.json"
if [[ ! -f "${PACKAGE_JSON}" ]]; then
  echo "[arcanon] package.json not found at ${PACKAGE_JSON}" >&2
  exit 0
fi

# Sentinel path — pre-create parent dir so write never silently fails
SENTINEL="${CLAUDE_PLUGIN_DATA}/.arcanon-deps-sentinel"
mkdir -p "$(dirname "${SENTINEL}")"

# ---------------------------------------------------------------------------
# compute_hash: canonical sha256 of runtime + optional dep set
# Output: 64-char hex string on stdout, or empty string on failure
# ---------------------------------------------------------------------------
compute_hash() {
  jq -c -S '.dependencies + .optionalDependencies' "${PACKAGE_JSON}" 2>/dev/null \
    | "${HASHER[@]}" \
    | awk '{print $1}'
}

# ---------------------------------------------------------------------------
# validate_binding: load better-sqlite3 and instantiate :memory: connection
# Returns: 0 if binding loads cleanly; non-zero otherwise
# ---------------------------------------------------------------------------
validate_binding() {
  ( cd "${PLUGIN_ROOT}" && "${TIMEOUT_BIN[@]}" node -e \
      "const D=require('better-sqlite3'); new D(':memory:').close()" ) \
    >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# write_sentinel: persist current hash so the next run can early-exit
# ---------------------------------------------------------------------------
write_sentinel() {
  printf '%s\n' "$1" > "${SENTINEL}"
}

# ---------------------------------------------------------------------------
# Main control flow
# ---------------------------------------------------------------------------
CURRENT_HASH="$(compute_hash)"
if [[ -z "${CURRENT_HASH}" ]]; then
  echo "[arcanon] failed to compute deps hash from package.json" >&2
  exit 0
fi

SENTINEL_HASH=""
if [[ -f "${SENTINEL}" ]]; then
  SENTINEL_HASH="$(cat "${SENTINEL}" 2>/dev/null | tr -d '[:space:]')"
fi

# --- Happy path (INST-04): hash match + binding loads ---------------------
if [[ "${CURRENT_HASH}" == "${SENTINEL_HASH}" ]] && validate_binding; then
  exit 0
fi

# --- Hash matches but binding broken: skip install, go to rebuild --------
SKIP_INSTALL=0
if [[ "${CURRENT_HASH}" == "${SENTINEL_HASH}" ]]; then
  SKIP_INSTALL=1
fi

# --- Install path (hash mismatch OR sentinel absent) ----------------------
if [[ "${SKIP_INSTALL}" -eq 0 ]]; then
  # All npm output → stderr (head -50 caps log noise on the hook surface)
  if ! npm install --prefix "${PLUGIN_ROOT}" \
       --omit=dev --no-fund --no-audit --package-lock=false \
       2>&1 | head -50 >&2; then
    echo "[arcanon] npm install failed — runtime will surface details on first feature use" >&2
    # Per D-05: do NOT rm -rf node_modules; do NOT delete the sentinel
    exit 0
  fi

  # Install reported success — validate the binding actually loads
  if validate_binding; then
    write_sentinel "${CURRENT_HASH}"
    exit 0
  fi

  # Install ok but binding fails: drop into the rebuild path below
fi

# --- Rebuild fallback (INST-03): one chance to fix a broken binding -----
echo "[arcanon] better-sqlite3 binding failed to load — running npm rebuild" >&2
if ! npm rebuild better-sqlite3 --prefix "${PLUGIN_ROOT}" \
     2>&1 | head -50 >&2; then
  echo "[arcanon] npm rebuild better-sqlite3 failed — runtime will surface details on first feature use" >&2
  exit 0
fi

if validate_binding; then
  write_sentinel "${CURRENT_HASH}"
  exit 0
fi

echo "[arcanon] better-sqlite3 binding still broken after rebuild — runtime will surface details on first feature use" >&2
exit 0
