#!/usr/bin/env bash
# lib/data-dir.sh — Shared data directory resolver with legacy back-compat.
#
# Usage:
#   source "$PLUGIN_ROOT/lib/data-dir.sh"
#   dir=$(resolve_arcanon_data_dir)
#
# Preference order:
#   1. $ARCANON_DATA_DIR (current override)
#   2. $LIGAMEN_DATA_DIR (legacy override, deprecated)
#   3. $HOME/.arcanon    if it exists
#   4. $HOME/.ligamen    if it exists and ~/.arcanon does not
#   5. $HOME/.arcanon    (default)

resolve_arcanon_data_dir() {
  if [[ -n "${ARCANON_DATA_DIR:-}" ]]; then
    printf '%s\n' "$ARCANON_DATA_DIR"
    return 0
  fi
  if [[ -n "${LIGAMEN_DATA_DIR:-}" ]]; then
    printf '%s\n' "$LIGAMEN_DATA_DIR"
    return 0
  fi
  if [[ -d "$HOME/.arcanon" ]]; then
    printf '%s\n' "$HOME/.arcanon"
    return 0
  fi
  if [[ -d "$HOME/.ligamen" ]]; then
    printf '%s\n' "$HOME/.ligamen"
    return 0
  fi
  printf '%s\n' "$HOME/.arcanon"
}
