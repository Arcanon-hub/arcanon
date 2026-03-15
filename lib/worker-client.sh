# lib/worker-client.sh — AllClear worker HTTP client helpers
# Source this file; do not execute it directly.
# Functions: worker_running(), worker_call(), wait_for_worker()

worker_running() {
  local data_dir="${ALLCLEAR_DATA_DIR:-$HOME/.allclear}"
  local port_file="${data_dir}/worker.port"
  [[ -f "$port_file" ]] || return 1
  local port; port=$(cat "$port_file")
  [[ -n "$port" ]] || return 1
  curl -s --max-time 1 "http://localhost:${port}/api/readiness" >/dev/null 2>&1
}

worker_call() {
  local endpoint="$1"; shift
  local data_dir="${ALLCLEAR_DATA_DIR:-$HOME/.allclear}"
  local port_file="${data_dir}/worker.port"
  [[ -f "$port_file" ]] || { echo "worker-client: no port file at $port_file" >&2; return 1; }
  local port; port=$(cat "$port_file")
  [[ -n "$port" ]] || { echo "worker-client: port file is empty" >&2; return 1; }
  curl -sf --max-time 10 "http://localhost:${port}${endpoint}" "$@"
}

wait_for_worker() {
  local max_attempts="${1:-20}"
  local interval_ms="${2:-250}"
  local data_dir="${ALLCLEAR_DATA_DIR:-$HOME/.allclear}"
  local port_file="${data_dir}/worker.port"
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
