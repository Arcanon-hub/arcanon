#!/usr/bin/env bats
# Ligamen — detect.bats
# Tests: TEST-05 (project type detection library)
# Covers: detect_project_type and detect_all_project_types from lib/detect.sh
#
# These tests source lib/detect.sh directly (Pattern 4 from RESEARCH.md).
# Tests are in RED state until lib/detect.sh is implemented.
# Note: lib/detect.sh exists at Phase 13 time — tests should pass GREEN.

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  FIXTURES_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/../plugins/arcanon"
}

teardown() {
  rm -rf "${FIXTURES_DIR}"
}

# ---------------------------------------------------------------------------
# detect_project_type — single primary type (TEST-05)
# ---------------------------------------------------------------------------

@test "detect.sh - detects Python from pyproject.toml" {
  touch "${FIXTURES_DIR}/pyproject.toml"
  # shellcheck source=lib/detect.sh
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "python"
}

@test "detect.sh - detects Rust from Cargo.toml" {
  touch "${FIXTURES_DIR}/Cargo.toml"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "rust"
}

@test "detect.sh - detects Node/TS from package.json" {
  touch "${FIXTURES_DIR}/package.json"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  # Accepts both "node" and "typescript" per RESEARCH.md open question 2
  assert_output --partial "node"
}

@test "detect.sh - detects Go from go.mod" {
  touch "${FIXTURES_DIR}/go.mod"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "go"
}

@test "detect.sh - Python takes priority over Node in mixed-language repo" {
  # detect_project_type returns single type; Python has highest priority per lib
  touch "${FIXTURES_DIR}/pyproject.toml"
  touch "${FIXTURES_DIR}/package.json"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "python"
}

@test "detect.sh - returns unknown for directory with no manifest" {
  # Empty FIXTURES_DIR — no manifest files present
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  refute_output --partial "python"
  refute_output --partial "rust"
  refute_output --partial "node"
  refute_output --partial "go"
}

# ---------------------------------------------------------------------------
# detect_all_project_types — multi-type (mixed-language repos, TEST-05)
# ---------------------------------------------------------------------------

@test "detect.sh - detects mixed Python+Node via detect_all_project_types" {
  touch "${FIXTURES_DIR}/pyproject.toml"
  touch "${FIXTURES_DIR}/package.json"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_all_project_types "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "python"
  assert_output --partial "node"
}

@test "detect.sh - detect_all_project_types returns all four in a full-stack repo" {
  touch "${FIXTURES_DIR}/pyproject.toml"
  touch "${FIXTURES_DIR}/Cargo.toml"
  touch "${FIXTURES_DIR}/package.json"
  touch "${FIXTURES_DIR}/go.mod"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_all_project_types "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "python"
  assert_output --partial "rust"
  assert_output --partial "node"
  assert_output --partial "go"
}

@test "detect.sh - detect_all_project_types returns empty string for no-manifest dir" {
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_all_project_types "${FIXTURES_DIR}"
  assert_success
  assert_output ""
}

@test "detect.sh - detects Python from setup.py (alternate manifest)" {
  touch "${FIXTURES_DIR}/setup.py"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "python"
}

# ---------------------------------------------------------------------------
# detect_language — new java/csharp/ruby branches (LANG-01)
# ---------------------------------------------------------------------------

@test "detect.sh - detect_language: .java returns java" {
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_language foo.java
  assert_success
  assert_output "java"
}

@test "detect.sh - detect_language: .cs returns csharp" {
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_language foo.cs
  assert_success
  assert_output "csharp"
}

@test "detect.sh - detect_language: .rb returns ruby" {
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_language foo.rb
  assert_success
  assert_output "ruby"
}

# ---------------------------------------------------------------------------
# detect_project_type — java/dotnet/ruby manifest detection (LANG-02)
# ---------------------------------------------------------------------------

@test "detect.sh - detects Java from pom.xml" {
  touch "${FIXTURES_DIR}/pom.xml"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "java"
}

@test "detect.sh - detects Java from build.gradle.kts" {
  touch "${FIXTURES_DIR}/build.gradle.kts"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "java"
}

@test "detect.sh - detects dotnet from *.csproj" {
  touch "${FIXTURES_DIR}/MyApp.csproj"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "dotnet"
}

@test "detect.sh - detects Ruby from Gemfile" {
  touch "${FIXTURES_DIR}/Gemfile"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "ruby"
}

@test "detect.sh - python wins over java when both pyproject.toml and pom.xml present (LANG-02 priority)" {
  touch "${FIXTURES_DIR}/pyproject.toml"
  touch "${FIXTURES_DIR}/pom.xml"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "python"
}

@test "detect.sh - node wins over ruby when both package.json and Gemfile present (LANG-02 priority)" {
  touch "${FIXTURES_DIR}/package.json"
  touch "${FIXTURES_DIR}/Gemfile"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "node"
}
