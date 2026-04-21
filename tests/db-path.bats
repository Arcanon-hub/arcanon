#!/usr/bin/env bats
# tests/db-path.bats — HOK-12 parity tests for lib/db-path.sh vs worker/db/pool.js
#
# Verifies that the bash hash algorithm in db-path.sh produces identical output
# to the JS algorithm in worker/db/pool.js projectHashDir():
#   crypto.createHash("sha256").update(projectRoot).digest("hex").slice(0,12)
#
# Run: tests/bats/bin/bats tests/db-path.bats

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  HELPER="${BATS_TEST_DIRNAME}/../plugins/arcanon/lib/db-path.sh"
}

# ---------------------------------------------------------------------------
# Test 1: hash for /tmp/demo matches JS output byte-for-byte
# ---------------------------------------------------------------------------
@test "db-path.sh - hash matches JS for /tmp/demo" {
  local root="/tmp/demo"
  local js_hash
  js_hash=$(node -e "console.log(require('crypto').createHash('sha256').update('$root').digest('hex').slice(0,12))")
  run bash -c "source '$HELPER' && resolve_project_db_hash '$root'"
  assert_success
  assert_output "$js_hash"
}

# ---------------------------------------------------------------------------
# Test 2: resolve_project_db_path returns full path with default data dir
# ---------------------------------------------------------------------------
@test "db-path.sh - resolve_project_db_path returns expected DB path" {
  local root="/tmp/demo"
  local js_hash
  js_hash=$(node -e "console.log(require('crypto').createHash('sha256').update('$root').digest('hex').slice(0,12))")
  run bash -c "source '$HELPER' && resolve_project_db_path '$root'"
  assert_success
  assert_output "$HOME/.arcanon/projects/$js_hash/impact-map.db"
}

# ---------------------------------------------------------------------------
# Test 3: ARCANON_DATA_DIR override changes the returned path prefix
# ---------------------------------------------------------------------------
@test "db-path.sh - honors ARCANON_DATA_DIR override" {
  local root="/tmp/demo"
  local js_hash
  js_hash=$(node -e "console.log(require('crypto').createHash('sha256').update('$root').digest('hex').slice(0,12))")
  run bash -c "export ARCANON_DATA_DIR=/tmp/custom-arcanon && source '$HELPER' && resolve_project_db_path '$root'"
  assert_success
  assert_output "/tmp/custom-arcanon/projects/$js_hash/impact-map.db"
}

# ---------------------------------------------------------------------------
# Test 4: direct execution refuses with error and exits 1
# Mirrors worker-client.sh line 7 source-guard pattern.
# ---------------------------------------------------------------------------
@test "db-path.sh - direct execution refuses with error" {
  run bash "$HELPER"
  assert_failure
  assert_output --partial "Source this file"
}

# ---------------------------------------------------------------------------
# Test 5: parity for 3 sample project roots (including path with spaces)
# ---------------------------------------------------------------------------
@test "db-path.sh - parity for 3 sample project roots" {
  for root in "/tmp/demo" "/home/user/repo" "/path/with spaces/and-dashes"; do
    local js_hash
    js_hash=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex').slice(0,12))" "$root")
    run bash -c "source '$HELPER' && resolve_project_db_hash \"\$1\"" _ "$root"
    assert_success
    assert_output "$js_hash"
  done
}
