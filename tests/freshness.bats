#!/usr/bin/env bats
# tests/freshness.bats — Phase 116-02 (FRESH-01..05).
#
# End-to-end coverage of /arcanon:status freshness extension. Drives the real
# shell wrapper, the real worker on a temp port, and a real on-disk fixture
# (a fresh git repo with 4 commits + a seeded DB pointing at the init SHA).
#
# Pairs with the in-process node tests in
# plugins/arcanon/worker/server/http.scan-freshness.test.js.
#
# Each test:
#   1. Builds a fresh project root in $BATS_TEST_TMPDIR.
#   2. Runs the freshness fixture seeder (creates <root>/repo-a/ git repo +
#      seeds the SQLite DB at the path the worker computes).
#   3. Spawns the worker on port 37999 and waits for /api/readiness.
#   4. Drives `bash plugins/arcanon/scripts/hub.sh status` and asserts on the
#      output, OR curls the new /api/scan-freshness endpoint directly.
#   5. Tears down the worker cleanly.

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
HUB_SH="${REPO_ROOT}/plugins/arcanon/scripts/hub.sh"
WORKER_INDEX="${REPO_ROOT}/plugins/arcanon/worker/index.js"
SEED_SH="${REPO_ROOT}/plugins/arcanon/tests/fixtures/freshness/seed.sh"
WORKER_PORT=37999

# ---------------------------------------------------------------------------
# Helpers (kept local — no edits to test_helper.bash, mirrors verify.bats).
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

setup() {
  # Canonicalize via `pwd -P` so the hash matches process.cwd() on macOS
  # (symlinks /var/folders → /private/var/folders).
  mkdir -p "$BATS_TEST_TMPDIR/project"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR/project" && pwd -P)"
  ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"
  mkdir -p "$ARC_DATA_DIR"

  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  PROJECT_DB="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  # Seeder echoes INIT_SHA on its last stdout line.
  INIT_SHA="$(bash "$SEED_SH" "$PROJECT_ROOT" "$PROJECT_DB" | tail -n1)"

  export ARCANON_DATA_DIR="$ARC_DATA_DIR"
  export ARCANON_WORKER_PORT="$WORKER_PORT"

  _start_worker
}

teardown() {
  _stop_worker
}

# ---------------------------------------------------------------------------
# FRESH-03: endpoint shape — 200 with documented JSON; 3 new commits in repo-a.
# ---------------------------------------------------------------------------
@test "FRESH-03: GET /api/scan-freshness returns documented shape with new_commits=3" {
  cd "$PROJECT_ROOT"
  PORT="$WORKER_PORT"
  run curl -sf "http://127.0.0.1:${PORT}/api/scan-freshness?project=${PROJECT_ROOT}"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.last_scan_iso != null' >/dev/null
  echo "$output" | jq -e '.scan_quality_pct == 87' >/dev/null
  echo "$output" | jq -e '(.repos | length) == 1' >/dev/null
  echo "$output" | jq -e '.repos[0].name == "repo-a"' >/dev/null
  echo "$output" | jq -e '.repos[0].new_commits == 3' >/dev/null
}

# ---------------------------------------------------------------------------
# FRESH-01: status output contains the "Latest scan:" date + percent line.
# ---------------------------------------------------------------------------
@test "FRESH-01: /arcanon:status output contains 'Latest scan:' line with date + percentage" {
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" status
  [ "$status" -eq 0 ]
  [[ "$output" == *"Latest scan:"* ]]
  [[ "$output" == *"high-confidence"* ]]
}

# ---------------------------------------------------------------------------
# FRESH-02: status output reports 1 repo has 3 new commits in repo-a.
# Asserts the singular grammar ("1 repo has", not "1 repos have").
# ---------------------------------------------------------------------------
@test "FRESH-02: /arcanon:status output reports 1 repo has 3 new commits in repo-a" {
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" status
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 repo has new commits since last scan"* ]]
  [[ "$output" == *"repo-a (3 new)"* ]]
}

# ---------------------------------------------------------------------------
# FRESH-02: when no repo has drift, the freshness line is suppressed entirely.
# Proves the `drifted.length > 0` filter in _fetchScanFreshness works.
# ---------------------------------------------------------------------------
@test "FRESH-02: when no new commits exist, the freshness line is suppressed" {
  cd "$PROJECT_ROOT"
  CURRENT_HEAD=$(git -C "$PROJECT_ROOT/repo-a" rev-parse HEAD)
  sqlite3 "$PROJECT_DB" "UPDATE repo_state SET last_scanned_commit='$CURRENT_HEAD'"
  run bash "$HUB_SH" status
  [ "$status" -eq 0 ]
  [[ "$output" == *"Latest scan:"* ]]
  [[ "$output" != *"new commits since last scan"* ]]
}

# ---------------------------------------------------------------------------
# FRESH-04 back-compat: /api/scan-quality endpoint still works untouched.
# ---------------------------------------------------------------------------
@test "FRESH-04: /api/scan-quality endpoint still works (back-compat)" {
  PORT="$WORKER_PORT"
  run curl -sf "http://127.0.0.1:${PORT}/api/scan-quality?project=${PROJECT_ROOT}"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.quality_score != null' >/dev/null
  echo "$output" | jq -e '.scan_version_id != null' >/dev/null
}
