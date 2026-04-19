#!/usr/bin/env bats
# drift-types.bats — Tests for scripts/drift-types.sh
# Requirements: TYPE-01 (detect_repo_language java/cs/rb), TYPE-02 (Java extractor),
#               TYPE-03 (C# extractor), TYPE-04 (Ruby extractor)

TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
PLUGIN_ROOT="$(cd "$TEST_DIR/../plugins/arcanon" && pwd)"
DRIFT_TYPES="${PLUGIN_ROOT}/scripts/drift-types.sh"
FIXTURES="${TEST_DIR}/fixtures/drift"

load "$TEST_DIR/test_helper/bats-support/load"
load "$TEST_DIR/test_helper/bats-assert/load"

# ---------------------------------------------------------------------------
# Phase 92 TYPE-01: detect_repo_language returns java/cs/rb
# ---------------------------------------------------------------------------

@test "detect_repo_language: pom.xml returns java" {
  source "${DRIFT_TYPES}" --test-only 2>/dev/null || true
  [[ "$(detect_repo_language "${FIXTURES}/java-types-repo-a")" == "java" ]]
}

@test "detect_repo_language: *.csproj returns cs" {
  source "${DRIFT_TYPES}" --test-only 2>/dev/null || true
  [[ "$(detect_repo_language "${FIXTURES}/cs-types-repo-a")" == "cs" ]]
}

@test "detect_repo_language: Gemfile returns rb" {
  source "${DRIFT_TYPES}" --test-only 2>/dev/null || true
  [[ "$(detect_repo_language "${FIXTURES}/rb-types-repo-a")" == "rb" ]]
}

# ---------------------------------------------------------------------------
# Phase 92 TYPE-02: Java extractor captures public class/interface/record/enum
# ---------------------------------------------------------------------------

@test "extract_java_types: captures public class with generic bound" {
  run bash -c "
    source '${DRIFT_TYPES}' --test-only 2>/dev/null || true
    extract_java_types '${FIXTURES}/java-types-repo-a'
  "
  assert_output --partial "User"
  # Must NOT include generic bound noise like 'User<T'
  refute_output --regexp '^User<'
}

# ---------------------------------------------------------------------------
# Phase 92 TYPE-03: C# extractor captures public class + record
# ---------------------------------------------------------------------------

@test "extract_cs_types: captures public class User" {
  run bash -c "
    source '${DRIFT_TYPES}' --test-only 2>/dev/null || true
    extract_cs_types '${FIXTURES}/cs-types-repo-a'
  "
  assert_output --partial "User"
}

@test "extract_cs_types: captures public record UserDto" {
  run bash -c "
    source '${DRIFT_TYPES}' --test-only 2>/dev/null || true
    extract_cs_types '${FIXTURES}/cs-types-repo-a'
  "
  assert_output --partial "UserDto"
}

# ---------------------------------------------------------------------------
# Phase 92 TYPE-04: Ruby extractor captures class, skips class_eval + stdlib
# ---------------------------------------------------------------------------

@test "extract_ruby_types: captures top-level User class" {
  run bash -c "
    source '${DRIFT_TYPES}' --test-only 2>/dev/null || true
    extract_ruby_types '${FIXTURES}/rb-types-repo-a'
  "
  assert_output --partial "User"
}

@test "extract_ruby_types: does NOT emit String (stdlib blacklist, monkey-patch false-positive guard)" {
  run bash -c "
    source '${DRIFT_TYPES}' --test-only 2>/dev/null || true
    extract_ruby_types '${FIXTURES}/rb-types-repo-a'
  "
  refute_output --regexp '^String$'
}

# ---------------------------------------------------------------------------
# Phase 92 TYPE-01: dispatcher wiring (extract_type_names routes to each extractor)
# ---------------------------------------------------------------------------

@test "extract_type_names: java dispatch produces non-empty output" {
  run bash -c "
    source '${DRIFT_TYPES}' --test-only 2>/dev/null || true
    extract_type_names '${FIXTURES}/java-types-repo-a' 'java'
  "
  assert_output --partial "User"
}

@test "extract_type_names: cs dispatch produces non-empty output" {
  run bash -c "
    source '${DRIFT_TYPES}' --test-only 2>/dev/null || true
    extract_type_names '${FIXTURES}/cs-types-repo-a' 'cs'
  "
  assert_output --partial "User"
}

@test "extract_type_names: rb dispatch produces non-empty output" {
  run bash -c "
    source '${DRIFT_TYPES}' --test-only 2>/dev/null || true
    extract_type_names '${FIXTURES}/rb-types-repo-a' 'rb'
  "
  assert_output --partial "User"
}
