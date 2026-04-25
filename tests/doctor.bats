#!/usr/bin/env bats
# tests/doctor.bats — Phase 114-03 (NAV-03).
#
# End-to-end coverage of /arcanon:doctor. Drives the real shell wrapper, the
# real worker HTTP endpoint, and the real cmdDoctor handler against a seeded
# DB. Helpers are cloned verbatim from tests/list.bats:31-66 (which itself
# clones from tests/verify.bats); KEEP THEM IN SYNC if the worker spawn shape
# changes.
#
# Tests 1-5, 5b, 6  — Task 1 scaffold (this commit).
# Tests 7-11        — Task 2 (real checks 3, 4, 7, 8 + mock-hub).

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
HUB_SH="${REPO_ROOT}/plugins/arcanon/scripts/hub.sh"
WORKER_INDEX="${REPO_ROOT}/plugins/arcanon/worker/index.js"
WORKER_CLIENT_LIB="${REPO_ROOT}/plugins/arcanon/lib/worker-client.sh"
SEED_SH="${REPO_ROOT}/plugins/arcanon/tests/fixtures/doctor/seed.sh"
MOCK_HUB_JS="${REPO_ROOT}/plugins/arcanon/tests/fixtures/doctor/mock-hub.js"
WORKER_PORT=37997   # distinct from list.bats (37998) and verify.bats (37999)
MOCK_HUB_PORT=37996 # mock hub for Test 9 (Task 2)

# ---------------------------------------------------------------------------
# Helpers — kept local (no edits to tests/test_helper.bash). Cloned verbatim
# from tests/list.bats / verify.bats.
# ---------------------------------------------------------------------------

_arcanon_project_hash() {
  printf "%s" "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
}

_start_worker() {
  ARCANON_DATA_DIR="$ARC_DATA_DIR" \
    node "$WORKER_INDEX" --port "$WORKER_PORT" --data-dir "$ARC_DATA_DIR" \
      >"$BATS_TEST_TMPDIR/worker.log" 2>&1 &
  WORKER_PID=$!
  echo "$WORKER_PID" > "$BATS_TEST_TMPDIR/worker.pid"
  for _ in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${WORKER_PORT}/api/readiness" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  echo "worker failed to start; log:" >&2
  cat "$BATS_TEST_TMPDIR/worker.log" >&2 || true
  return 1
}

_stop_worker() {
  if [ -f "$BATS_TEST_TMPDIR/worker.pid" ]; then
    local pid
    pid="$(cat "$BATS_TEST_TMPDIR/worker.pid")"
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
}

_stop_mock_hub() {
  if [ -f "$BATS_TEST_TMPDIR/mock-hub.pid" ]; then
    kill "$(cat "$BATS_TEST_TMPDIR/mock-hub.pid")" 2>/dev/null || true
  fi
}

setup() {
  # Canonicalize via `pwd -P` so the hash matches what the worker computes
  # from process.cwd() — macOS symlinks /var/folders → /private/var/folders.
  mkdir -p "$BATS_TEST_TMPDIR/project"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR/project" && pwd -P)"
  ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"
  mkdir -p "$ARC_DATA_DIR"

  export ARCANON_DATA_DIR="$ARC_DATA_DIR"
  export ARCANON_WORKER_PORT="$WORKER_PORT"
  # Doctor check 8 reads ~/.arcanon/config.json for credentials. The auth
  # module is hard-coded to os.homedir() (not ARCANON_DATA_DIR), so we must
  # override HOME per-test to keep the user's real ~/.arcanon out of the
  # picture. Each test gets a clean creds-free $HOME by default; tests that
  # need creds (Task 2) write them under $HOME explicitly.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
}

teardown() {
  _stop_worker 2>/dev/null || true
  _stop_mock_hub 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Test 1 — all-pass scenario: 8 lines of `^\s*\d+\.\s+(PASS|WARN|FAIL|SKIP)`
# and exit 0. (Checks 3/4/7 are Task-1 stubs that emit WARN; check 8 SKIPs
# when no creds present. Healthy worker + healthy DB + writable data dir
# satisfy the critical checks.)
# ---------------------------------------------------------------------------
@test "NAV-03: doctor all-pass scenario emits 8 check lines and exits 0" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path"
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" doctor
  [ "$status" -eq 0 ]

  # 8 check lines, each beginning with `  N. STATUS  name detail`.
  local count
  count="$(echo "$output" | grep -cE '^[[:space:]]*[0-9]+\.[[:space:]]+(PASS|WARN|FAIL|SKIP)[[:space:]]+')"
  [ "$count" -eq 8 ]

  # Header + summary line present.
  echo "$output" | grep -q "Arcanon doctor"
  echo "$output" | grep -q "Summary:"
  echo "$output" | grep -q "exit 0"
}

# ---------------------------------------------------------------------------
# Test 2 — --json all-pass: structured JSON object with summary.exit_code=0.
# ---------------------------------------------------------------------------
@test "NAV-03: doctor --json emits structured object with 8 checks" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path"
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" doctor --json
  [ "$status" -eq 0 ]

  # Round-trip through jq to assert structural validity + key fields.
  echo "$output" | jq -e '.summary.exit_code == 0' >/dev/null
  echo "$output" | jq -e '(.checks | length) == 8' >/dev/null
  echo "$output" | jq -e '.version | type == "string"' >/dev/null
  echo "$output" | jq -e '.project_root | type == "string"' >/dev/null
  # Per-check shape: id, name, status, detail.
  echo "$output" | jq -e '[.checks[] | select(.id and .name and .status and .detail)] | length == 8' >/dev/null
  # Critical checks (1, 5, 6) must be PASS in this scenario.
  echo "$output" | jq -e '.checks[] | select(.id == 1) | .status == "PASS"' >/dev/null
  echo "$output" | jq -e '.checks[] | select(.id == 5) | .status == "PASS"' >/dev/null
  echo "$output" | jq -e '.checks[] | select(.id == 6) | .status == "PASS"' >/dev/null
}

# ---------------------------------------------------------------------------
# Test 3 — silent contract: in a non-Arcanon dir, exit 0 with empty stdout.
# Worker is intentionally NOT started.
# ---------------------------------------------------------------------------
@test "NAV-03: doctor silent in non-Arcanon directory" {
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" doctor
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Test 4 — critical FAIL → exit 1: chmod -w the data dir to break check 5.
# Worker still healthy, DB still healthy; only check 5 fails.
# ---------------------------------------------------------------------------
@test "NAV-03: doctor exits 1 when critical check 5 (data dir) FAILs" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path"
  _start_worker

  # Make the data dir read-only so the probe-file write fails. We must
  # restore perms in cleanup or bats can't rm -rf $BATS_TEST_TMPDIR.
  chmod -w "$ARC_DATA_DIR"

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" doctor
  local rc=$status

  # Restore perms unconditionally so teardown's _stop_worker can write its
  # log files and bats can rm the tmpdir.
  chmod +w "$ARC_DATA_DIR"

  [ "$rc" -eq 1 ]
  # Check 5 (data_dir_writable) line must say FAIL.
  echo "$output" | grep -E '^[[:space:]]*5\.[[:space:]]+FAIL[[:space:]]+data_dir_writable'
  # Summary must say exit 1.
  echo "$output" | grep -q "exit 1"
}

# ---------------------------------------------------------------------------
# Test 5 — hub creds SKIP: no ~/.arcanon/config.json file at all → check 8
# reports SKIP (not WARN, not FAIL); overall exit code 0.
# ---------------------------------------------------------------------------
@test "NAV-03: doctor reports SKIP for check 8 when no credentials" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path"
  _start_worker

  # Setup() already isolated $HOME to a creds-free dir. Belt-and-suspenders:
  # also unset the env-var creds path.
  unset ARCANON_API_KEY
  unset ARCANON_API_TOKEN

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" doctor --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.checks[] | select(.id == 8) | .status == "SKIP"' >/dev/null
  echo "$output" | jq -e '.summary.exit_code == 0' >/dev/null
}

# ---------------------------------------------------------------------------
# Test 5b (FLAG 7) — worker-unreachable FAIL: seed healthy DB, do NOT start
# the worker, call hub.sh doctor directly (bypass markdown wrapper which
# would auto-start). Check 1 must FAIL with detail starting `worker
# unreachable:` and exit code 1.
# ---------------------------------------------------------------------------
@test "NAV-03: doctor reports check 1 FAIL + exit 1 when worker unreachable" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path"
  # Intentionally do NOT call _start_worker.

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" doctor --json
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.checks[] | select(.id == 1) | .status == "FAIL"' >/dev/null
  # Detail must mention "worker unreachable".
  echo "$output" | jq -e '.checks[] | select(.id == 1) | .detail | startswith("worker unreachable:")' >/dev/null
  echo "$output" | jq -e '.summary.exit_code == 1' >/dev/null
}

# ---------------------------------------------------------------------------
# Test 6 — surface: doctor.md exists with correct frontmatter. (The
# commands-surface.bats NAV-03 block already asserts this; we duplicate the
# check here so a developer running just `bats tests/doctor.bats` catches
# missing-file issues without needing the surface suite.)
# ---------------------------------------------------------------------------
@test "NAV-03: commands/doctor.md exists with frontmatter" {
  [ -f "${REPO_ROOT}/plugins/arcanon/commands/doctor.md" ]
  grep -E '^description:' "${REPO_ROOT}/plugins/arcanon/commands/doctor.md"
  grep -E '^allowed-tools:' "${REPO_ROOT}/plugins/arcanon/commands/doctor.md"
  grep -q 'Bash' "${REPO_ROOT}/plugins/arcanon/commands/doctor.md"
}
