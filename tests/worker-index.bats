#!/usr/bin/env bats
# tests/worker-index.bats — TDD tests for worker/index.js (Task 1, Phase 15-02)
# RED phase: these tests are written before the implementation exists.

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"

setup() {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export ARCANON_WORKER_PORT="38100"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
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

# Helper to start the worker and wait for it to be ready
start_worker_and_wait() {
  node "${PLUGIN_ROOT}/worker/index.js" \
    --port "${ARCANON_WORKER_PORT}" \
    --data-dir "${ARCANON_DATA_DIR}" &
  WORKER_PID=$!
  # Wait up to 3 seconds for PID file
  local i=0
  while [[ $i -lt 30 ]]; do
    [[ -f "${ARCANON_DATA_DIR}/worker.pid" ]] && break
    sleep 0.1
    i=$((i + 1))
  done
  # Wait for readiness
  local j=0
  while [[ $j -lt 30 ]]; do
    if curl -s --max-time 1 "http://localhost:${ARCANON_WORKER_PORT}/api/readiness" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
    j=$((j + 1))
  done
  return 1
}

@test "Test 1: starting the worker writes a PID file" {
  start_worker_and_wait

  [[ -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "PID file missing"; return 1; }
  local pid; pid=$(cat "${ARCANON_DATA_DIR}/worker.pid")
  [[ "$pid" =~ ^[0-9]+$ ]] || { echo "PID file does not contain a number: $pid"; return 1; }
}

@test "Test 2: GET /api/readiness returns HTTP 200 after startup" {
  start_worker_and_wait

  run curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:${ARCANON_WORKER_PORT}/api/readiness"
  assert_output "200"
}

@test "Test 3: SIGTERM causes clean exit — PID and port files removed" {
  start_worker_and_wait

  local pid; pid=$(cat "${ARCANON_DATA_DIR}/worker.pid")

  # Send SIGTERM
  kill -TERM "$pid"

  # Wait up to 3 seconds for cleanup
  local i=0
  while [[ $i -lt 30 ]]; do
    [[ ! -f "${ARCANON_DATA_DIR}/worker.pid" ]] && break
    sleep 0.1
    i=$((i + 1))
  done

  [[ ! -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "PID file still exists after SIGTERM"; return 1; }
  [[ ! -f "${ARCANON_DATA_DIR}/worker.port" ]] || { echo "port file still exists after SIGTERM"; return 1; }
}

@test "Test 4: Worker reads ARCANON_LOG_LEVEL from settings.json" {
  # Write settings.json with DEBUG level
  echo '{"ARCANON_LOG_LEVEL": "DEBUG"}' > "${ARCANON_DATA_DIR}/settings.json"

  start_worker_and_wait
  sleep 0.5

  # Log file should exist with DEBUG-level entries possible
  [[ -f "${ARCANON_DATA_DIR}/logs/worker.log" ]] || { echo "log file missing"; return 1; }

  local first_line; first_line=$(head -1 "${ARCANON_DATA_DIR}/logs/worker.log")
  echo "$first_line" | jq . >/dev/null 2>&1 || { echo "Log line is not valid JSON: $first_line"; return 1; }
}

@test "Test 5: Worker writes structured JSON log lines to logs/worker.log" {
  start_worker_and_wait
  sleep 0.5

  [[ -f "${ARCANON_DATA_DIR}/logs/worker.log" ]] || { echo "log file missing"; return 1; }

  local first_line; first_line=$(head -1 "${ARCANON_DATA_DIR}/logs/worker.log")
  # Must be valid JSON
  echo "$first_line" | jq . >/dev/null 2>&1 || { echo "Not valid JSON: $first_line"; return 1; }
  # Must have required fields
  echo "$first_line" | jq -e '.msg' >/dev/null 2>&1 || { echo "Missing 'msg' field"; return 1; }
  echo "$first_line" | jq -e '.level' >/dev/null 2>&1 || { echo "Missing 'level' field"; return 1; }
  echo "$first_line" | jq -e '.ts' >/dev/null 2>&1 || { echo "Missing 'ts' field"; return 1; }
  echo "$first_line" | jq -e '.pid' >/dev/null 2>&1 || { echo "Missing 'pid' field"; return 1; }
}

@test "Test 6: /api/readiness returns 200 even when no DB exists yet" {
  # No DB setup — just start the worker and check readiness
  start_worker_and_wait

  run curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://localhost:${ARCANON_WORKER_PORT}/api/readiness"
  assert_output "200"
}
