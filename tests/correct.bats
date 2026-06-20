#!/usr/bin/env bats
# tests/correct.bats —  ( /).
#
# End-to-end coverage of /arcanon:correct driving the real shell wrapper.
# cmdCorrect opens the DB directly via better-sqlite3 + uses 's
# QueryEngine.upsertOverride helper — no worker spawn needed.
#
# Each case asserts the override row goes IN. The apply path is 's
# territory (covered by tests/scan-overrides-apply.bats).
#
# Tests:
#   1 — silent in non-Arcanon directory (no impact-map.db)
#   2 — connection|delete inserts row with payload {} and target_id
#   3 — connection|update inserts row with payload {source, target}
#   4 — service|rename inserts row with payload {new_name} and resolved target_id
#   5 — service|set-base-path inserts row with payload {base_path}
#   6 — invalid kind exits 2
#   7 — kind/action mismatch exits 2
#   8 — non-existent connection ID exits 2
#   9 — service name not found exits 2
#  10 — --json emits structured object
#  11 — created_by column is 'cli' (distinguishes operator from system)

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
HUB_SH="${REPO_ROOT}/plugins/arcanon/scripts/hub.sh"
SEED_SH="${REPO_ROOT}/plugins/arcanon/tests/fixtures/correct/seed.sh"

# Compute sha256(input)[0:12] — matches projectHashDir() in worker/db/pool.js.
_arcanon_project_hash() {
  printf "%s" "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
}

setup() {
  mkdir -p "$BATS_TEST_TMPDIR/project"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR/project" && pwd -P)"
  ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"
  mkdir -p "$ARC_DATA_DIR"
  HASH="$(_arcanon_project_hash "$PROJECT_ROOT")"
  DB_PATH="$ARC_DATA_DIR/projects/$HASH/impact-map.db"

  export ARCANON_DATA_DIR="$ARC_DATA_DIR"
}

# ---------------------------------------------------------------------------
# Test 1 — silent in non-Arcanon directory.
# ---------------------------------------------------------------------------
@test "correct silent in non-Arcanon directory" {
  cd "$PROJECT_ROOT"
  # No DB created — cmdCorrect should exit 0 silently.
  run bash "$HUB_SH" correct connection --action delete --connection 1
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Test 2 — connection|delete happy path.
# ---------------------------------------------------------------------------
@test "correct connection --action delete inserts row" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH" >/dev/null
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" correct connection --action delete --connection 1
  [ "$status" -eq 0 ]
  [[ "$output" == *"override_id=1"* ]]
  [[ "$output" == *"action=delete"* ]]

  run sqlite3 -line "$DB_PATH" "SELECT kind, target_id, action, payload FROM scan_overrides WHERE override_id = 1"
  [ "$status" -eq 0 ]
  # sqlite3 -line separator differs by CLI version (older builds use " = ",
  # Apple sqlite3 3.54.0+ uses ": "); accept either via regex.
  [[ "$output" =~ kind[[:space:]]*[=:][[:space:]]*connection ]]
  [[ "$output" =~ target_id[[:space:]]*[=:][[:space:]]*1 ]]
  [[ "$output" =~ action[[:space:]]*[=:][[:space:]]*delete ]]
  # 's helper defaults payload to '{}' when caller passes null/undefined.
  [[ "$output" =~ payload[[:space:]]*[=:][[:space:]]*\{\} ]]
}

# ---------------------------------------------------------------------------
# Test 3 — connection|update happy path with --source/--target payload.
# ---------------------------------------------------------------------------
@test "correct connection --action update inserts row with source/target payload" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH" >/dev/null
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" correct connection --action update --connection 1 --source svc-a --target svc-b
  [ "$status" -eq 0 ]
  [[ "$output" == *"action=update"* ]]

  run sqlite3 "$DB_PATH" "SELECT payload FROM scan_overrides WHERE override_id = 1"
  [ "$status" -eq 0 ]
  if command -v jq >/dev/null 2>&1; then
    src="$(echo "$output" | jq -r .source)"
    tgt="$(echo "$output" | jq -r .target)"
    [ "$src" = "svc-a" ]
    [ "$tgt" = "svc-b" ]
  else
    [[ "$output" == *'"source":"svc-a"'* ]]
    [[ "$output" == *'"target":"svc-b"'* ]]
  fi
}

# ---------------------------------------------------------------------------
# Test 4 — service|rename happy path; service name resolved to integer ID.
# ---------------------------------------------------------------------------
@test "correct service --action rename inserts row with resolved target_id" {
  SEED_OUT="$(bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH")"
  # seed.js prints {"repoId":..,"svcAId":..} — capture svc-a's ID.
  SVC_A_ID="$(echo "$SEED_OUT" | sed -nE 's/.*"svcAId":([0-9]+).*/\1/p')"
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" correct service --action rename --service svc-a --new-name svc-renamed
  [ "$status" -eq 0 ]
  [[ "$output" == *"action=rename"* ]]
  [[ "$output" == *"target_id=${SVC_A_ID}"* ]]

  run sqlite3 -line "$DB_PATH" "SELECT kind, target_id, action, payload FROM scan_overrides WHERE override_id = 1"
  [ "$status" -eq 0 ]
  # sqlite3 -line separator differs by CLI version (" = " vs ": "); accept either.
  [[ "$output" =~ kind[[:space:]]*[=:][[:space:]]*service ]]
  [[ "$output" =~ target_id[[:space:]]*[=:][[:space:]]*${SVC_A_ID} ]]
  [[ "$output" =~ action[[:space:]]*[=:][[:space:]]*rename ]]
  [[ "$output" == *'"new_name":"svc-renamed"'* ]]
}

# ---------------------------------------------------------------------------
# Test 5 — service|set-base-path happy path.
# ---------------------------------------------------------------------------
@test "correct service --action set-base-path inserts row" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH" >/dev/null
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" correct service --action set-base-path --service svc-a --base-path src/api
  [ "$status" -eq 0 ]
  [[ "$output" == *"action=set-base-path"* ]]

  run sqlite3 "$DB_PATH" "SELECT payload FROM scan_overrides WHERE override_id = 1"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"base_path":"src/api"'* ]]
}

# ---------------------------------------------------------------------------
# Test 6 — invalid kind exits 2 with friendly error.
# ---------------------------------------------------------------------------
@test "correct with invalid kind exits 2" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH" >/dev/null
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" correct foo --action delete --connection 1
  [ "$status" -eq 2 ]
  [[ "$output" == *"kind 'foo'"* ]]
}

# ---------------------------------------------------------------------------
# Test 7 — kind/action mismatch (connection|rename) exits 2.
# ---------------------------------------------------------------------------
@test "correct with kind/action mismatch exits 2" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH" >/dev/null
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" correct connection --action rename --connection 1
  [ "$status" -eq 2 ]
  [[ "$output" == *"'rename'"* ]]
  [[ "$output" == *"'service'"* ]]
}

# ---------------------------------------------------------------------------
# Test 8 — non-existent connection ID exits 2.
# ---------------------------------------------------------------------------
@test "correct with non-existent connection exits 2" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH" >/dev/null
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" correct connection --action delete --connection 999999
  [ "$status" -eq 2 ]
  [[ "$output" == *"connection ID 999999 not found"* ]]
}

# ---------------------------------------------------------------------------
# Test 9 — service name not found exits 2.
# ---------------------------------------------------------------------------
@test "correct with unknown service name exits 2" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH" >/dev/null
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" correct service --action rename --service nonexistent --new-name x
  [ "$status" -eq 2 ]
  [[ "$output" == *"nonexistent"* ]]
  [[ "$output" == *"not found"* ]]
}

# ---------------------------------------------------------------------------
# Test 10 — --json emits structured object.
# ---------------------------------------------------------------------------
@test "correct --json emits structured object" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH" >/dev/null
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" correct connection --action delete --connection 1 --json
  [ "$status" -eq 0 ]
  if command -v jq >/dev/null 2>&1; then
    echo "$output" | jq -e '.ok == true and .kind == "connection" and .action == "delete" and .target_id == 1 and .override_id == 1'
  else
    [[ "$output" == *'"ok": true'* ]]
    [[ "$output" == *'"kind": "connection"'* ]]
    [[ "$output" == *'"override_id": 1'* ]]
  fi
}

# ---------------------------------------------------------------------------
# Test 11 — created_by column is 'cli'. Distinguishes operator-staged
# overrides (this command) from system-generated rows (default 'system').
# ---------------------------------------------------------------------------
@test "correct stamps created_by='cli'" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$DB_PATH" >/dev/null
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" correct connection --action delete --connection 1
  [ "$status" -eq 0 ]
  run sqlite3 "$DB_PATH" "SELECT created_by FROM scan_overrides WHERE override_id = 1"
  [ "$status" -eq 0 ]
  [ "$output" = "cli" ]
}
