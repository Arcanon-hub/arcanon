#!/usr/bin/env bash
# drift-versions.sh — Cross-repo dependency version drift checker
# Part of the Ligamen drift skill (Phase 10, DRFT-01, DRFT-05, DRFT-06)
# Usage: drift-versions.sh [--all] [--test-only]
#   --all        Show INFO-level findings (suppressed by default)
#   --test-only  Source-safe: define functions but do not execute main loop
#
# Environment:
#   DRIFT_TEST_LINKED_REPOS  Space-separated repo paths (overrides linked repo discovery, for testing)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/drift-common.sh"

parse_drift_args "$@"

# ---------------------------------------------------------------------------
# extract_versions REPO_DIR
# Outputs "PACKAGE_NAME=VERSION" lines for all detected manifests in REPO_DIR.
# Supports: package.json, go.mod, Cargo.toml, pyproject.toml
# ---------------------------------------------------------------------------
extract_versions() {
  local repo_dir="$1"

  # ---- package.json (jq — always available per PLGN-07) -------------------
  if [[ -f "${repo_dir}/package.json" ]]; then
    jq -r '
      (.dependencies // {}) + (.devDependencies // {}) |
      to_entries[] |
      "\(.key)=\(.value)"
    ' "${repo_dir}/package.json" 2>/dev/null || true
  fi

  # ---- go.mod (awk — pure POSIX, handles both inline and block forms) ------
  if [[ -f "${repo_dir}/go.mod" ]]; then
    awk '
      /^require \(/ { in_block=1; next }
      /^\)/         { in_block=0; next }
      in_block && /^\t/ { print $1"="$2 }
      /^require [^(]/ { print $2"="$3 }
    ' "${repo_dir}/go.mod" 2>/dev/null || true
  fi

  # ---- Cargo.toml ----------------------------------------------------------
  if [[ -f "${repo_dir}/Cargo.toml" ]]; then
    if command -v yq &>/dev/null; then
      # yq TOML: extract dependencies, handle both string and inline-table forms
      yq -oy '(.dependencies // {}) | to_entries[] | .key + "=" + (.value | (.version // .))' \
        "${repo_dir}/Cargo.toml" 2>/dev/null | grep -v '^null$' | grep -v '=$' || true
    else
      # Scope extraction to [dependencies] section only (avoid [package] metadata).
      # Uses POSIX awk + sed to handle simple and inline-table forms.
      awk '
        /^\[dependencies\]/ { in_deps=1; next }
        /^\[/ && !/^\[dependencies\]/ { in_deps=0 }
        in_deps { print }
      ' "${repo_dir}/Cargo.toml" 2>/dev/null | while IFS= read -r dep_line; do
        # Skip empty lines and comments
        [[ -z "$dep_line" || "$dep_line" =~ ^[[:space:]]*# ]] && continue
        local dep_name dep_ver
        dep_name=$(echo "$dep_line" | sed 's/[[:space:]]*=.*//' | tr -d '[:space:]')
        [[ -z "$dep_name" ]] && continue
        # Simple form: name = "version"
        if echo "$dep_line" | grep -qE '=[[:space:]]*"[0-9]'; then
          dep_ver=$(echo "$dep_line" | sed 's/.*= *"//; s/".*//')
          echo "${dep_name}=${dep_ver}"
        # Inline table form: name = { version = "X", ... }
        elif echo "$dep_line" | grep -qE 'version[[:space:]]*=[[:space:]]*"'; then
          dep_ver=$(echo "$dep_line" | grep -oE 'version[[:space:]]*=[[:space:]]*"[^"]+"' | sed 's/version[[:space:]]*=[[:space:]]*"//; s/"//')
          [[ -n "$dep_ver" ]] && echo "${dep_name}=${dep_ver}"
        fi
      done || true
    fi
  fi

  # ---- pyproject.toml ------------------------------------------------------
  if [[ -f "${repo_dir}/pyproject.toml" ]]; then
    if command -v yq &>/dev/null; then
      # Extract [project.dependencies] PEP 508 strings and normalize to NAME=VERSION
      yq -oy '.project.dependencies[]' "${repo_dir}/pyproject.toml" 2>/dev/null | while IFS= read -r dep_str; do
        # Strip surrounding quotes
        dep_str=$(echo "$dep_str" | tr -d '"')
        # name = everything before first specifier char
        local dep_name dep_ver
        dep_name="${dep_str%%[>=<!~^ ]*}"
        dep_ver=$(echo "$dep_str" | grep -oE '[>=<!~^][^,; ]+' | head -1 | sed 's/^==//' || true)
        [[ -n "$dep_name" ]] && echo "${dep_name}=${dep_ver:-unknown}"
      done 2>/dev/null || true
      # Also extract [tool.poetry.dependencies]
      yq -oy '.tool.poetry.dependencies | to_entries[] | .key + "=" + .value' \
        "${repo_dir}/pyproject.toml" 2>/dev/null | grep -v '^null$' | grep -v 'python=' || true
    else
      # Fallback awk — covers both PEP 621 (dependencies = [...]) and the
      # non-standard [project.dependencies] section form with bare strings.
      awk '
        # PEP 621 inline-array form: dependencies = [ "foo>=1", ... ]
        /^[[:space:]]*dependencies[[:space:]]*=[[:space:]]*\[/ { in_array=1; next }
        in_array && /\]/ { in_array=0 }
        # Legacy [project.dependencies] section form
        /\[project\.dependencies\]/ { in_section=1; next }
        /^\[/ && !/\[project\.dependencies\]/ { in_section=0 }
        (in_section || in_array) && /[a-zA-Z0-9]/ {
          line=$0
          gsub(/,$/, "", line)
          gsub(/^[[:space:]]*"/, "", line)
          gsub(/"[[:space:]]*$/, "", line)
          gsub(/^[[:space:]]*/, "", line)
          gsub(/[[:space:]]*$/, "", line)
          if (line == "" || line ~ /^\[/) next
          n=split(line, parts, /[>=<!~^ ]/)
          name=parts[1]
          ver=substr(line, length(name)+1)
          gsub(/^[[:space:]]*/, "", ver)
          gsub(/^==/, "", ver)
          gsub(/^=/, "", ver)
          if (name != "") print name "=" ver
        }
      ' "${repo_dir}/pyproject.toml" 2>/dev/null || true
    fi
  fi
}

# ---------------------------------------------------------------------------
# normalize_version VERSION
# Strips leading semver range specifiers (^, ~, >=, <=, >, <, ==) for comparison.
# ---------------------------------------------------------------------------
normalize_version() {
  echo "$1" | sed 's/^[^0-9a-zA-Z]*//' | sed 's/^[^0-9]*//'
}

# ---------------------------------------------------------------------------
# has_range_specifier VERSION
# Returns 0 (true) if version string starts with a range specifier char
# ---------------------------------------------------------------------------
has_range_specifier() {
  # Use case/glob instead of bash regex — bash regex interprets \> and \<
  # as word-boundary anchors on some libc builds (notably GNU libc on
  # Ubuntu 24.04), causing false positives on plain pinned versions.
  case "$1" in
    \^*|~*|\>*|\<*|=*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Main comparison loop
# Skip when --test-only is passed (allows sourcing from tests to call extract_versions)
# ---------------------------------------------------------------------------
for _arg in "$@"; do
  if [[ "$_arg" == "--test-only" ]]; then
    # Export functions so subshells can use them, then stop here
    export -f extract_versions normalize_version has_range_specifier
    # return works when sourced, exit when run directly
    # shellcheck disable=SC2317
    return 0 2>/dev/null || exit 0
  fi
done
unset _arg

# Allow test harness to inject linked repos via environment variable
if [[ -n "${DRIFT_TEST_LINKED_REPOS:-}" ]]; then
  LINKED_REPOS="$DRIFT_TEST_LINKED_REPOS"
fi

if [[ -z "${LINKED_REPOS:-}" ]]; then
  echo "No linked repo repos found. Run from a directory with linked repo git repos." >&2
  exit 0
fi

# Use a tmpdir to store package data without requiring bash 4 associative arrays.
# Layout:
#   $TMPDIR/versions/<PKG_SAFE>  — lines of "REPO_NAME=VERSION"
# PKG_SAFE = package name with / and . replaced by __ and _
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

pkg_safe() {
  # Encode a package name as a safe filename: replace / . @ with __
  local safe="$1"
  safe="${safe//\//__}"
  safe="${safe//./__}"
  safe="${safe// /__}"
  safe="${safe//@/__}"
  printf '%s\n' "$safe"
}

for REPO in $LINKED_REPOS; do
  [[ -d "$REPO" ]] || continue
  repo_name=$(basename "$REPO")
  while IFS='=' read -r pkg ver; do
    [[ -z "${pkg:-}" || -z "${ver:-}" ]] && continue
    [[ "$pkg" =~ ^[[:space:]]*$ ]] && continue
    safe=$(pkg_safe "$pkg")
    pkg_dir="${WORK_DIR}/${safe}"
    mkdir -p "$pkg_dir"
    # Store original package name (first write wins)
    [[ -f "${pkg_dir}/name" ]] || echo "$pkg" > "${pkg_dir}/name"
    # Append repo=version line (one per repo)
    echo "${repo_name}=${ver}" >> "${pkg_dir}/data"
  done < <(extract_versions "$REPO" 2>/dev/null || true)
done

found_drift=false

for pkg_dir in "${WORK_DIR}"/*/; do
  [[ -f "${pkg_dir}/data" ]] || continue
  pkg=$(cat "${pkg_dir}/name")

  # Count distinct repos for this package
  repo_count=$(wc -l < "${pkg_dir}/data" | tr -d '[:space:]')
  [[ "$repo_count" -lt 2 ]] && continue  # only in one repo — not drift

  # Gather per-repo details
  repos_detail=""
  versions_raw=""
  has_range=false
  repos_list=""

  while IFS='=' read -r repo_name ver; do
    [[ -z "$repo_name" || -z "$ver" ]] && continue
    norm=$(normalize_version "$ver")
    versions_raw="${versions_raw}${norm} "
    repos_detail="${repos_detail}${repo_name}=${ver} "
    repos_list="${repos_list}${repo_name} "
    has_range_specifier "$ver" && has_range=true || true
  done < "${pkg_dir}/data"

  unique_count=$(echo "$versions_raw" | tr ' ' '\n' | sort -u | grep -c '\S' || true)

  if [[ "$unique_count" -gt 1 ]]; then
    found_drift=true
    if $has_range; then
      emit_finding "WARN" "$pkg" "$repos_list" "Different locking strategies: ${repos_detail%% }"
    else
      emit_finding "CRITICAL" "$pkg" "$repos_list" "Version mismatch: ${repos_detail%% }"
    fi
  elif [[ "$unique_count" -eq 1 ]]; then
    # Stripped versions match — check if raw strings differ (range specifier mismatch)
    raw_unique=$(awk -F= '{print $NF}' "${pkg_dir}/data" | sort -u | grep -c '\S' || true)
    if [[ "$raw_unique" -gt 1 ]]; then
      found_drift=true
      emit_finding "WARN" "$pkg" "$repos_list" "Different range specifiers: ${repos_detail%% }"
    else
      emit_finding "INFO" "$pkg" "$repos_list" "All at same version (${versions_raw%% *})"
    fi
  fi
done

if ! $found_drift; then
  repo_count=$(echo "$LINKED_REPOS" | tr ' ' '\n' | grep -c '\S' || true)
  echo "No version drift detected across ${repo_count} repos."
fi
