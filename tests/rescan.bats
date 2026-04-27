#!/usr/bin/env bats
# tests/rescan.bats — Phase 118-02 (CORRECT-04, CORRECT-05).
#
# End-to-end coverage of /arcanon:rescan driving the real shell wrapper, real
# worker HTTP endpoint with a stub agent runner, and real on-disk fixtures.
# Pairs with the in-process node tests in plugins/arcanon/worker/lib/repo-resolver.test.js.
#
# Each test:
#   1. Builds a fresh project root in $BATS_TEST_TMPDIR with two real git
#      repos (repo-a, repo-b) staged via the rescan/seed.sh fixture.
#   2. Seeds a fresh SQLite DB at the path the worker computes from
#      sha256($PROJECT_ROOT)[0:12] under $ARCANON_DATA_DIR/projects/<hash>/.
#   3. Spawns the worker on port 37996 with ARCANON_TEST_AGENT_RUNNER=1 so
#      the worker installs a stub agent runner (returns valid empty scan
#      JSON) and POST /api/rescan can run scanRepos end-to-end.
#   4. Drives `bash plugins/arcanon/scripts/hub.sh rescan ...` and asserts
#      on exit code, output, AND the resulting scan_versions rows.
#   5. Tears down the worker cleanly.
#
# Cases:
#   1 — silent in non-Arcanon directory (no impact-map.db) → exit 0, empty
#   2 — happy path by name: rescan repo-a → exit 0, NEW scan_versions row
#       for repo-a only (repo-b's count unchanged)
#   3 — happy path by absolute path: rescan /abs/path/to/repo-a — same
#   4 — repo not found exits 2 with friendly listing
#   5 — worker down exits 1 with friendly message
#
# Fixture: plugins/arcanon/tests/fixtures/rescan/{seed.sh,seed.js}
# Port: 37996 (verify=37999, list=37998, correct=N/A direct DB access)

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
HUB_SH="${REPO_ROOT}/plugins/arcanon/scripts/hub.sh"
WORKER_INDEX="${REPO_ROOT}/plugins/arcanon/worker/index.js"
SEED_SH="${REPO_ROOT}/plugins/arcanon/tests/fixtures/rescan/seed.sh"
WORKER_PORT=37996

# ---------------------------------------------------------------------------
# Helpers (kept local — ZERO additions to test_helper.bash, mirrors verify.bats)
# ---------------------------------------------------------------------------

# Compute sha256(input)[0:12] — matches plugins/arcanon/worker/db/pool.js's
# projectHashDir(). Must match exactly or the worker won't find the DB.
_arcanon_project_hash() {
  printf "%s" "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
}

# Spawn the worker with the test agent runner stub installed. Blocks until
# /api/readiness responds 200 (or 30 attempts × 0.2s = 6s elapse).
_start_worker() {
  ARCANON_DATA_DIR="$ARC_DATA_DIR" \
  ARCANON_TEST_AGENT_RUNNER=1 \
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
      sleep 0.2
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
}

setup() {
  # Canonicalize via `pwd -P` so the hash matches what the worker computes
  # from process.cwd() (macOS symlinks /var/folders → /private/var/folders).
  mkdir -p "$BATS_TEST_TMPDIR/project"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR/project" && pwd -P)"
  ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"
  mkdir -p "$ARC_DATA_DIR"
  HASH="$(_arcanon_project_hash "$PROJECT_ROOT")"
  PROJECT_DB="$ARC_DATA_DIR/projects/$HASH/impact-map.db"

  export ARCANON_DATA_DIR="$ARC_DATA_DIR"
  export ARCANON_WORKER_PORT="$WORKER_PORT"
}

teardown() {
  _stop_worker
}

# ---------------------------------------------------------------------------
# Test 1 — silent in non-Arcanon directory.
# ---------------------------------------------------------------------------
@test "CORRECT-04: rescan silent in non-Arcanon directory" {
  cd "$PROJECT_ROOT"
  # No DB created — cmdRescan should exit 0 silently.
  run bash "$HUB_SH" rescan repo-a
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Test 2 — happy path by name. Asserts the new scan_versions row is for
# repo-a only; repo-b's scan_versions count is unchanged.
# ---------------------------------------------------------------------------
@test "CORRECT-04: rescan <name> creates new scan_versions row for that repo only" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$PROJECT_DB" >"$BATS_TEST_TMPDIR/seed.json"
  REPO_A_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$BATS_TEST_TMPDIR/seed.json','utf8')).repos['repo-a'].repo_id)")
  REPO_B_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$BATS_TEST_TMPDIR/seed.json','utf8')).repos['repo-b'].repo_id)")

  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" rescan repo-a
  [ "$status" -eq 0 ]
  [[ "$output" == *"Rescanned: repo-a"* ]]
  [[ "$output" == *"Mode: full"* ]]

  # New scan_versions row for repo-a only (was 1 from seed → ≥2 after rescan).
  run sqlite3 "$PROJECT_DB" "SELECT COUNT(*) FROM scan_versions WHERE repo_id = $REPO_A_ID"
  [ "$status" -eq 0 ]
  [ "$output" -ge 2 ]

  # repo-b is byte-identical: still exactly 1 row.
  run sqlite3 "$PROJECT_DB" "SELECT COUNT(*) FROM scan_versions WHERE repo_id = $REPO_B_ID"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

# ---------------------------------------------------------------------------
# Test 3 — happy path by absolute path. Same scan_versions assertions.
# ---------------------------------------------------------------------------
@test "CORRECT-05: rescan <abs-path> resolves via path lookup" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$PROJECT_DB" >"$BATS_TEST_TMPDIR/seed.json"
  REPO_A_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$BATS_TEST_TMPDIR/seed.json','utf8')).repos['repo-a'].repo_id)")
  REPO_B_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$BATS_TEST_TMPDIR/seed.json','utf8')).repos['repo-b'].repo_id)")

  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" rescan "$PROJECT_ROOT/repo-a"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Rescanned: repo-a"* ]]

  run sqlite3 "$PROJECT_DB" "SELECT COUNT(*) FROM scan_versions WHERE repo_id = $REPO_A_ID"
  [ "$status" -eq 0 ]
  [ "$output" -ge 2 ]

  # repo-b untouched.
  run sqlite3 "$PROJECT_DB" "SELECT COUNT(*) FROM scan_versions WHERE repo_id = $REPO_B_ID"
  [ "$status" -eq 0 ]
  [ "$output" -eq 1 ]
}

# ---------------------------------------------------------------------------
# Test 4 — nonexistent repo exits 2 with friendly listing of available repos.
# ---------------------------------------------------------------------------
@test "CORRECT-05: rescan <nonexistent> exits 2 with available-repos list" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$PROJECT_DB" >/dev/null

  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" rescan totally-not-a-repo
  [ "$status" -eq 2 ]
  # Listing must include both seeded repos so the operator can pick.
  [[ "$output" == *"not found"* ]] || [[ "$stderr" == *"not found"* ]]
  [[ "$output" == *"repo-a"* ]] || [[ "$stderr" == *"repo-a"* ]]
  [[ "$output" == *"repo-b"* ]] || [[ "$stderr" == *"repo-b"* ]]
}

# ---------------------------------------------------------------------------
# Test 5 — worker down. The seeded DB exists (so cmdRescan does not silent-
# exit 0); without a worker, the fetch fails → friendly "worker not running".
# ---------------------------------------------------------------------------
@test "CORRECT-04: rescan exits 1 with friendly message when worker is down" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$PROJECT_DB" >/dev/null
  # Do NOT spawn the worker.

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" rescan repo-a
  [ "$status" -eq 1 ]
  # bats merges stderr+stdout into $output by default for `run`.
  [[ "$output" == *"worker not running"* ]]
}
