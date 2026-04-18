#!/usr/bin/env bats
# Arcanon — siblings.bats
# Tests: TEST-06 (linked repo discovery library)
# Covers: list_linked_repos / list_siblings (backward compat) from lib/linked-repos.sh

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
# list_linked_repos — basic discovery (TEST-06)
# ---------------------------------------------------------------------------

@test "siblings.sh - discovers sibling repos from parent dir" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/repo-a/.git"
  mkdir -p "${PARENT}/repo-b/.git"
  mkdir -p "${PARENT}/not-a-repo"  # no .git — should be excluded
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/linked-repos.sh"
  run list_linked_repos "${PARENT}/repo-a"
  assert_success
  assert_output --partial "repo-b"
  refute_output --partial "not-a-repo"
}

@test "siblings.sh - excludes the current repo from results" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/repo-a/.git"
  mkdir -p "${PARENT}/repo-b/.git"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/linked-repos.sh"
  # Calling from repo-a: repo-a must not appear in output
  run list_linked_repos "${PARENT}/repo-a"
  assert_success
  refute_output --partial "repo-a"
}

@test "siblings.sh - returns empty when no siblings exist" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/only-repo/.git"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/linked-repos.sh"
  run list_linked_repos "${PARENT}/only-repo"
  assert_success
  assert_output ""
}

@test "siblings.sh - handles parent dir with no git repos (empty dir)" {
  local PARENT="${FIXTURES_DIR}/empty-workspace"
  mkdir -p "${PARENT}/not-a-repo"   # only non-git directory
  mkdir -p "${PARENT}/calling-dir"  # the "current repo" with no .git
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/linked-repos.sh"
  run list_linked_repos "${PARENT}/calling-dir"
  # Must not crash — exit 0 with no output
  assert_success
  assert_output ""
}

@test "siblings.sh - discovers multiple siblings" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/repo-a/.git"
  mkdir -p "${PARENT}/repo-b/.git"
  mkdir -p "${PARENT}/repo-c/.git"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/linked-repos.sh"
  run list_linked_repos "${PARENT}/repo-a"
  assert_success
  assert_output --partial "repo-b"
  assert_output --partial "repo-c"
  refute_output --partial "repo-a"
}

@test "siblings.sh - list_siblings is the primary function (alias test)" {
  # list_siblings is a backward-compat alias for list_linked_repos
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/src-repo/.git"
  mkdir -p "${PARENT}/another-repo/.git"
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/linked-repos.sh"
  run list_siblings "${PARENT}/src-repo"
  assert_success
  assert_output --partial "another-repo"
  refute_output --partial "src-repo"
}

# ---------------------------------------------------------------------------
# arcanon.config.json override (TEST-06 config path)
# ---------------------------------------------------------------------------

@test "siblings.sh - uses arcanon.config.json linked-repos list when present" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/my-repo/.git"
  mkdir -p "${PARENT}/configured-sibling"
  # Write a config file that specifies a linked repo via explicit path
  cat > "${PARENT}/my-repo/arcanon.config.json" << EOF
{
  "linked-repos": [
    "${PARENT}/configured-sibling"
  ]
}
EOF
  source "${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/linked-repos.sh"
  run list_linked_repos "${PARENT}/my-repo"
  assert_success
  assert_output --partial "configured-sibling"
}
