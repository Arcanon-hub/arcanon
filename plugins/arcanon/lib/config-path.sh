#!/usr/bin/env bash
# lib/config-path.sh — Shared config-path resolver with legacy back-compat.
#
# Usage:
#   source "$PLUGIN_ROOT/lib/config-path.sh"
#   cfg=$(resolve_arcanon_config)         # defaults to $PWD
#   cfg=$(resolve_arcanon_config "$dir")  # explicit directory
#
# Preference order:
#   1. arcanon.config.json   (current)
#   2. ligamen.config.json   (legacy, printed to stderr with deprecation notice)
#   3. arcanon.config.json   (default path when neither exists)

resolve_arcanon_config() {
  local dir="${1:-$PWD}"
  if [[ -f "$dir/arcanon.config.json" ]]; then
    printf '%s\n' "$dir/arcanon.config.json"
    return 0
  fi
  if [[ -f "$dir/ligamen.config.json" ]]; then
    echo "arcanon: notice: using legacy ligamen.config.json — please rename to arcanon.config.json" >&2
    printf '%s\n' "$dir/ligamen.config.json"
    return 0
  fi
  printf '%s\n' "$dir/arcanon.config.json"
}
