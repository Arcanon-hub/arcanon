#!/usr/bin/env bats
# tests/verify.bats — Phase 112 (TRUST-01, TRUST-07, TRUST-08, TRUST-09).
#
# End-to-end coverage of /arcanon:verify driving the real shell wrapper, real
# worker HTTP endpoint, and real on-disk fixtures. Pairs with the in-process
# node tests in plugins/arcanon/worker/server/http.verify.test.js.
#
# Each test:
#   1. Builds a fresh project root in $BATS_TEST_TMPDIR with the three fixture
#      source files copied in at the relative paths recorded by the seeder.
#   2. Seeds a fresh SQLite DB at the path the worker computes from
#      sha256($PROJECT_ROOT)[0:12] under $ARCANON_DATA_DIR/projects/<hash>/.
#   3. Spawns the worker on port 37999 and waits for /api/readiness.
#   4. Drives `bash plugins/arcanon/scripts/hub.sh verify ...` and asserts on
#      exit code + output.
#   5. Tears down the worker cleanly.

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
HUB_SH="${REPO_ROOT}/plugins/arcanon/scripts/hub.sh"
WORKER_INDEX="${REPO_ROOT}/plugins/arcanon/worker/index.js"
SEED_SH="${REPO_ROOT}/plugins/arcanon/tests/fixtures/verify/seed.sh"
WORKER_PORT=37999

# ---------------------------------------------------------------------------
# Helpers (kept local to avoid editing tests/test_helper.bash; per Plan 02
# `done` checklist: ZERO additions to test_helper.bash).
# ---------------------------------------------------------------------------

# Compute sha256(input)[0:12] — matches plugins/arcanon/worker/db/pool.js's
# projectHashDir(). Must match exactly or the worker won't find the DB.
_arcanon_project_hash() {
  printf "%s" "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
}

# Spawn the worker pointed at $ARCANON_DATA_DIR on $WORKER_PORT and block
# until /api/readiness responds 200 (or 30 attempts × 0.2s = 6s elapse).
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
    # Wait briefly for graceful shutdown so the next test's spawn can bind 37999.
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
}

setup() {
  # Canonicalize via `pwd -P` so the hash matches what the worker computes
  # from process.cwd() — macOS symlinks /var/folders → /private/var/folders.
  mkdir -p "$BATS_TEST_TMPDIR/project"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR/project" && pwd -P)"
  ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"
  mkdir -p "$PROJECT_ROOT/tests/fixtures/verify/source" "$ARC_DATA_DIR"

  # Stage fixture source files in the project root so the relative
  # source_file paths the seeder records resolve correctly.
  cp "${REPO_ROOT}/plugins/arcanon/tests/fixtures/verify/source/"*.js \
     "$PROJECT_ROOT/tests/fixtures/verify/source/"

  # Compute worker DB path and seed. PROJECT_ROOT is already canonical so
  # sha256(PROJECT_ROOT) matches getQueryEngine(process.cwd()).
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  PROJECT_DB="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$PROJECT_DB" >/dev/null

  export ARCANON_DATA_DIR="$ARC_DATA_DIR"
  export ARCANON_WORKER_PORT="$WORKER_PORT"

  _start_worker
}

teardown() {
  _stop_worker
  # $BATS_TEST_TMPDIR is auto-cleaned by bats — no manual rm needed.
}

# ---------------------------------------------------------------------------
# TRUST-07: happy path — all three seeded connections verify ok.
# ---------------------------------------------------------------------------
@test "TRUST-07: all 3 connections verify ok when source files + evidence match" {
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" verify --json
  [ "$status" -eq 0 ]
  # All three verdicts present and equal to "ok".
  [ "$(echo "$output" | grep -c '"verdict": "ok"')" -eq 3 ]
  [[ "$output" != *'"verdict": "moved"'* ]]
  [[ "$output" != *'"verdict": "missing"'* ]]
  [[ "$output" != *'"verdict": "method_mismatch"'* ]]
}

# ---------------------------------------------------------------------------
# TRUST-08: a deleted source file flips that connection to "moved" and exit 1.
# Other two connections keep their "ok" verdicts.
# ---------------------------------------------------------------------------
@test "TRUST-08: deleting a source file produces verdict moved" {
  cd "$PROJECT_ROOT"
  rm "$PROJECT_ROOT/tests/fixtures/verify/source/users.js"
  run bash "$HUB_SH" verify --json
  [ "$status" -eq 1 ]
  [[ "$output" == *'"verdict": "moved"'* ]]
  [ "$(echo "$output" | grep -c '"verdict": "moved"')" -eq 1 ]
  [ "$(echo "$output" | grep -c '"verdict": "ok"')" -eq 2 ]
}

# ---------------------------------------------------------------------------
# TRUST-09: file kept but cited snippet removed → verdict "missing", exit 1.
# ---------------------------------------------------------------------------
@test "TRUST-09: overwriting cited line range produces verdict missing" {
  cd "$PROJECT_ROOT"
  cat > "$PROJECT_ROOT/tests/fixtures/verify/source/users.js" <<'EOF'
// file rewritten — evidence no longer present
const x = 1;
const y = 2;
EOF
  run bash "$HUB_SH" verify --json
  [ "$status" -eq 1 ]
  [[ "$output" == *'"verdict": "missing"'* ]]
  [ "$(echo "$output" | grep -c '"verdict": "missing"')" -eq 1 ]
  [ "$(echo "$output" | grep -c '"verdict": "ok"')" -eq 2 ]
}

# ---------------------------------------------------------------------------
# Edge — empty connections (no scan data) → exit 1 with friendly message.
# Per 112-01 SUMMARY exit-code matrix: empty result set maps to exit 1, not 0.
# ---------------------------------------------------------------------------
@test "edge: no connections — exit 1 with explanatory message (D-04)" {
  cd "$PROJECT_ROOT"
  sqlite3 "$PROJECT_DB" "DELETE FROM connections;"
  run bash "$HUB_SH" verify
  [ "$status" -eq 1 ]
  [[ "$output" == *"no connections found for the given scope"* ]]
}

# ---------------------------------------------------------------------------
# Edge — invalid --connection ID (non-integer) → exit 2 (invocation error).
# ---------------------------------------------------------------------------
@test "edge: invalid --connection rejects with exit 2 (D-04)" {
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" verify --connection abc
  [ "$status" -eq 2 ]
  [[ "$output" == *"--connection requires a positive integer"* ]]
}

# ---------------------------------------------------------------------------
# Edge — --source matching no connection → exit 1 (no rows).
# Surfaces the same "no connections found for the given scope" message used
# by the empty-DB path; the CLI cannot distinguish "no source match" from
# "no connections at all" without a server-side message split, which is
# explicitly out of scope for this plan.
# ---------------------------------------------------------------------------
@test "edge: --source matching nothing exits 1 with friendly message (D-06)" {
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" verify --source src/does/not/exist.ts
  [ "$status" -eq 1 ]
  [[ "$output" == *"no connections found for the given scope"* ]]
}

# ---------------------------------------------------------------------------
# Edge — --connection ID that exists nowhere → exit 1, server's 404 surfaced.
# ---------------------------------------------------------------------------
@test "edge: --connection 99999 (no row) exits 1 with 404 message (D-04 / 112-01)" {
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" verify --connection 99999
  [ "$status" -eq 1 ]
  [[ "$output" == *"no connection with id 99999"* ]]
}
