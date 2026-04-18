#!/usr/bin/env bash
# drift-types.sh — Heuristic type definition consistency checker across same-language linked repos.
# Compares shared type/interface/struct/class names within same-language repo groups.
# Reports CRITICAL when a shared type has differing field lists.
set -euo pipefail

# Source shared helpers (sets PLUGIN_ROOT, SHOW_INFO, LINKED_REPOS, emit_finding, parse_drift_args)
source "$(dirname "${BASH_SOURCE[0]}")/drift-common.sh"

# Parse args: sets SHOW_INFO from --all flag
parse_drift_args "$@"

# detect_repo_language REPO_DIR
# Returns a language tag: ts | go | py | rs | unknown
detect_repo_language() {
  local repo_dir="$1"
  if [[ -f "${repo_dir}/package.json" ]]; then
    echo "ts"
  elif [[ -f "${repo_dir}/go.mod" ]]; then
    echo "go"
  elif [[ -f "${repo_dir}/pyproject.toml" ]] || [[ -f "${repo_dir}/setup.py" ]] || [[ -f "${repo_dir}/setup.cfg" ]]; then
    echo "py"
  elif [[ -f "${repo_dir}/Cargo.toml" ]]; then
    echo "rs"
  else
    echo "unknown"
  fi
}

# extract_ts_types REPO_DIR
# Prints TypeScript exported interface and type names, one per line (UPPERCASE-starting only)
extract_ts_types() {
  local repo_dir="$1"
  grep -rh --include="*.ts" -E "export[[:space:]]+(interface|type)[[:space:]]+[A-Z][A-Za-z0-9_]+" \
    "${repo_dir}/src" 2>/dev/null |
    sed 's/.*\(interface\|type\)[[:space:]]\+//' |
    awk '{print $1}' |
    grep -E '^[A-Z][A-Za-z0-9_]+' |
    sort -u
}

# extract_go_structs REPO_DIR
# Prints Go exported struct names, one per line
extract_go_structs() {
  local repo_dir="$1"
  grep -rh --include="*.go" -E "^type[[:space:]]+[A-Z][A-Za-z0-9_]+[[:space:]]+struct" \
    "${repo_dir}" 2>/dev/null |
    awk '{print $2}' |
    grep -E '^[A-Z][A-Za-z0-9_]+' |
    sort -u
}

# extract_py_classes REPO_DIR
# Prints Python class names starting with uppercase, one per line
extract_py_classes() {
  local repo_dir="$1"
  # Search in src/ if present, otherwise project root
  local search_dirs=()
  [[ -d "${repo_dir}/src" ]] && search_dirs+=("${repo_dir}/src")
  search_dirs+=("${repo_dir}")

  for d in "${search_dirs[@]}"; do
    find "$d" -maxdepth 4 -name "*.py" -exec grep -hE "^class[[:space:]]+[A-Z][A-Za-z0-9_]+.*:" {} \; 2>/dev/null |
      sed 's/class[[:space:]]\+//' |
      awk '{print $1}' |
      sed 's/[:(].*//' |
      grep -E '^[A-Z][A-Za-z0-9_]+'
  done | sort -u
}

# extract_rs_structs REPO_DIR
# Prints Rust public struct names starting with uppercase, one per line
extract_rs_structs() {
  local repo_dir="$1"
  grep -rh --include="*.rs" -E "^pub[[:space:]]+struct[[:space:]]+[A-Z][A-Za-z0-9_]+" \
    "${repo_dir}/src" 2>/dev/null |
    awk '{print $3}' |
    grep -E '^[A-Z][A-Za-z0-9_]+' |
    sort -u
}

# extract_type_names REPO_DIR LANGUAGE
# Dispatches to the correct extractor for the given language
extract_type_names() {
  local repo_dir="$1"
  local lang="$2"
  case "$lang" in
    ts) extract_ts_types "$repo_dir" ;;
    go) extract_go_structs "$repo_dir" ;;
    py) extract_py_classes "$repo_dir" ;;
    rs) extract_rs_structs "$repo_dir" ;;
  esac
}

# extract_type_body REPO_DIR TYPENAME LANGUAGE
# Extracts the field list for a type definition (lines between open brace and closing brace/dedent)
extract_type_body() {
  local repo_dir="$1"
  local typename="$2"
  local lang="$3"

  case "$lang" in
    ts)
      # Find the file containing this type and extract its body
      grep -rl --include="*.ts" -E "(interface|type)[[:space:]]+${typename}[[:space:]*{(<]" \
        "${repo_dir}/src" 2>/dev/null | head -1 | while read -r f; do
        awk "/^(export )?(interface|type) ${typename}[^A-Za-z0-9_]/{found=1; depth=0} found{depth+=gsub(/{/,\"{\"); depth-=gsub(/}/,\"}\"); if (depth>0) print; if (found && depth<=0) found=0}" "$f" 2>/dev/null
      done
      ;;
    go)
      grep -rl --include="*.go" -E "type ${typename} struct" "${repo_dir}" 2>/dev/null | head -1 | while read -r f; do
        awk "/^type ${typename} struct/{found=1; next} found{if (/^}/) exit; print}" "$f" 2>/dev/null
      done
      ;;
    py)
      find "$repo_dir" -maxdepth 4 -name "*.py" -exec grep -l "^class ${typename}" {} \; 2>/dev/null | head -1 | while read -r f; do
        awk "/^class ${typename}[:(]/{found=1; next} found{if (/^[^ \t]/ && !/^[[:space:]]/) exit; print}" "$f" 2>/dev/null
      done
      ;;
    rs)
      grep -rl --include="*.rs" -E "pub struct ${typename}" "${repo_dir}/src" 2>/dev/null | head -1 | while read -r f; do
        awk "/pub struct ${typename}[^A-Za-z0-9_]/{found=1; next} found{if (/^}/) exit; print}" "$f" 2>/dev/null
      done
      ;;
  esac
}

# Group linked repos by language
declare -A lang_repos  # lang_repos["ts"] = "repo1 repo2 ..."

for repo in $LINKED_REPOS; do
  lang=$(detect_repo_language "$repo")
  [[ "$lang" == "unknown" ]] && continue
  lang_repos["$lang"]="${lang_repos[$lang]:-}${repo} "
done

any_shared_found=false

# Process each language group
for lang in "${!lang_repos[@]}"; do
  repos="${lang_repos[$lang]}"

  # Need at least 2 repos of the same language
  repo_count=$(echo "$repos" | tr ' ' '\n' | grep -c '\S' || true)
  [[ "$repo_count" -lt 2 ]] && continue

  # Collect type names from all repos in this language group
  declare -A type_repos  # type_repos["TypeName"] = "repo1 repo2 ..."

  for repo in $repos; do
    # Cap at top 50 type names per repo to avoid slowness (research Pitfall 5)
    while IFS= read -r typename; do
      [[ -z "$typename" ]] && continue
      type_repos["$typename"]="${type_repos[$typename]:-}${repo} "
    done < <(extract_type_names "$repo" "$lang" 2>/dev/null | head -50 || true)
  done

  # Find shared types (appearing in 2+ repos)
  for typename in "${!type_repos[@]}"; do
    repos_with_type="${type_repos[$typename]}"
    type_repo_count=$(echo "$repos_with_type" | tr ' ' '\n' | grep -c '\S' || true)
    [[ "$type_repo_count" -lt 2 ]] && continue

    any_shared_found=true

    # Compare field bodies between each pair
    repo_list=()
    for r in $repos_with_type; do
      repo_list+=("$r")
    done

    # Compare first repo against all others
    body_a=$(extract_type_body "${repo_list[0]}" "$typename" "$lang" 2>/dev/null | sort || true)
    repo_a_name=$(basename "${repo_list[0]}")

    has_diff=false
    diff_detail=""

    for (( i=1; i<${#repo_list[@]}; i++ )); do
      body_b=$(extract_type_body "${repo_list[$i]}" "$typename" "$lang" 2>/dev/null | sort || true)
      repo_b_name=$(basename "${repo_list[$i]}")

      if [[ -n "$body_a" || -n "$body_b" ]]; then
        field_diff=$(diff <(echo "$body_a") <(echo "$body_b") 2>/dev/null || true)
        if [[ -n "$field_diff" ]]; then
          has_diff=true
          diff_detail="${diff_detail}${repo_a_name} vs ${repo_b_name}: $(echo "$field_diff" | head -5 | tr '\n' '|') "
        fi
      fi
    done

    if $has_diff; then
      emit_finding "CRITICAL" "${typename} (${lang})" "$repos_with_type" \
        "Field differences: ${diff_detail%|}"
    else
      emit_finding "INFO" "${typename} (${lang})" "$repos_with_type" \
        "Fields match across all repos"
    fi
  done

  unset type_repos
  declare -A type_repos
done

if ! $any_shared_found; then
  echo "No shared type definitions found across linked repos."
fi
