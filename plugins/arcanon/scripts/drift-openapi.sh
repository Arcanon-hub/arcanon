#!/usr/bin/env bash
# drift-openapi.sh — OpenAPI spec drift checker across linked repos.
# Uses oasdiff for structured comparison when available; falls back to yq structural diff.
# Never does raw YAML diff (research Pitfall 3: $ref resolution is required for accuracy).
set -euo pipefail

# Source shared helpers (sets PLUGIN_ROOT, SHOW_INFO, LINKED_REPOS, emit_finding, parse_drift_args)
source "$(dirname "${BASH_SOURCE[0]}")/drift-common.sh"

# Parse args: sets SHOW_INFO from --all flag
parse_drift_args "$@"

# Candidate OpenAPI spec file locations in order of convention frequency (research Pattern 5)
OPENAPI_CANDIDATES=(
  "openapi.yaml"
  "openapi.yml"
  "openapi.json"
  "swagger.yaml"
  "swagger.yml"
  "swagger.json"
  "api/openapi.yaml"
  "api/openapi.yml"
  "api/openapi.json"
  "api/swagger.yaml"
  "docs/openapi.yaml"
  "spec/openapi.yaml"
)

# find_openapi_spec REPO_DIR
# Prints the path to the OpenAPI spec file, or returns 1 if not found.
find_openapi_spec() {
  local repo_dir="$1"

  # Check well-known locations first (fast path)
  for candidate in "${OPENAPI_CANDIDATES[@]}"; do
    if [[ -f "${repo_dir}/${candidate}" ]]; then
      echo "${repo_dir}/${candidate}"
      return 0
    fi
  done

  # Fallback: recursive scan limited to maxdepth 3 to avoid slowness
  local found
  found=$(find "$repo_dir" -maxdepth 3 \( -name "openapi.yaml" -o -name "openapi.json" \) 2>/dev/null | head -1)
  if [[ -n "$found" ]]; then
    echo "$found"
    return 0
  fi

  return 1
}

# compare_openapi SPEC_A SPEC_B REPO_A REPO_B
# Compares two OpenAPI specs and emits findings.
# Uses oasdiff > yq structural diff > informational message (in that priority order).
compare_openapi() {
  local spec_a="$1"
  local spec_b="$2"
  local repo_a="$3"
  local repo_b="$4"
  local repo_pair="${repo_a} / ${repo_b}"

  if command -v oasdiff &>/dev/null; then
    # Full structured diff with $ref resolution (best fidelity)

    # Breaking changes
    local breaking_result
    breaking_result=$(oasdiff breaking "$spec_a" "$spec_b" 2>/dev/null || true)
    if [[ -n "$breaking_result" ]]; then
      emit_finding "CRITICAL" "openapi-spec" "$repo_pair" \
        "Breaking changes: $(echo "$breaking_result" | head -10 | tr '\n' ' ')"
    fi

    # Non-breaking differences
    local diff_result
    diff_result=$(oasdiff diff "$spec_a" "$spec_b" --format text 2>/dev/null | head -20 || true)
    if [[ -n "$diff_result" ]]; then
      emit_finding "WARN" "openapi-spec" "$repo_pair" \
        "Non-breaking diffs found (showing first 20 lines): $(echo "$diff_result" | tr '\n' ' ')"
    fi

    if [[ -z "$breaking_result" && -z "$diff_result" ]]; then
      emit_finding "INFO" "openapi-spec" "$repo_pair" "OpenAPI specs are identical"
    fi

  elif command -v yq &>/dev/null; then
    # Degraded mode: structural path comparison only — does NOT resolve $ref
    # Flag this clearly per research Pitfall 3
    echo "[ INFO  ] oasdiff not installed — using basic structural comparison (no \$ref resolution)" >&2

    local paths_a paths_b delta
    paths_a=$(yq '.. | path | join(".")' "$spec_a" 2>/dev/null | sort || true)
    paths_b=$(yq '.. | path | join(".")' "$spec_b" 2>/dev/null | sort || true)

    delta=$(diff <(echo "$paths_a") <(echo "$paths_b") 2>/dev/null | grep -c '^[<>]' || true)

    if [[ "$delta" -gt 0 ]]; then
      emit_finding "WARN" "openapi-spec" "$repo_pair" \
        "Structural differences found (${delta} paths differ). Install oasdiff for full analysis with \$ref resolution."
    else
      emit_finding "INFO" "openapi-spec" "$repo_pair" \
        "No structural differences found (basic comparison — install oasdiff for full accuracy)"
    fi

  else
    # Neither oasdiff nor yq available
    emit_finding "INFO" "openapi-spec" "$repo_pair" \
      "Cannot compare OpenAPI specs without oasdiff or yq. Install either tool."
  fi
}

# Collect repos that have OpenAPI specs
repos_with_specs=()
spec_paths=()

for repo in $LINKED_REPOS; do
  repo_name=$(basename "$repo")
  spec_path=$(find_openapi_spec "$repo" 2>/dev/null || true)
  if [[ -n "$spec_path" ]]; then
    repos_with_specs+=("$repo_name")
    spec_paths+=("$spec_path")
  fi
done

spec_count=${#repos_with_specs[@]}

if [[ "$spec_count" -lt 2 ]]; then
  echo "Fewer than 2 repos have OpenAPI specs — nothing to compare."
  exit 0
fi

# Compare specs
# For N <= 5 repos: compare all N*(N-1)/2 pairs (full comparison)
# For N > 5 repos: hub-and-spoke — compare each against first repo only (limits execution time)
if [[ "$spec_count" -le 5 ]]; then
  # Full pairwise comparison
  for (( i=0; i<spec_count-1; i++ )); do
    for (( j=i+1; j<spec_count; j++ )); do
      compare_openapi \
        "${spec_paths[$i]}" \
        "${spec_paths[$j]}" \
        "${repos_with_specs[$i]}" \
        "${repos_with_specs[$j]}"
    done
  done
else
  # Hub-and-spoke: compare each against first repo
  echo "[ INFO  ] More than 5 repos with specs — comparing each against ${repos_with_specs[0]} (hub-and-spoke)" >&2
  for (( i=1; i<spec_count; i++ )); do
    compare_openapi \
      "${spec_paths[0]}" \
      "${spec_paths[$i]}" \
      "${repos_with_specs[0]}" \
      "${repos_with_specs[$i]}"
  done
fi
