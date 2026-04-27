#!/usr/bin/env bash
# lib/help.sh — Arcanon canonical `--help` extractor + flag detector.
# Source this file; do not execute it directly.
# Functions:
#   arcanon_extract_help_section <file>           — print the file's `## Help` section
#   arcanon_print_help_if_requested <args> <file> — print help iff $args contains --help / -h / help
#
# The `## Help` section in each command's markdown file IS the source of truth.
# Phase 116-01 (HELP-01..04).

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }

# arcanon_extract_help_section <file>
#
# Print everything from a line matching `^## Help[[:space:]]*$` up to (but not
# including) the next `^## ` heading, OR to EOF.
#
# The trailing whitespace tolerance on the heading match (`[[:space:]]*$`)
# guards against accidental trailing spaces in command files.
#
# Stateful awk (rather than a `/range1/,/range2/` pair) is used because the
# range form would close on the SAME line as the start when the start line
# itself matches the end pattern (`## Help` matches both `^## Help` and
# `^## `). The state-machine form correctly waits for a SUBSEQUENT `## ` line.
#
# Returns: 0 on success (section found and printed), 1 if file unreadable or
# section is missing/empty.
arcanon_extract_help_section() {
  local file="$1"
  [[ -r "$file" ]] || return 1
  local out
  out=$(awk '
    /^## Help[[:space:]]*$/ { in_section=1; print; next }
    in_section && /^## / { exit }
    in_section { print }
  ' "$file")
  [[ -n "$out" ]] || return 1
  printf '%s\n' "$out"
  return 0
}

# arcanon_print_help_if_requested <arguments-string> <command-md-path>
#
# When the arguments string contains `--help`, `-h`, or `help` as a
# whitespace-separated token, extract and print the help section, then
# return 0. Otherwise return 1 (no output).
#
# Tokenisation relies on shell word splitting (`for token in $args`) — the
# same mechanism Claude Code's slash-command runtime uses to forward
# `$ARGUMENTS` into the body's bash blocks (verified at
# `commands/verify.md:62`: `bash hub.sh verify $ARGUMENTS`).
arcanon_print_help_if_requested() {
  local args="${1:-}"
  local cmd_md="$2"
  local token found=0
  for token in $args; do
    case "$token" in
      --help|-h|help) found=1; break ;;
    esac
  done
  [[ $found -eq 1 ]] || return 1
  arcanon_extract_help_section "$cmd_md" || {
    printf '(no help section found in %s)\n' "$cmd_md" >&2
    return 0
  }
  return 0
}
