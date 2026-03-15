#!/usr/bin/env bash
# lib/config.sh — Sourceable library: loads allclear.config.json if present.
# Safe to source multiple times (guard variable prevents double-loading).
# Does NOT source any other library (leaf node in the source graph).
#
# Populates after sourcing:
#   ALLCLEAR_CONFIG_SIBLINGS  — bash array of sibling repo paths from config
#
# Environment variables honoured:
#   ALLCLEAR_CONFIG_FILE  — override path to config file
#                           (default: allclear.config.json in current directory)

# Guard against double-source
if [[ -n "${_ALLCLEAR_CONFIG_LOADED:-}" ]]; then
  return 0
fi
_ALLCLEAR_CONFIG_LOADED=1

# Resolve config file path (default: allclear.config.json relative to cwd)
ALLCLEAR_CONFIG_FILE="${ALLCLEAR_CONFIG_FILE:-allclear.config.json}"

# CONF-01: sibling repo path overrides — initialize to empty array
ALLCLEAR_CONFIG_SIBLINGS=()

if [[ -f "$ALLCLEAR_CONFIG_FILE" ]]; then
  # Validate JSON first — warn on malformed config and skip parsing
  if ! jq '.' "$ALLCLEAR_CONFIG_FILE" >/dev/null 2>&1; then
    echo "allclear: warning: allclear.config.json is malformed, using defaults" >&2
  else
    # Use while-read loop (NOT mapfile) for bash 3.2 compatibility (macOS default)
    while IFS= read -r _sibling_path; do
      [[ -n "$_sibling_path" ]] && ALLCLEAR_CONFIG_SIBLINGS+=("$_sibling_path")
    done < <(jq -r '.siblings[]? // empty' "$ALLCLEAR_CONFIG_FILE" 2>/dev/null)
  fi
fi

# Note: Do NOT export ALLCLEAR_CONFIG_SIBLINGS — bash cannot export arrays
# across subshells. Consumers must source this file directly.
