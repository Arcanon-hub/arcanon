#!/usr/bin/env bash
# drift-versions.sh — Version drift checker across sibling repos.
# Extracts dependency versions from package.json, go.mod, Cargo.toml, pyproject.toml
# and reports CRITICAL when the same package appears at different versions in 2+ repos.
set -euo pipefail

# Source shared helpers (sets PLUGIN_ROOT, SHOW_INFO, SIBLINGS, emit_finding, parse_drift_args)
source "$(dirname "${BASH_SOURCE[0]}")/drift-common.sh"

# Parse args: sets SHOW_INFO from --all flag
parse_drift_args "$@"

# extract_versions REPO_DIR
# Prints "PACKAGE_NAME=VERSION" lines to stdout for all manifests found in REPO_DIR.
extract_versions() {
  local repo_dir="$1"

  # package.json — use jq (required by PLGN-07; always available)
  if [[ -f "${repo_dir}/package.json" ]]; then
    jq -r '
      (.dependencies // {}) + (.devDependencies // {}) |
      to_entries[] |
      "\(.key)=\(.value)"
    ' "${repo_dir}/package.json" 2>/dev/null || true
  fi

  # go.mod — pure awk; handles both block and inline require forms
  if [[ -f "${repo_dir}/go.mod" ]]; then
    awk '
      /^require \(/ { in_block=1; next }
      /^\)/         { in_block=0; next }
      in_block && /^\t/ { print $1 "=" $2 }
      /^require [^(]/ { print $2 "=" $3 }
    ' "${repo_dir}/go.mod" 2>/dev/null || true
  fi

  # Cargo.toml — yq when available; grep fallback for simple and inline-table forms
  if [[ -f "${repo_dir}/Cargo.toml" ]]; then
    if command -v yq &>/dev/null; then
      yq -oy '(.dependencies // {}) | to_entries[] | .key + "=" + (.value | .version // .)' \
        "${repo_dir}/Cargo.toml" 2>/dev/null || true
    else
      # Simple "dep = \"version\"" form
      grep -E '^\s*\w+ *= *"[0-9]' "${repo_dir}/Cargo.toml" 2>/dev/null |
        sed 's/\s*//g; s/=.*"//; s/"$//' || true
      # Inline table "dep = { version = \"1.2.3\", ... }" form
      grep -oE 'version = "[^"]+"' "${repo_dir}/Cargo.toml" 2>/dev/null |
        sed 's/version = "//; s/"//' || true
    fi
  fi

  # pyproject.toml — yq when available; awk fallback for PEP 508 lines
  if [[ -f "${repo_dir}/pyproject.toml" ]]; then
    if command -v yq &>/dev/null; then
      yq -oy '.project.dependencies[]' "${repo_dir}/pyproject.toml" 2>/dev/null || true
      yq -oy '.tool.poetry.dependencies | to_entries[] | .key + "==" + .value' \
        "${repo_dir}/pyproject.toml" 2>/dev/null || true
    else
      # PEP 508: lines inside [project.dependencies] section
      awk '/\[project\.dependencies\]/{found=1; next} /^\[/{found=0} found && /^\s*"/{print}' \
        "${repo_dir}/pyproject.toml" 2>/dev/null || true
    fi
  fi
}

# normalize_version VERSION
# Strips leading semver range specifiers (^, ~, >=, <=, >, <) for comparison.
# Returns: bare version string
normalize_version() {
  echo "$1" | sed 's/^[^0-9]*//'
}

# has_range_specifier VERSION
# Returns 0 (true) if version string starts with a range specifier
has_range_specifier() {
  [[ "$1" =~ ^[\^~\>=\<] ]]
}

# Collect all package versions across all sibling repos
declare -A pkg_versions  # ["REPO:PKG"] = "VERSION"
declare -A pkg_repos     # ["PKG"] = "repo1 repo2 ..."

for REPO in $SIBLINGS; do
  while IFS='=' read -r pkg ver; do
    [[ -z "${pkg:-}" || -z "${ver:-}" ]] && continue
    # Skip lines that are not valid package=version pairs
    [[ "$pkg" =~ ^[[:space:]]*$ ]] && continue
    pkg_versions["${REPO}:${pkg}"]="$ver"
    pkg_repos["$pkg"]="${pkg_repos[$pkg]:-}${REPO} "
  done < <(extract_versions "$REPO" 2>/dev/null || true)
done

# Report drift: packages appearing in 2+ repos with differing versions
found_drift=false

for pkg in "${!pkg_repos[@]}"; do
  repos="${pkg_repos[$pkg]}"
  # Count repos that actually have this package
  repo_count=$(echo "$repos" | tr ' ' '\n' | grep -c '\S' || true)
  [[ "$repo_count" -lt 2 ]] && continue  # single-repo package — not drift

  # Gather versions and check for drift
  versions_raw=""
  repos_detail=""
  has_range=false

  for repo in $repos; do
    v="${pkg_versions["${repo}:${pkg}"]:-}"
    [[ -z "$v" ]] && continue
    norm=$(normalize_version "$v")
    versions_raw="${versions_raw}${norm} "
    repos_detail="${repos_detail}$(basename "$repo")=${v} "
    has_range_specifier "$v" && has_range=true || true
  done

  unique_count=$(echo "$versions_raw" | tr ' ' '\n' | sort -uV | grep -c '\S' || true)

  if [[ "$unique_count" -gt 1 ]]; then
    found_drift=true
    if $has_range; then
      emit_finding "WARN" "$pkg" "$repos" \
        "Different locking strategies or versions: ${repos_detail%. }"
    else
      emit_finding "CRITICAL" "$pkg" "$repos" \
        "Version mismatch: ${repos_detail%. }"
    fi
  else
    emit_finding "INFO" "$pkg" "$repos" "All at same version (${versions_raw%% *})"
  fi
done

if ! $found_drift; then
  repo_count=$(echo "$SIBLINGS" | tr ' ' '\n' | grep -c '\S' || true)
  echo "No version drift detected across ${repo_count} repos."
fi
