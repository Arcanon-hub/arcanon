#!/usr/bin/env bash
# scripts/file-guard.sh
# PreToolUse hook — classifies files and blocks or warns
#
# Exit codes:
#   0 = allow (with optional stdout systemMessage JSON for soft warns)
#   2 = hard block (deny tool call); block message goes to stderr
#
# Environment:
#   ARCANON_DISABLE_GUARD=1   -- bypass guard entirely (CONF-02).
#   ARCANON_EXTRA_BLOCKED     -- colon-separated glob patterns to add to hard-block list (CONF-04).
#
# NOTE: No `set -e` -- realpath can fail on files that don't exist yet;
#       all exit codes must be explicit.

# --- Disable guard entirely (CONF-02) ---
if [[ "${ARCANON_DISABLE_GUARD:-0}" == "1" ]]; then
  exit 0
fi

# --- Read stdin exactly once ---
INPUT=$(cat)
RAW_FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)

# Not a file operation (e.g., Bash tool) -- allow
if [[ -z "$RAW_FILE" ]]; then
  exit 0
fi

# --- Path normalization (works on files that don't exist yet) ---
# `realpath -m` = GNU coreutils (Linux); macOS ships BSD realpath without -m.
# Fall back to manual expansion for macOS compatibility.
if command -v realpath &>/dev/null && realpath -m / &>/dev/null 2>&1; then
  FILE=$(realpath -m "$RAW_FILE" 2>/dev/null || printf '%s' "$RAW_FILE")
else
  # macOS fallback: resolve directory component, keep basename
  _dir=$(dirname "$RAW_FILE")
  _base=$(basename "$RAW_FILE")
  _resolved_dir=$(cd "$_dir" 2>/dev/null && pwd || printf '%s' "$_dir")
  FILE="${_resolved_dir}/${_base}"
fi
BASENAME=$(basename "$FILE")

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

block_file() {
  local file="$1" reason="$2"
  local basename
  basename=$(basename "$file")
  # Human-readable message on stderr
  printf 'Arcanon: blocked write to %s -- %s\n' "$basename" "$reason" >&2
  # hookSpecificOutput JSON on stdout — required for Claude Code PreToolUse deny schema
  # Source: validate-write.sh + hookify rule_engine.py (TEST-08 contract)
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Arcanon: blocked write to %s -- %s"}}\n' \
    "$basename" "$reason"
  exit 2
}

warn_file() {
  local file="$1" message="$2"
  printf '{"systemMessage": "Arcanon: %s -- %s"}\n' "$(basename "$file")" "$message"
  exit 0
}

# ---------------------------------------------------------------------------
# ARCANON_EXTRA_BLOCKED — user-defined
# colon-separated patterns (CONF-04). Checked first so user overrides take
# precedence over soft-warn rules below.
# ---------------------------------------------------------------------------
_EXTRA_BLOCKED="${ARCANON_EXTRA_BLOCKED:-}"
if [[ -n "$_EXTRA_BLOCKED" ]]; then
  IFS=':' read -ra _extra_patterns <<< "$_EXTRA_BLOCKED"
  for _pat in "${_extra_patterns[@]}"; do
    [[ -z "$_pat" ]] && continue
    # Match against basename and full path — unquoted for glob expansion (*.bak matches foo.bak)
    # shellcheck disable=SC2053
    if [[ "$BASENAME" == $_pat ]] || [[ "$FILE" == $_pat ]]; then
      block_file "$FILE" "matches custom block pattern '$_pat' in ARCANON_EXTRA_BLOCKED"
    fi
  done
fi

# ---------------------------------------------------------------------------
# GRDH-03: Hard-block secret/credential files
# Patterns: .env, .env.*, *.pem, *.key, *credentials*, *secret*
# ---------------------------------------------------------------------------
if [[ "$BASENAME" == ".env" ]] || [[ "$BASENAME" == .env.* ]]; then
  block_file "$FILE" "sensitive .env file protected"
fi

if [[ "$BASENAME" == *.pem ]]; then
  block_file "$FILE" "PEM certificate/key file protected"
fi

if [[ "$BASENAME" == *.key ]]; then
  block_file "$FILE" "private key file protected"
fi

if [[ "$BASENAME" == *credentials* ]]; then
  block_file "$FILE" "credentials file protected"
fi

if [[ "$BASENAME" == *secret* ]]; then
  block_file "$FILE" "secret file protected"
fi

# ---------------------------------------------------------------------------
# GRDH-02: Hard-block lock files
# Patterns: *.lock (Cargo.lock, poetry.lock, yarn.lock, Pipfile.lock, bun.lock)
#           package-lock.json (doesn't match *.lock — separate pattern)
# ---------------------------------------------------------------------------
case "$BASENAME" in
  *.lock|package-lock.json)
    block_file "$FILE" "lock file -- managed by package manager, not Claude"
    ;;
esac

# ---------------------------------------------------------------------------
# GRDH-04: Hard-block generated/vendor directories
# Patterns: */node_modules/*, */.venv/*, */target/*
# ---------------------------------------------------------------------------
if [[ "$FILE" == */node_modules/* ]] || [[ "$FILE" == */node_modules ]]; then
  block_file "$FILE" "node_modules/ is a generated directory -- do not edit directly"
fi

if [[ "$FILE" == */.venv/* ]] || [[ "$FILE" == */.venv ]]; then
  block_file "$FILE" ".venv/ is a generated directory -- do not edit directly"
fi

if [[ "$FILE" == */target/* ]] || [[ "$FILE" == */target ]]; then
  block_file "$FILE" "target/ is a generated directory -- do not edit directly"
fi

# ---------------------------------------------------------------------------
# GRDH-05: Soft-warn migration files (exit 0 + systemMessage)
# Patterns: */migrations/*.sql, */migrations/*.py
# ---------------------------------------------------------------------------
if [[ "$FILE" == */migrations/*.sql ]] || [[ "$FILE" == */migrations/*.py ]]; then
  warn_file "$FILE" "migration file -- migrations should be immutable once applied. Editing may cause schema drift."
fi

# ---------------------------------------------------------------------------
# GRDH-06: Soft-warn generated code files (exit 0 + systemMessage)
# Patterns: *.pb.go, *_generated.*, *.gen.*
# ---------------------------------------------------------------------------
if [[ "$BASENAME" == *.pb.go ]]; then
  warn_file "$FILE" "protobuf-generated file -- edits may be overwritten on next build. Edit the .proto source instead."
fi

if [[ "$BASENAME" == *_generated.* ]]; then
  warn_file "$FILE" "generated code file -- edits may be overwritten on next build. Edit the source template instead."
fi

if [[ "$BASENAME" == *.gen.* ]]; then
  warn_file "$FILE" "generated code file -- edits may be overwritten on next build. Edit the source template instead."
fi

# ---------------------------------------------------------------------------
# GRDH-07: Soft-warn CHANGELOG (exit 0 + systemMessage)
# ---------------------------------------------------------------------------
if [[ "$BASENAME" == "CHANGELOG.md" ]] || [[ "$BASENAME" == "CHANGELOG" ]]; then
  warn_file "$FILE" "CHANGELOG is often auto-generated. Verify this project manages it manually before editing."
fi

# ---------------------------------------------------------------------------
# Default: allow with no output
# ---------------------------------------------------------------------------
exit 0
