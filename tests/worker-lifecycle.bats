#!/usr/bin/env bats
# tests/worker-lifecycle.bats — Worker lifecycle (Phase 15: WRKR-01 through WRKR-07)
# Covers all 7 WRKR acceptance criteria using ARCANON_DATA_DIR temp-dir isolation.

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"

setup() {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  # Use an ephemeral port to avoid conflicts
  export ARCANON_WORKER_PORT="37999"
}

teardown() {
  # Kill any test worker that might still be running
  if [[ -f "${ARCANON_DATA_DIR}/worker.pid" ]]; then
    local pid; pid=$(cat "${ARCANON_DATA_DIR}/worker.pid")
    kill "$pid" 2>/dev/null || true
    sleep 0.3
  fi
  rm -rf "$ARCANON_DATA_DIR"
}

# ---------------------------------------------------------------------------
# WRKR-01 + WRKR-02: worker-start.sh writes PID and port files
# ---------------------------------------------------------------------------
@test "WRKR-01 + WRKR-02: worker-start.sh writes PID and port files" {
  run bash "$PLUGIN_ROOT/scripts/worker-start.sh"
  assert_success

  # PID file must exist and contain a number
  [[ -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "PID file missing"; return 1; }
  local pid; pid=$(cat "${ARCANON_DATA_DIR}/worker.pid")
  [[ "$pid" =~ ^[0-9]+$ ]] || { echo "PID file does not contain a number: $pid"; return 1; }

  # Port file must exist and contain the expected port
  [[ -f "${ARCANON_DATA_DIR}/worker.port" ]] || { echo "port file missing"; return 1; }
  local port; port=$(cat "${ARCANON_DATA_DIR}/worker.port")
  [[ "$port" == "37999" ]] || { echo "port file contains unexpected value: $port"; return 1; }

  # Wait for readiness using worker-client.sh
  # shellcheck source=lib/worker-client.sh
  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  # Confirm /api/readiness returns 200
  run curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:37999/api/readiness"
  assert_output "200"

  bash "$PLUGIN_ROOT/scripts/worker-stop.sh"
}

# ---------------------------------------------------------------------------
# WRKR-05: duplicate start is prevented
# ---------------------------------------------------------------------------
@test "WRKR-05: duplicate start is prevented" {
  bash "$PLUGIN_ROOT/scripts/worker-start.sh" >/dev/null 2>&1
  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  # Second start attempt
  run bash "$PLUGIN_ROOT/scripts/worker-start.sh"
  assert_success
  assert_output --partial "already running"

  # Only one instance should have that PID
  local pid; pid=$(cat "${ARCANON_DATA_DIR}/worker.pid")
  local count; count=$(pgrep -f "worker/index.js" | wc -l | tr -d ' ')
  [[ "$count" -ge "1" ]] || { echo "No worker process found"; return 1; }

  bash "$PLUGIN_ROOT/scripts/worker-stop.sh"
}

# ---------------------------------------------------------------------------
# WRKR-05 (stale PID): stale PID file is cleared before spawn
# ---------------------------------------------------------------------------
@test "WRKR-05 (stale PID): stale PID file is cleared before spawn" {
  # Write a fake (non-existent) PID
  mkdir -p "${ARCANON_DATA_DIR}"
  echo "99999" > "${ARCANON_DATA_DIR}/worker.pid"

  run bash "$PLUGIN_ROOT/scripts/worker-start.sh"
  assert_success

  # Output should mention "stale"
  assert_output --partial "stale"

  # PID file should NOT contain the fake PID anymore
  local new_pid; new_pid=$(cat "${ARCANON_DATA_DIR}/worker.pid" 2>/dev/null || echo "")
  [[ "$new_pid" != "99999" ]] || { echo "PID file still contains stale PID 99999"; return 1; }
  [[ "$new_pid" =~ ^[0-9]+$ ]] || { echo "New PID not numeric: $new_pid"; return 1; }

  bash "$PLUGIN_ROOT/scripts/worker-stop.sh"
}

# ---------------------------------------------------------------------------
# WRKR-04: wait_for_worker() times out when no worker
# ---------------------------------------------------------------------------
@test "WRKR-04: wait_for_worker() times out when no worker is running" {
  source "$PLUGIN_ROOT/lib/worker-client.sh"

  # 3 attempts × 100ms = 300ms total — fast timeout
  run wait_for_worker 3 100
  assert_failure

  # Stderr should mention "timed out"
  [[ "$output" == *"timed out"* ]] || { echo "Expected 'timed out' in output; got: $output"; return 1; }
}

# ---------------------------------------------------------------------------
# WRKR-03 + WRKR-01: worker-stop.sh sends SIGTERM and cleans up files
# ---------------------------------------------------------------------------
@test "WRKR-03 + WRKR-01: worker-stop.sh sends SIGTERM and cleans up files" {
  bash "$PLUGIN_ROOT/scripts/worker-start.sh" >/dev/null 2>&1
  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  run bash "$PLUGIN_ROOT/scripts/worker-stop.sh"
  assert_success

  # Give the worker a moment to finish cleanup
  sleep 0.5

  [[ ! -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "PID file still exists after stop"; return 1; }
  [[ ! -f "${ARCANON_DATA_DIR}/worker.port" ]] || { echo "port file still exists after stop"; return 1; }
}

# ---------------------------------------------------------------------------
# WRKR-04: /api/readiness returns 200 after startup
# ---------------------------------------------------------------------------
@test "WRKR-04: /api/readiness returns 200 after startup" {
  bash "$PLUGIN_ROOT/scripts/worker-start.sh" >/dev/null 2>&1
  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  run worker_running
  assert_success

  bash "$PLUGIN_ROOT/scripts/worker-stop.sh"
}

# ---------------------------------------------------------------------------
# WRKR-07: worker writes structured JSON log to logs/worker.log
# ---------------------------------------------------------------------------
@test "WRKR-07: worker writes structured JSON log to logs/worker.log" {
  bash "$PLUGIN_ROOT/scripts/worker-start.sh" >/dev/null 2>&1
  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  # Give the worker a moment to flush log
  sleep 1

  [[ -f "${ARCANON_DATA_DIR}/logs/worker.log" ]] || { echo "log file missing"; return 1; }

  local first_line; first_line=$(head -1 "${ARCANON_DATA_DIR}/logs/worker.log")

  # Must be valid JSON
  echo "$first_line" | jq . >/dev/null 2>&1 || { echo "Log line is not valid JSON: $first_line"; return 1; }

  # Must have required structured fields
  echo "$first_line" | jq -e '.msg' >/dev/null 2>&1 || { echo "Missing 'msg' field in log"; return 1; }
  echo "$first_line" | jq -e '.level' >/dev/null 2>&1 || { echo "Missing 'level' field in log"; return 1; }

  bash "$PLUGIN_ROOT/scripts/worker-stop.sh"
}
