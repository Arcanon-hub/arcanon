#!/usr/bin/env bash
# lib/worker-client.sh — Arcanon worker HTTP client helpers
# Source this file; do not execute it directly.
# Functions: worker_running(), worker_call(), wait_for_worker(),
#            worker_start_background(), worker_status_line()

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }

_ARCANON_WORKER_CLIENT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./data-dir.sh
source "${_ARCANON_WORKER_CLIENT_LIB_DIR}/data-dir.sh"

_arcanon_worker_data_dir() {
  resolve_arcanon_data_dir
}

worker_running() {
  local data_dir; data_dir="$(_arcanon_worker_data_dir)"
  local port_file="${data_dir}/worker.port"
  [[ -f "$port_file" ]] || return 1
  local port; port=$(cat "$port_file")
  [[ -n "$port" ]] || return 1
  curl -s --max-time 1 "http://localhost:${port}/api/readiness" >/dev/null 2>&1
}

worker_call() {
  local endpoint="$1"; shift
  local data_dir; data_dir="$(_arcanon_worker_data_dir)"
  local port_file="${data_dir}/worker.port"
  [[ -f "$port_file" ]] || { echo "worker-client: no port file at $port_file" >&2; return 1; }
  local port; port=$(cat "$port_file")
  [[ -n "$port" ]] || { echo "worker-client: port file is empty" >&2; return 1; }
  curl -sf --max-time 10 "http://localhost:${port}${endpoint}" "$@"
}

wait_for_worker() {
  local max_attempts="${1:-20}"
  local interval_ms="${2:-250}"
  local i=0
  while [[ $i -lt $max_attempts ]]; do
    if worker_running; then
      return 0
    fi
    sleep "$(echo "scale=3; $interval_ms/1000" | bc)"
    i=$((i + 1))
  done
  echo "worker-client: timed out waiting for worker after $((max_attempts * interval_ms))ms" >&2
  return 1
}

worker_start_background() {
  # Fires worker-start.sh in the background and returns immediately (non-blocking).
  local plugin_root="${CLAUDE_PLUGIN_ROOT:-}"
  local worker_start=""
  if [[ -n "$plugin_root" ]] && [[ -f "${plugin_root}/scripts/worker-start.sh" ]]; then
    worker_start="${plugin_root}/scripts/worker-start.sh"
  else
    local lib_dir
    lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local candidate="${lib_dir}/../scripts/worker-start.sh"
    [[ -f "$candidate" ]] && worker_start="$candidate"
  fi
  [[ -z "$worker_start" ]] && return 1
  bash "$worker_start" >/dev/null 2>&1 &
  return 0
}

worker_status_line() {
  local data_dir; data_dir="$(_arcanon_worker_data_dir)"
  local port_file="${data_dir}/worker.port"
  if ! worker_running 2>/dev/null; then
    return 0
  fi
  local port=""
  [[ -f "$port_file" ]] && port=$(cat "$port_file")
  if [[ -n "$port" ]]; then
    echo "Arcanon worker: running (port ${port})"
  else
    echo "Arcanon worker: running"
  fi
}
