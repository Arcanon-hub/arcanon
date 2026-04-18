#!/usr/bin/env bash
# Arcanon — worker-stop.sh
# Gracefully stops the Arcanon background worker process.
# Sends SIGTERM and waits up to 5 seconds, then falls back to SIGKILL.
# Cleans up PID and port files on exit.
set -euo pipefail

# Non-blocking trap: unexpected errors exit 0 silently
trap 'exit 0' ERR

# Determine data directory via shared resolver (~/.arcanon, legacy ~/.ligamen supported)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=../lib/data-dir.sh
source "${PLUGIN_ROOT}/lib/data-dir.sh"
DATA_DIR="$(resolve_arcanon_data_dir)"

PID_FILE="${DATA_DIR}/worker.pid"
PORT_FILE="${DATA_DIR}/worker.port"

# No PID file — worker is not running
if [[ ! -f "$PID_FILE" ]]; then
  echo "worker is not running (no PID file)"
  exit 0
fi

PID=$(cat "$PID_FILE")

# Check if process is alive
if ! kill -0 "$PID" 2>/dev/null; then
  echo "worker is not running (PID $PID stale)"
  rm -f "$PID_FILE" "$PORT_FILE"
  exit 0
fi

# Send SIGTERM for graceful shutdown
kill -TERM "$PID"

# Poll for exit: 10 iterations at 500ms = 5 seconds total
_iter=0
while [[ $_iter -lt 10 ]]; do
  sleep 0.5
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE" "$PORT_FILE"
    echo "worker stopped (PID $PID)"
    exit 0
  fi
  _iter=$((_iter + 1))
done

# Process still running after 5s — force kill
kill -9 "$PID" && true
echo "worker force-killed (PID $PID)" >&2

rm -f "$PID_FILE" "$PORT_FILE"
exit 0
