#!/usr/bin/env bash
# lib/detect.sh — Project type and language detection library
# Source this file; do not execute directly.
# No set -e here — sourcing context owns error handling.

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }

# detect_language FILE
# Returns: lowercase language token (python|rust|typescript|javascript|go|java|csharp|ruby|json|yaml|unknown)
detect_language() {
  local file="$1"
  local ext="${file##*.}"
  case "$ext" in
    py)              echo "python" ;;
    rs)              echo "rust" ;;
    ts|tsx)          echo "typescript" ;;
    js|jsx|mjs|cjs)  echo "javascript" ;;
    go)              echo "go" ;;
    java)            echo "java" ;;
    cs)              echo "csharp" ;;
    rb)              echo "ruby" ;;
    json)            echo "json" ;;
    yaml|yml)        echo "yaml" ;;
    *)               echo "unknown" ;;
  esac
}

# detect_project_type DIR
# Returns: primary project type token (python|rust|node|go|java|dotnet|ruby|unknown)
# Priority: python > rust > node > go > java > dotnet > ruby
# DIR defaults to "." if not provided.
detect_project_type() {
  local dir="${1:-.}"
  if [[ -f "$dir/pyproject.toml" || -f "$dir/setup.py" ]]; then
    echo "python"
  elif [[ -f "$dir/Cargo.toml" ]]; then
    echo "rust"
  elif [[ -f "$dir/package.json" ]]; then
    echo "node"
  elif [[ -f "$dir/go.mod" ]]; then
    echo "go"
  elif [[ -f "$dir/pom.xml" || -f "$dir/build.gradle" || -f "$dir/build.gradle.kts" ]]; then
    echo "java"
  elif compgen -G "$dir/*.csproj" > /dev/null 2>&1 || compgen -G "$dir/*.sln" > /dev/null 2>&1; then
    echo "dotnet"
  elif [[ -f "$dir/Gemfile" ]]; then
    echo "ruby"
  else
    echo "unknown"
  fi
}

# detect_all_project_types DIR
# Returns: space-separated list of ALL detected project types (no "unknown" fallback)
# Empty string if none detected — callers check [[ -z "$result" ]]
# DIR defaults to "." if not provided.
detect_all_project_types() {
  local dir="${1:-.}"
  local types=()
  [[ -f "$dir/pyproject.toml" || -f "$dir/setup.py" ]] && types+=("python")
  [[ -f "$dir/Cargo.toml" ]]   && types+=("rust")
  [[ -f "$dir/package.json" ]] && types+=("node")
  [[ -f "$dir/go.mod" ]]       && types+=("go")
  [[ -f "$dir/pom.xml" || -f "$dir/build.gradle" || -f "$dir/build.gradle.kts" ]] && types+=("java")
  { compgen -G "$dir/*.csproj" > /dev/null 2>&1 || compgen -G "$dir/*.sln" > /dev/null 2>&1; } && types+=("dotnet")
  [[ -f "$dir/Gemfile" ]] && types+=("ruby")
  echo "${types[*]}"
}
