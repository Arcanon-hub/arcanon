#!/usr/bin/env bats
# drift-versions.bats — Tests for scripts/drift-versions.sh
# Requirements: DRFT-01 (version extraction), DRFT-05 (report with repo details), DRFT-06 (severity filtering)

TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
PLUGIN_ROOT="$(cd "$TEST_DIR/../plugins/arcanon" && pwd)"
DRIFT_VERSIONS="${PLUGIN_ROOT}/scripts/drift-versions.sh"
FIXTURES="${TEST_DIR}/fixtures/drift"

load "$TEST_DIR/test_helper/bats-support/load"
load "$TEST_DIR/test_helper/bats-assert/load"

# ---------------------------------------------------------------------------
# extract_versions function tests (DRFT-01)
# ---------------------------------------------------------------------------

@test "extract_versions: returns NAME=VERSION lines for package.json dependencies" {
  # Source the script to access extract_versions function
  # We override SIBLINGS to avoid sibling discovery
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    # Source only the extract_versions function logic
    source '${DRIFT_VERSIONS}' --test-only 2>/dev/null || true
    extract_versions '${FIXTURES}/repo-a'
  "
  # lodash=4.17.21 should appear
  assert_output --partial "lodash=4.17.21"
}

@test "extract_versions: returns NAME=VERSION lines for package.json devDependencies" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    source '${DRIFT_VERSIONS}' --test-only 2>/dev/null || true
    extract_versions '${FIXTURES}/repo-a'
  "
  assert_output --partial "jest=29.0.0"
}

@test "extract_versions: extracts go.mod block-format require entries" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    source '${DRIFT_VERSIONS}' --test-only 2>/dev/null || true
    extract_versions '${FIXTURES}/repo-a'
  "
  assert_output --partial "github.com/gin-gonic/gin=v1.9.1"
}

@test "extract_versions: extracts go.mod inline require entries" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    source '${DRIFT_VERSIONS}' --test-only 2>/dev/null || true
    extract_versions '${FIXTURES}/repo-a'
  "
  assert_output --partial "github.com/go-playground/validator/v10=v10.15.5"
}

@test "extract_versions: extracts Cargo.toml simple string deps" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    source '${DRIFT_VERSIONS}' --test-only 2>/dev/null || true
    extract_versions '${FIXTURES}/repo-a'
  "
  assert_output --partial "serde=1.0.188"
}

@test "extract_versions: extracts Cargo.toml inline table deps (version = X)" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    source '${DRIFT_VERSIONS}' --test-only 2>/dev/null || true
    extract_versions '${FIXTURES}/repo-a'
  "
  assert_output --partial "tokio=1.32.0"
}

@test "extract_versions: extracts pyproject.toml PEP 508 dependencies" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    source '${DRIFT_VERSIONS}' --test-only 2>/dev/null || true
    extract_versions '${FIXTURES}/repo-a'
  "
  # pydantic==2.3.0 should produce pydantic=2.3.0 or similar normalized form
  assert_output --partial "pydantic"
}

# ---------------------------------------------------------------------------
# Cross-repo comparison and reporting (DRFT-05)
# ---------------------------------------------------------------------------

@test "report shows CRITICAL for pinned version mismatch across repos" {
  # Create fake arcanon.config.json pointing to fixture repos
  local tmpdir
  tmpdir=$(mktemp -d)
  cat > "${tmpdir}/arcanon.config.json" <<'EOF'
{"linked-repos": []}
EOF
  # Run drift-versions with SIBLINGS pointing to both fixture repos
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    export DRIFT_TEST_LINKED_REPOS='${FIXTURES}/repo-a ${FIXTURES}/repo-b'
    bash '${DRIFT_VERSIONS}'
  "
  # lodash has pinned mismatch: 4.17.21 vs 4.17.15
  assert_output --partial "CRITICAL"
  assert_output --partial "lodash"
  rm -rf "$tmpdir"
}

@test "report shows repo names and versions in finding details" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    export DRIFT_TEST_LINKED_REPOS='${FIXTURES}/repo-a ${FIXTURES}/repo-b'
    bash '${DRIFT_VERSIONS}'
  "
  # Output should mention both repos and their versions
  assert_output --partial "repo-a"
  assert_output --partial "repo-b"
}

@test "report shows WARN for range specifier vs range specifier mismatch (express)" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    export DRIFT_TEST_LINKED_REPOS='${FIXTURES}/repo-a ${FIXTURES}/repo-b'
    bash '${DRIFT_VERSIONS}'
  "
  # express: ^4.18.0 vs ~4.18.0 — different locking strategies = WARN
  assert_output --partial "WARN"
  assert_output --partial "express"
}

@test "no drift reported for packages at identical versions" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    export DRIFT_TEST_LINKED_REPOS='${FIXTURES}/repo-a ${FIXTURES}/repo-b'
    bash '${DRIFT_VERSIONS}'
  "
  # jest is 29.0.0 in both repos — should NOT appear as drift
  refute_output --partial "jest"
}

# ---------------------------------------------------------------------------
# Severity filtering (DRFT-06)
# ---------------------------------------------------------------------------

@test "default output shows CRITICAL findings" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    export DRIFT_TEST_LINKED_REPOS='${FIXTURES}/repo-a ${FIXTURES}/repo-b'
    bash '${DRIFT_VERSIONS}'
  "
  assert_output --partial "CRITICAL"
}

@test "default output suppresses INFO-level findings" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    export DRIFT_TEST_LINKED_REPOS='${FIXTURES}/repo-a ${FIXTURES}/repo-b'
    bash '${DRIFT_VERSIONS}'
  "
  refute_output --partial "[ INFO  ]"
}

@test "with --all flag, INFO-level findings are shown" {
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    export DRIFT_TEST_LINKED_REPOS='${FIXTURES}/repo-a ${FIXTURES}/repo-b'
    bash '${DRIFT_VERSIONS}' --all
  "
  # When --all is passed, INFO findings should appear (if any exist)
  # This test verifies the flag is accepted without error
  assert_success
}

@test "packages appearing in only one repo are not reported as drift" {
  # repo-a has go-playground/validator, repo-b does not
  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'
    export DRIFT_TEST_LINKED_REPOS='${FIXTURES}/repo-a ${FIXTURES}/repo-b'
    bash '${DRIFT_VERSIONS}'
  "
  refute_output --partial "go-playground/validator"
}
