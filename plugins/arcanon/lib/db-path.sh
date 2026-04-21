#!/usr/bin/env bash
# lib/db-path.sh — Resolve per-project impact-map.db path (HOK-12)
#
# Mirrors the hash algorithm in worker/db/pool.js projectHashDir():
#   crypto.createHash("sha256").update(projectRoot).digest("hex").slice(0, 12)
#
# Usage:
#   source "$PLUGIN_ROOT/lib/db-path.sh"
#   db=$(resolve_project_db_path "/abs/project/root")
#   hash=$(resolve_project_db_hash "/abs/project/root")
#
# Note: resolve_project_db_path returns the path string unconditionally.
# The DB file may or may not exist — callers must `[[ -f "$db" ]]` themselves.
# This keeps the resolver pure and side-effect-free.
#
# Dependencies: data-dir.sh (provides resolve_arcanon_data_dir)
# Required tools: shasum (macOS + Linux) OR sha256sum (GNU coreutils)

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }

_ARCANON_DB_PATH_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./data-dir.sh
source "${_ARCANON_DB_PATH_LIB_DIR}/data-dir.sh"

# resolve_project_db_hash <project_root>
#
# Prints the 12-character hex hash used to name the per-project data directory.
# Equivalent to:
#   crypto.createHash("sha256").update(projectRoot).digest("hex").slice(0, 12)
#
# Critical: input is via `printf '%s'` (no trailing newline). Node's .update()
# hashes the raw string without a newline; echo -n is a bashism and not portable.
resolve_project_db_hash() {
  local project_root="$1"
  if [[ -z "$project_root" ]]; then
    echo "resolve_project_db_hash: project_root required" >&2
    return 1
  fi
  # Prefer shasum (available on macOS + most Linux distros).
  # Fall back to sha256sum (GNU coreutils — present on Linux, not macOS by default).
  if command -v shasum &>/dev/null; then
    printf '%s' "$project_root" | shasum -a 256 | cut -c1-12
  elif command -v sha256sum &>/dev/null; then
    printf '%s' "$project_root" | sha256sum | cut -c1-12
  else
    echo "resolve_project_db_hash: neither shasum nor sha256sum found in PATH" >&2
    return 1
  fi
}

# resolve_project_db_path <project_root>
#
# Prints the absolute path to the per-project impact-map.db file.
# Returns the path unconditionally — caller must test -f the result.
# Respects ARCANON_DATA_DIR / LIGAMEN_DATA_DIR overrides via data-dir.sh.
#
# Example:
#   db=$(resolve_project_db_path "/home/user/my-project")
#   [[ -f "$db" ]] || { echo "No scan data yet"; exit 0; }
#   sqlite3 "$db" "SELECT name FROM services;"
resolve_project_db_path() {
  local project_root="$1"
  if [[ -z "$project_root" ]]; then
    echo "resolve_project_db_path: project_root required" >&2
    return 1
  fi
  local data_dir hash
  data_dir=$(resolve_arcanon_data_dir)
  hash=$(resolve_project_db_hash "$project_root") || return 1
  printf '%s\n' "${data_dir}/projects/${hash}/impact-map.db"
}
