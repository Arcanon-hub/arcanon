#!/usr/bin/env bash
# Arcanon — session-start.sh
# Fires on SessionStart and UserPromptSubmit (UserPromptSubmit fallback for upstream bug #10373).
# Injects project type and available ligamen commands into session context exactly once.
# Non-blocking: always exits 0.
set -euo pipefail

# Non-blocking trap: any unexpected error exits 0 silently
trap 'exit 0' ERR

# SSTH-04: Disable guard — if set to any non-empty value, exit silently
# Accept both current and legacy env var names.
[[ -n "${ARCANON_DISABLE_SESSION_START:-}${LIGAMEN_DISABLE_SESSION_START:-}" ]] && exit 0

# SSTH-03: Require jq for JSON parsing; if unavailable, exit 0 silently (never block)
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# Read full stdin JSON
INPUT=$(cat)

# Extract fields from stdin JSON
SESSION_ID=$(printf '%s\n' "$INPUT" | jq -r '.session_id // empty')
CWD=$(printf '%s\n' "$INPUT" | jq -r '.cwd // empty')
EVENT=$(printf '%s\n' "$INPUT" | jq -r '.hook_event_name // empty')

# CWD fallback to $PWD if empty
[[ -z "$CWD" ]] && CWD="$PWD"

# INTG-02: Version mismatch check — runs BEFORE dedup guard (SSTH-05).
# Must fire on every UserPromptSubmit so mid-session plugin updates are detected.
# The check is cheap (one jq + one curl with 1s timeout) and idempotent.
WORKER_CLIENT_LIB=""
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && [[ -f "${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh" ]]; then
  WORKER_CLIENT_LIB="${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh"
else
  SCRIPT_DIR="$(dirname "$0")"
  WORKER_CLIENT="${SCRIPT_DIR}/../lib/worker-client.sh"
  [[ -f "$WORKER_CLIENT" ]] && WORKER_CLIENT_LIB="$WORKER_CLIENT"
fi

_worker_restarted=false
if [[ -n "$WORKER_CLIENT_LIB" ]]; then
  # shellcheck source=lib/worker-client.sh
  source "$WORKER_CLIENT_LIB"
  # worker-client.sh sources data-dir.sh, so resolve_arcanon_data_dir is in scope.
  if worker_running 2>/dev/null; then
    _installed_version=""
    _running_version=""
    if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && [[ -f "${CLAUDE_PLUGIN_ROOT}/package.json" ]]; then
      _installed_version=$(jq -r '.version // empty' "${CLAUDE_PLUGIN_ROOT}/package.json" 2>/dev/null || true)
    fi
    _data_dir="$(resolve_arcanon_data_dir)"
    _port_file="${_data_dir}/worker.port"
    if [[ -f "$_port_file" ]]; then
      _port=$(cat "$_port_file")
      _running_version=$(curl -s --max-time 1 "http://127.0.0.1:${_port}/api/version" 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)
    fi
    if [[ -n "$_installed_version" && -n "$_running_version" \
        && "$_running_version" != "unknown" \
        && "$_installed_version" != "$_running_version" ]]; then
      bash "${CLAUDE_PLUGIN_ROOT}/scripts/worker-stop.sh" >/dev/null 2>&1 || true
      worker_start_background 2>/dev/null || true
      _worker_restarted=true
    fi
  fi
fi

# SSTH-05: Deduplication — only inject context once per session
# (version check above is exempt — it must run on every prompt to catch mid-session updates)
if [[ -n "$SESSION_ID" ]]; then
  FLAG_FILE="/tmp/arcanon_session_${SESSION_ID}.initialized"
  if [[ -f "$FLAG_FILE" ]]; then
    exit 0  # already ran for this session
  fi
  touch "$FLAG_FILE"
fi

# INTG-01: Worker auto-start (first session only — dedup guard ensures this)
WORKER_STATUS=""
if [[ -n "$WORKER_CLIENT_LIB" ]]; then
  CONFIG_FILE="${CWD}/arcanon.config.json"
  [[ -f "$CONFIG_FILE" ]] || CONFIG_FILE="${CWD}/ligamen.config.json"
  if [[ -f "$CONFIG_FILE" ]] && jq -e '.["impact-map"]' "$CONFIG_FILE" >/dev/null 2>&1; then
    if [[ "$_worker_restarted" == "true" ]]; then
      WORKER_STATUS="Arcanon worker: restarted (${_running_version} → ${_installed_version})"
    elif ! worker_running 2>/dev/null; then
      worker_start_background 2>/dev/null || true
    else
      WORKER_STATUS=$(worker_status_line 2>/dev/null || echo "")
    fi
  fi
fi

# SSTH-02: Project detection — source shared library
# Use CLAUDE_PLUGIN_ROOT if set, otherwise fall back to script-relative path
DETECT_LIB=""
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && [[ -f "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh" ]]; then
  DETECT_LIB="${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"
else
  SCRIPT_DIR="$(dirname "$0")"
  RELATIVE_LIB="${SCRIPT_DIR}/../lib/detect.sh"
  if [[ -f "$RELATIVE_LIB" ]]; then
    DETECT_LIB="$RELATIVE_LIB"
  fi
fi

PROJECT_TYPES=""
if [[ -n "$DETECT_LIB" ]]; then
  # shellcheck source=lib/detect.sh
  source "$DETECT_LIB"
  if declare -f detect_project_type >/dev/null 2>&1; then
    PROJECT_TYPES=$(detect_project_type "$CWD")
    # Normalize: if detect_project_type returns "unknown" treat as empty
    [[ "$PROJECT_TYPES" == "unknown" ]] && PROJECT_TYPES=""
  fi
fi

# SSTH-02: Build context message
CONTEXT="Arcanon active."
if [[ -n "$PROJECT_TYPES" ]]; then
  CONTEXT="Arcanon active. Detected: ${PROJECT_TYPES}."
fi
CONTEXT="${CONTEXT} Commands: /arcanon:map, /arcanon:drift, /arcanon:impact, /arcanon:cross-impact, /arcanon:login, /arcanon:upload, /arcanon:status, /arcanon:sync, /arcanon:export."
[[ -n "$WORKER_STATUS" ]] && CONTEXT="${CONTEXT} ${WORKER_STATUS}"

# SSTH-01: Output hookSpecificOutput.additionalContext JSON to stdout
# Use jq -Rs . for safe escaping of the context string (handles quotes, backslashes, newlines)
CONTEXT_JSON=$(printf '%s' "$CONTEXT" | jq -Rs .)
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":%s}}\n' \
  "$EVENT" \
  "$CONTEXT_JSON"

exit 0
