#!/usr/bin/env bash
# scripts/impact.sh — Cross-repo reference scanner for Arcanon
# Usage: bash scripts/impact.sh [symbol...] [--changed] [--exclude <repo>]
# Scans linked repositories for references to specified symbols.
# Classifies matches as code, config, docs, or test based on file path.
# Groups output by repo in tab-separated format: repo\tterm\ttype\tfilepath
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "${PLUGIN_ROOT}/lib/linked-repos.sh"

# ─── Argument parsing ─────────────────────────────────────────────────────────
TERMS=()
EXCLUDES=()
CHANGED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --changed) CHANGED=true; shift ;;
    --exclude) EXCLUDES+=("$2"); shift 2 ;;
    *) TERMS+=("$1"); shift ;;
  esac
done

# ─── --changed: extract symbols from git diff HEAD~1 ─────────────────────────
if [[ "$CHANGED" == true ]]; then
  CHANGED_FILES=""
  CHANGED_FILES="$(git diff HEAD~1 --name-only 2>/dev/null | \
    grep -E '\.(py|rs|ts|js|tsx|jsx|go|java|rb|sh)$' || true)"

  # Use a temp file for accumulation (no mapfile — POSIX portable)
  TMPFILE="/tmp/arcanon_terms_$$"
  trap 'rm -f "$TMPFILE"' EXIT

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    git diff HEAD~1 --unified=0 -- "$file" 2>/dev/null | \
      grep '^[+-]' | grep -v '^---\|^+++' | \
      grep -oE '\b(def |class |fn |func |pub fn |pub struct |pub enum |interface |type |export (const|function|class) )[A-Za-z_][A-Za-z0-9_]+' | \
      grep -oE '[A-Za-z_][A-Za-z0-9_]+$' >> "$TMPFILE" || true
  done <<< "$CHANGED_FILES"

  if [[ -f "$TMPFILE" && -s "$TMPFILE" ]]; then
    # Populate TERMS from temp file (no mapfile — POSIX portable)
    while IFS= read -r sym; do
      [[ -z "$sym" ]] && continue
      TERMS+=("$sym")
    done < <(sort -u "$TMPFILE")
  fi
fi

# ─── Guard: must have at least one search term ────────────────────────────────
if [[ ${#TERMS[@]} -eq 0 ]]; then
  printf '%s\n' '{"error": "No search terms provided. Use: bash scripts/impact.sh <symbol> or --changed"}' >&2
  exit 1
fi

# ─── Discover linked repos ───────────────────────────────────────────────────
LINKED_REPOS="$(list_linked_repos 2>/dev/null)"

echo "Scanning for: ${TERMS[*]}"
echo "---"

# ─── Scan each linked ────────────────────────────────────────────────────────
while IFS= read -r linked_path; do
  [[ -z "$linked_path" ]] && continue
  repo_name="$(basename "$linked_path")"

  # Apply --exclude list
  skip=false
  for ex in "${EXCLUDES[@]+"${EXCLUDES[@]}"}"; do
    [[ "$repo_name" == "$ex" ]] && skip=true && break
  done
  [[ "$skip" == true ]] && continue

  echo "repo: $repo_name"

  for term in "${TERMS[@]}"; do
    # Run grep and classify each match
    # Output raw grep hits, then classify with awk (avoids calling classify_match
    # in a subshell loop for performance on large repos)
    grep -rn \
      --include="*.py" \
      --include="*.rs" \
      --include="*.ts" \
      --include="*.tsx" \
      --include="*.js" \
      --include="*.jsx" \
      --include="*.go" \
      --include="*.java" \
      --include="*.rb" \
      --include="*.sh" \
      --include="*.json" \
      --include="*.yaml" \
      --include="*.yml" \
      --include="*.toml" \
      --include="*.md" \
      --include="*.rst" \
      --exclude-dir=".git" \
      --exclude-dir="node_modules" \
      --exclude-dir=".venv" \
      --exclude-dir="target" \
      --exclude-dir="dist" \
      --exclude-dir="build" \
      --exclude-dir=".planning" \
      "$term" "$linked_path" 2>/dev/null | \
    awk -F: -v term="$term" -v repo="$repo_name" '
      {
        filepath = $1
        fname = filepath
        # Get basename for pattern matching
        n = split(filepath, parts, "/")
        basename = parts[n]

        # Lowercase for matching (POSIX awk tolower)
        lower_path = tolower(filepath)
        lower_fname = tolower(basename)
        ext = basename
        sub(/.*\./, "", ext)
        ext = tolower(ext)

        # Classification: test > docs > config > code
        ftype = "code"

        # Test patterns
        if (lower_path ~ /\/(tests?|__tests__|spec)\//) {
          ftype = "test"
        } else if (lower_fname ~ /(_test\.|_spec\.|\.test\.|\.spec\.)/) {
          ftype = "test"
        } else if (lower_fname ~ /^(test_|spec_)/) {
          ftype = "test"
        # Docs patterns
        } else if (ext == "md" || ext == "rst" || ext == "txt" || ext == "adoc") {
          ftype = "docs"
        # Config patterns
        } else if (ext == "json" || ext == "yaml" || ext == "yml" || \
                   ext == "toml" || ext == "ini" || ext == "env") {
          ftype = "config"
        } else if (lower_fname == "makefile" || lower_fname == "dockerfile" || \
                   lower_fname == "docker-compose.yml" || lower_fname == "docker-compose.yaml") {
          ftype = "config"
        }

        print repo "\t" term "\t" ftype "\t" filepath
      }
    ' | sort -u -t$'\t' -k4
  done

  echo ""
done <<< "$LINKED_REPOS"
