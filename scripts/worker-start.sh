#!/usr/bin/env bash
# AllClear — worker-start.sh
# Starts the AllClear background worker process as a daemon.
# Writes PID and port files to DATA_DIR, then returns immediately.
# Readiness polling is handled by lib/worker-client.sh wait_for_worker().
set -euo pipefail

# Non-blocking trap: unexpected errors exit 0 silently
trap 'exit 0' ERR

# Resolve PLUGIN_ROOT from environment or script-relative path
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
else
  PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

# Determine data directory (machine-wide: ~/.allclear or override)
DATA_DIR="${ALLCLEAR_DATA_DIR:-$HOME/.allclear}"
mkdir -p "$DATA_DIR"

PID_FILE="${DATA_DIR}/worker.pid"
PORT_FILE="${DATA_DIR}/worker.port"

# Stale-PID detection + version mismatch auto-restart
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    # Worker is running — check version match
    INSTALLED_VERSION=""
    if [[ -f "${PLUGIN_ROOT}/package.json" ]] && command -v jq >/dev/null 2>&1; then
      INSTALLED_VERSION=$(jq -r '.version // empty' "${PLUGIN_ROOT}/package.json" 2>/dev/null || true)
    fi

    RUNNING_VERSION=""
    if [[ -f "$PORT_FILE" ]]; then
      _port=$(cat "$PORT_FILE")
      RUNNING_VERSION=$(curl -s "http://127.0.0.1:${_port}/api/version" 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)
    fi

    if [[ -n "$INSTALLED_VERSION" && -n "$RUNNING_VERSION" && "$INSTALLED_VERSION" != "$RUNNING_VERSION" ]]; then
      echo "version mismatch (installed=$INSTALLED_VERSION, running=$RUNNING_VERSION) — restarting" >&2
      kill "$PID" 2>/dev/null || true
      sleep 1
      kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
      rm -f "$PID_FILE" "$PORT_FILE"
    else
      echo "worker already running (PID $PID)"
      exit 0
    fi
  else
    echo "removing stale PID file (PID $PID no longer exists)" >&2
    rm -f "$PID_FILE"
  fi
fi

# Determine port — check in priority order
PORT=""

# 1. Environment variable
if [[ -n "${ALLCLEAR_WORKER_PORT:-}" ]]; then
  PORT="${ALLCLEAR_WORKER_PORT}"
fi

# 2. ~/.allclear/settings.json key "ALLCLEAR_WORKER_PORT"
if [[ -z "$PORT" ]] && command -v jq >/dev/null 2>&1 && [[ -f "${DATA_DIR}/settings.json" ]]; then
  _port=$(jq -r '.ALLCLEAR_WORKER_PORT // empty' "${DATA_DIR}/settings.json" 2>/dev/null || true)
  [[ -n "$_port" ]] && PORT="$_port"
fi

# 3. allclear.config.json in CWD key ."impact-map".port
if [[ -z "$PORT" ]] && command -v jq >/dev/null 2>&1 && [[ -f "${PWD}/allclear.config.json" ]]; then
  _port=$(jq -r '.["impact-map"].port // empty' "${PWD}/allclear.config.json" 2>/dev/null || true)
  [[ -n "$_port" ]] && PORT="$_port"
fi

# 4. Default
if [[ -z "$PORT" ]]; then
  PORT=37888
fi

# Write port file before spawning so callers can read it immediately
echo "$PORT" > "$PORT_FILE"

# Ensure logs directory exists
mkdir -p "${DATA_DIR}/logs"

# Spawn worker as background daemon — worker is project-agnostic,
# resolves DB per-request via ?project= query parameter
nohup node "${PLUGIN_ROOT}/worker/index.js" \
  --port "$PORT" \
  --data-dir "$DATA_DIR" \
  >>"${DATA_DIR}/logs/worker.log" 2>&1 &
WORKER_PID=$!
echo "$WORKER_PID" > "$PID_FILE"

echo "worker started (PID $WORKER_PID, port $PORT)"
exit 0
