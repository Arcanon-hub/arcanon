#!/usr/bin/env bash
# lib/linked-repos.sh — Linked repo discovery library
# Source this file; do not execute directly.
# No set -e here — sourcing context owns error handling.
# Usage: source lib/linked-repos.sh && list_linked_repos [current_dir]
# Outputs: one absolute path per line, one per linked repo
# Reads arcanon.config.json "linked-repos" array if present; falls back to parent dir scan.
# All debug output goes to stderr only (per PLGN-08).

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }

# list_linked_repos [current_dir]
# Discover linked repositories.
# If current_dir/arcanon.config.json exists and has a linked-repos array, use that.
# Otherwise, scan parent_dir/*/ for directories containing .git/.
# Excludes the current repo itself from results.
# Uses $(cd ... && pwd) instead of realpath — POSIX-safe, works on macOS without Homebrew.
list_linked_repos() {
  local current_dir="${1:-$PWD}"
  current_dir="$(cd "$current_dir" && pwd)"
  local parent_dir
  parent_dir="$(dirname "$current_dir")"
  local config_file="${current_dir}/arcanon.config.json"
  [[ -f "$config_file" ]] || config_file="${current_dir}/ligamen.config.json"

  if [[ -f "$config_file" ]]; then
    echo "arcanon: using linked-repos config from $config_file" >&2
    # PLGN-07: use printf pattern, never bare jq
    printf '%s\n' "$(cat "$config_file")" | \
      jq -r '.["linked-repos"][]? // empty' 2>/dev/null
    return
  fi

  # Auto-discover: scan parent dir for directories with .git
  for d in "$parent_dir"/*/; do
    [[ -d "${d}.git" ]] || continue
    local abs_d
    abs_d="$(cd "$d" && pwd)"
    # Exclude the current repo
    [[ "$abs_d" != "$current_dir" ]] || continue
    printf '%s\n' "$abs_d"
  done
}

# Backward compatibility aliases
list_siblings() {
  list_linked_repos "$@"
}

discover_siblings() {
  list_linked_repos "$@"
}
