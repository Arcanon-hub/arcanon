#!/usr/bin/env bats
# tests/drift-openapi-explicit-spec.bats — INT-04
# Asserts /arcanon:drift openapi --spec bypasses discovery and uses explicit paths.

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
DRIFT_OPENAPI="${PLUGIN_ROOT}/scripts/drift-openapi.sh"
FIXTURE_DIR="${PLUGIN_ROOT}/tests/fixtures/integration/openapi"
SPEC_A="${FIXTURE_DIR}/spec-a.yaml"
SPEC_B="${FIXTURE_DIR}/spec-b.yaml"

setup() {
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  # Disable discovery — drift-common.sh uses DRIFT_TEST_LINKED_REPOS as its override.
  # Provide a real (empty) directory so list_linked_repos doesn't fall back to PWD scan.
  FAKE_REPO="$(mktemp -d)"
  export DRIFT_TEST_LINKED_REPOS="$FAKE_REPO"
  export PATH="/opt/homebrew/bin:$PATH"
}

teardown() {
  rm -rf "$FAKE_REPO"
  unset DRIFT_TEST_LINKED_REPOS
}

@test "INT-04: --spec A --spec B with two valid specs runs comparison" {
  run bash "$DRIFT_OPENAPI" --spec "$SPEC_A" --spec "$SPEC_B"
  # Exit 0 expected — comparison emits findings as informational/warn, not as a script error.
  [ "$status" -eq 0 ]
}

@test "INT-04: --spec with single path exits 2 with friendly error" {
  run bash "$DRIFT_OPENAPI" --spec "$SPEC_A"
  [ "$status" -eq 2 ]
  [[ "$output" =~ "--spec requires at least 2 paths" ]]
}

@test "INT-04: --spec with missing file exits 2 with friendly error" {
  run bash "$DRIFT_OPENAPI" --spec /nonexistent-spec-12345.yaml --spec "$SPEC_B"
  [ "$status" -eq 2 ]
  [[ "$output" =~ "spec not found: /nonexistent-spec-12345.yaml" ]]
}

@test "INT-04: no --spec preserves auto-discovery (zero linked repos -> friendly empty)" {
  run bash "$DRIFT_OPENAPI"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Fewer than 2 repos have OpenAPI specs" ]]
}

@test "INT-04: drift.md frontmatter argument-hint mentions --spec" {
  run grep -E '^argument-hint:.*--spec' "${PLUGIN_ROOT}/commands/drift.md"
  [ "$status" -eq 0 ]
}
