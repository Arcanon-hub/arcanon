#!/usr/bin/env bash
# Arcanon — worker-start.sh
# Starts the Arcanon background worker process as a daemon.
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

# Determine data directory via shared resolver (~/.arcanon, legacy ~/.ligamen supported)
# shellcheck source=../lib/data-dir.sh
source "${PLUGIN_ROOT}/lib/data-dir.sh"
DATA_DIR="$(resolve_arcanon_data_dir)"
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

    # Only restart on version mismatch if we can determine the running version.
    # "unknown" means the worker could not read its own package.json — treat as same.
    if [[ -n "$INSTALLED_VERSION" && -n "$RUNNING_VERSION" \
        && "$RUNNING_VERSION" != "unknown" \
        && "$INSTALLED_VERSION" != "$RUNNING_VERSION" ]]; then
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

# 1. Environment variable — ARCANON_WORKER_PORT wins, legacy LIGAMEN_WORKER_PORT falls back
if [[ -n "${ARCANON_WORKER_PORT:-}" ]]; then
  PORT="${ARCANON_WORKER_PORT}"
elif [[ -n "${LIGAMEN_WORKER_PORT:-}" ]]; then
  PORT="${LIGAMEN_WORKER_PORT}"
fi

# 2. <data-dir>/settings.json — prefer ARCANON_WORKER_PORT key, fall back to legacy name
if [[ -z "$PORT" ]] && command -v jq >/dev/null 2>&1 && [[ -f "${DATA_DIR}/settings.json" ]]; then
  _port=$(jq -r '.ARCANON_WORKER_PORT // .LIGAMEN_WORKER_PORT // empty' "${DATA_DIR}/settings.json" 2>/dev/null || true)
  [[ -n "$_port" ]] && PORT="$_port"
fi

# 3. arcanon.config.json (or legacy ligamen.config.json) in CWD key ."impact-map".port
if [[ -z "$PORT" ]] && command -v jq >/dev/null 2>&1; then
  _cfg=""
  if [[ -f "${PWD}/arcanon.config.json" ]]; then
    _cfg="${PWD}/arcanon.config.json"
  elif [[ -f "${PWD}/ligamen.config.json" ]]; then
    _cfg="${PWD}/ligamen.config.json"
  fi
  if [[ -n "$_cfg" ]]; then
    _port=$(jq -r '.["impact-map"].port // empty' "$_cfg" 2>/dev/null || true)
    [[ -n "$_port" ]] && PORT="$_port"
  fi
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
