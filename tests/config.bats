#!/usr/bin/env bats
# tests/config.bats — Arcanon configuration layer tests
# Covers: CONF-01 (config loading), CONF-02 (disable toggles),
#         CONF-03 (throttle override), CONF-04 (extra blocked patterns)

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
FIXTURE_DIR="$REPO_ROOT/tests/fixtures/config"
LIB_CONFIG="$REPO_ROOT/plugins/arcanon/lib/config.sh"

setup() {
  # Reset the guard variable before each test so lib/config.sh re-loads
  unset _LIGAMEN_CONFIG_LOADED
  unset LIGAMEN_CONFIG_FILE
  unset LIGAMEN_CONFIG_LINKED_REPOS
  # Save original directory
  ORIG_DIR="$PWD"
}

teardown() {
  # Restore original directory
  cd "$ORIG_DIR"
  # Reset the guard variable after each test
  unset _LIGAMEN_CONFIG_LOADED
  unset LIGAMEN_CONFIG_FILE
  unset LIGAMEN_CONFIG_LINKED_REPOS
}

# ---------------------------------------------------------------------------
# CONF-01: lib/config.sh loading behavior
# ---------------------------------------------------------------------------

@test "config.sh loads siblings from arcanon.config.json" {
  cd "$FIXTURE_DIR"
  source "$LIB_CONFIG"
  [ "${#LIGAMEN_CONFIG_LINKED_REPOS[@]}" -eq 3 ]
  [ "${LIGAMEN_CONFIG_LINKED_REPOS[0]}" = "../api" ]
  [ "${LIGAMEN_CONFIG_LINKED_REPOS[1]}" = "../ui" ]
  [ "${LIGAMEN_CONFIG_LINKED_REPOS[2]}" = "/opt/repos/sdk" ]
}

@test "config.sh returns empty siblings when no config file" {
  cd "$BATS_TEST_TMPDIR"
  source "$LIB_CONFIG"
  [ "${#LIGAMEN_CONFIG_LINKED_REPOS[@]}" -eq 0 ]
}

@test "config.sh warns on malformed JSON" {
  local tmpdir="$BATS_TEST_TMPDIR/malformed"
  mkdir -p "$tmpdir"
  echo "{ this is not valid json" > "$tmpdir/arcanon.config.json"
  cd "$tmpdir"
  output=$(source "$LIB_CONFIG" 2>&1)
  # Warning should be on stderr, captured via redirect
  run bash -c "
    unset _LIGAMEN_CONFIG_LOADED
    source '$LIB_CONFIG'
  "
  # Redirect stderr separately to check it
  warning=$(bash -c "
    unset _LIGAMEN_CONFIG_LOADED
    cd '$tmpdir'
    source '$LIB_CONFIG' 2>&1 >/dev/null
  ")
  [[ "$warning" == *"malformed"* ]]
  # Also verify siblings is empty
  unset _LIGAMEN_CONFIG_LOADED
  cd "$tmpdir"
  source "$LIB_CONFIG" 2>/dev/null
  [ "${#LIGAMEN_CONFIG_LINKED_REPOS[@]}" -eq 0 ]
}

@test "config.sh respects LIGAMEN_CONFIG_FILE override" {
  # Source from a different dir but point config at fixture
  cd "$BATS_TEST_TMPDIR"
  export LIGAMEN_CONFIG_FILE="$FIXTURE_DIR/arcanon.config.json"
  source "$LIB_CONFIG"
  [ "${#LIGAMEN_CONFIG_LINKED_REPOS[@]}" -eq 3 ]
  [ "${LIGAMEN_CONFIG_LINKED_REPOS[0]}" = "../api" ]
}

@test "config.sh guard prevents double loading" {
  cd "$FIXTURE_DIR"
  source "$LIB_CONFIG"
  local first_count="${#LIGAMEN_CONFIG_LINKED_REPOS[@]}"
  # Source again — should return early, no error
  source "$LIB_CONFIG"
  [ "${#LIGAMEN_CONFIG_LINKED_REPOS[@]}" -eq "$first_count" ]
}

# ---------------------------------------------------------------------------
# CONF-02: Disable env var toggles
# ---------------------------------------------------------------------------

@test "ARCANON_DISABLE_FORMAT exits 0 without formatting" {
  run env ARCANON_DISABLE_FORMAT=1 bash "$FIXTURE_DIR/mock-format.sh"
  [ "$status" -eq 0 ]
  [[ "$output" != *"format-ran"* ]]
}

@test "format runs when ARCANON_DISABLE_FORMAT unset" {
  run env -u ARCANON_DISABLE_FORMAT bash "$FIXTURE_DIR/mock-format.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"format-ran"* ]]
}

@test "ARCANON_DISABLE_LINT exits 0 without linting" {
  run env ARCANON_DISABLE_LINT=1 bash "$FIXTURE_DIR/mock-lint.sh"
  [ "$status" -eq 0 ]
  [[ "$output" != *"throttle="* ]]
}

@test "ARCANON_DISABLE_GUARD exits 0 allowing all writes" {
  run env ARCANON_DISABLE_GUARD=1 bash "$FIXTURE_DIR/mock-guard.sh" ".env"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# CONF-03: Lint throttle override
# ---------------------------------------------------------------------------

@test "LIGAMEN_LINT_THROTTLE overrides default 30s" {
  run env LIGAMEN_LINT_THROTTLE=10 bash "$FIXTURE_DIR/mock-lint.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"throttle=10"* ]]
}

@test "invalid LIGAMEN_LINT_THROTTLE falls back to 30" {
  run env LIGAMEN_LINT_THROTTLE=abc bash "$FIXTURE_DIR/mock-lint.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"throttle=30"* ]]
}

@test "unset LIGAMEN_LINT_THROTTLE uses default 30" {
  run env -u LIGAMEN_LINT_THROTTLE bash "$FIXTURE_DIR/mock-lint.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"throttle=30"* ]]
}

# ---------------------------------------------------------------------------
# CONF-04: Extra blocked patterns
# ---------------------------------------------------------------------------

@test "LIGAMEN_EXTRA_BLOCKED blocks matching file" {
  run env LIGAMEN_EXTRA_BLOCKED="*.bak:*.tmp" bash "$FIXTURE_DIR/mock-guard.sh" "foo.bak"
  [ "$status" -eq 2 ]
  [[ "$output" == *"blocked:foo.bak"* ]]
}

@test "LIGAMEN_EXTRA_BLOCKED allows non-matching file" {
  run env LIGAMEN_EXTRA_BLOCKED="*.bak" bash "$FIXTURE_DIR/mock-guard.sh" "foo.ts"
  [ "$status" -eq 0 ]
  [[ "$output" == *"allowed:foo.ts"* ]]
}

@test "multiple LIGAMEN_EXTRA_BLOCKED patterns all checked" {
  run env LIGAMEN_EXTRA_BLOCKED="*.bak:*.tmp:*.old" bash "$FIXTURE_DIR/mock-guard.sh" "data.tmp"
  [ "$status" -eq 2 ]
}
