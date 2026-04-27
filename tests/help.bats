#!/usr/bin/env bats
# tests/help.bats — Phase 116 Plan 01 (HELP-01..04).
#
# NOTE: the iteration list here is hand-coupled to the active command roster.
# When a command is added or removed, this list AND
# tests/commands-surface.bats:18 BOTH need updating. Acceptable manual coupling
# documented per RESEARCH §10 question 5.

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
}

@test "HELP-01: every /arcanon:* command file has exactly one ## Help section" {
  for cmd in map drift impact sync login status export verify update list view doctor diff; do
    local count
    count=$(grep -c '^## Help[[:space:]]*$' "$PLUGIN_DIR/commands/$cmd.md" || true)
    [ "$count" -eq 1 ] || {
      echo "FAIL ($cmd): expected exactly 1 '## Help' heading, found $count"
      return 1
    }
  done
}

@test "HELP-02: lib/help.sh extracts non-empty content for every command" {
  source "$PLUGIN_DIR/lib/help.sh"
  for cmd in map drift impact sync login status export verify update list view doctor diff; do
    run arcanon_extract_help_section "$PLUGIN_DIR/commands/$cmd.md"
    [ "$status" -eq 0 ] || { echo "FAIL ($cmd): extractor returned $status"; return 1; }
    [ -n "$output" ] || { echo "FAIL ($cmd): empty output"; return 1; }
  done
}

@test "HELP-02: arcanon_print_help_if_requested triggers on --help / -h / help" {
  source "$PLUGIN_DIR/lib/help.sh"
  for arg in --help -h help; do
    run arcanon_print_help_if_requested "$arg" "$PLUGIN_DIR/commands/status.md"
    [ "$status" -eq 0 ] || { echo "FAIL: '$arg' returned $status"; return 1; }
    [ -n "$output" ] || { echo "FAIL: '$arg' produced empty output"; return 1; }
  done
}

@test "HELP-02: arcanon_print_help_if_requested does NOT trigger on unrelated args" {
  source "$PLUGIN_DIR/lib/help.sh"
  for arg in "" "--json" "--json --quiet" "view" "--repo /tmp"; do
    run arcanon_print_help_if_requested "$arg" "$PLUGIN_DIR/commands/status.md"
    [ "$status" -ne 0 ] || { echo "FAIL: '$arg' wrongly triggered help"; return 1; }
  done
}

@test "HELP-02: arcanon_print_help_if_requested honors --help when mixed with other flags" {
  source "$PLUGIN_DIR/lib/help.sh"
  run arcanon_print_help_if_requested "--json --help" "$PLUGIN_DIR/commands/status.md"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
}

@test "HELP-03: commands/update.md preserves the host-CLI 'claude plugin update --help' line" {
  run grep -F 'claude plugin update --help' "$PLUGIN_DIR/commands/update.md"
  [ "$status" -eq 0 ]
}

@test "HELP-04: every command's body invokes arcanon_print_help_if_requested" {
  for cmd in map drift impact sync login status export verify update list view doctor diff; do
    grep -q 'arcanon_print_help_if_requested' "$PLUGIN_DIR/commands/$cmd.md" || {
      echo "FAIL ($cmd): no help-check call"
      return 1
    }
  done
}

@test "HELP/doctor: doctor.md retains the renamed Troubleshooting section" {
  run grep -c '^## Troubleshooting[[:space:]]*$' "$PLUGIN_DIR/commands/doctor.md"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}
