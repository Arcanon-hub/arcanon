#!/usr/bin/env bash
# lib/siblings.sh — Sibling repo discovery library
# Source this file; do not execute directly.
# Usage: source lib/siblings.sh && list_siblings [current_dir]
# Outputs: one absolute path per line, one per sibling repo
# Reads allclear.config.json "siblings" array if present; falls back to parent dir scan.
# All debug output goes to stderr only (per PLGN-08).

set -euo pipefail

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }

# list_siblings [current_dir]
# Discover sibling repositories adjacent to current_dir.
# If current_dir/allclear.config.json exists and has a siblings array, use that.
# Otherwise, scan parent_dir/*/ for directories containing .git/.
# Excludes the current repo itself from results.
list_siblings() {
  local current_dir="${1:-$PWD}"
  current_dir="$(cd "$current_dir" && pwd)"
  local parent_dir
  parent_dir="$(dirname "$current_dir")"
  local config_file="${current_dir}/allclear.config.json"

  if [[ -f "$config_file" ]]; then
    echo "allclear: using sibling config from $config_file" >&2
    printf '%s\n' "$(cat "$config_file")" | \
      jq -r '.siblings[]?.path // empty' 2>/dev/null
    return
  fi

  # Auto-discover: scan parent dir for directories with .git
  for d in "$parent_dir"/*/; do
    [[ -d "${d}.git" ]] || continue
    # Exclude the current repo
    [[ "$(cd "$d" && pwd)" != "$(cd "$current_dir" && pwd)" ]] || continue
    printf '%s\n' "${d%/}"
  done
}
