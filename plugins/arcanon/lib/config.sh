#!/usr/bin/env bash
# lib/config.sh — Sourceable library: loads arcanon.config.json (or legacy ligamen.config.json) if present.
# Safe to source multiple times (guard variable prevents double-loading).
#
# Populates after sourcing:
#   ARCANON_CONFIG_LINKED_REPOS  — bash array of linked repo paths from config
#   ARCANON_CONFIG_FILE          — resolved path to the config file
#
# Environment variables honoured:
#   ARCANON_CONFIG_FILE          — override path to config file
#
# Back-compat aliases (deprecated, will be removed in v7):
#   LIGAMEN_CONFIG_LINKED_REPOS, LIGAMEN_CONFIG_FILE

# Guard against double-source
if [[ -n "${_ARCANON_CONFIG_LOADED:-}" ]]; then
  return 0
fi
_ARCANON_CONFIG_LOADED=1

_ARCANON_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./config-path.sh
source "${_ARCANON_LIB_DIR}/config-path.sh"

# Resolve config file path: honour override, else use resolver with legacy fallback.
if [[ -n "${ARCANON_CONFIG_FILE:-}" ]]; then
  :
elif [[ -n "${LIGAMEN_CONFIG_FILE:-}" ]]; then
  # Back-compat: accept old env var
  ARCANON_CONFIG_FILE="${LIGAMEN_CONFIG_FILE}"
else
  ARCANON_CONFIG_FILE="$(resolve_arcanon_config "$PWD")"
fi

ARCANON_CONFIG_LINKED_REPOS=()

if [[ -f "$ARCANON_CONFIG_FILE" ]]; then
  if ! jq '.' "$ARCANON_CONFIG_FILE" >/dev/null 2>&1; then
    echo "arcanon: warning: $ARCANON_CONFIG_FILE is malformed, using defaults" >&2
  else
    while IFS= read -r _linked_repo_path; do
      [[ -n "$_linked_repo_path" ]] && ARCANON_CONFIG_LINKED_REPOS+=("$_linked_repo_path")
    done < <(jq -r '.["linked-repos"][]? // empty' "$ARCANON_CONFIG_FILE" 2>/dev/null)
  fi
fi

# Back-compat aliases — consumers still reading LIGAMEN_* see the same values.
LIGAMEN_CONFIG_FILE="$ARCANON_CONFIG_FILE"
LIGAMEN_CONFIG_LINKED_REPOS=("${ARCANON_CONFIG_LINKED_REPOS[@]}")
