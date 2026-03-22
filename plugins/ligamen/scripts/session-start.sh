#!/usr/bin/env bash
# Ligamen — session-start.sh
# Fires on SessionStart and UserPromptSubmit (UserPromptSubmit fallback for upstream bug #10373).
# Injects project type and available ligamen commands into session context exactly once.
# Non-blocking: always exits 0.
set -euo pipefail

# Non-blocking trap: any unexpected error exits 0 silently
trap 'exit 0' ERR

# SSTH-04: Disable guard — if set to any non-empty value, exit silently
[[ -n "${LIGAMEN_DISABLE_SESSION_START:-}" ]] && exit 0

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

# SSTH-05: Deduplication — only inject context once per session
if [[ -n "$SESSION_ID" ]]; then
  FLAG_FILE="/tmp/ligamen_session_${SESSION_ID}.initialized"
  if [[ -f "$FLAG_FILE" ]]; then
    exit 0  # already ran for this session
  fi
  touch "$FLAG_FILE"
fi

# INTG-01: Worker auto-start — source worker-client.sh if available
WORKER_CLIENT_LIB=""
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && [[ -f "${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh" ]]; then
  WORKER_CLIENT_LIB="${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh"
else
  SCRIPT_DIR="$(dirname "$0")"
  WORKER_CLIENT="${SCRIPT_DIR}/../lib/worker-client.sh"
  [[ -f "$WORKER_CLIENT" ]] && WORKER_CLIENT_LIB="$WORKER_CLIENT"
fi

WORKER_STATUS=""
if [[ -n "$WORKER_CLIENT_LIB" ]]; then
  # shellcheck source=lib/worker-client.sh
  source "$WORKER_CLIENT_LIB"
  CONFIG_FILE="${CWD}/ligamen.config.json"
  if [[ -f "$CONFIG_FILE" ]] && jq -e '.["impact-map"]' "$CONFIG_FILE" >/dev/null 2>&1; then
    if ! worker_running 2>/dev/null; then
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
CONTEXT="Ligamen active."
if [[ -n "$PROJECT_TYPES" ]]; then
  CONTEXT="Ligamen active. Detected: ${PROJECT_TYPES}."
fi
CONTEXT="${CONTEXT} Commands: /ligamen:cross-impact, /ligamen:drift."
[[ -n "$WORKER_STATUS" ]] && CONTEXT="${CONTEXT} ${WORKER_STATUS}"

# SSTH-01: Output hookSpecificOutput.additionalContext JSON to stdout
# Use jq -Rs . for safe escaping of the context string (handles quotes, backslashes, newlines)
CONTEXT_JSON=$(printf '%s' "$CONTEXT" | jq -Rs .)
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":%s}}\n' \
  "$EVENT" \
  "$CONTEXT_JSON"

exit 0
