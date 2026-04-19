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

# DSP-07: stale-PID + version-mismatch detection extracted to lib/worker-restart.sh.
# MUTEX BOUNDARY: all new logic below this point runs only when no worker is active
# (either no PID file, or PID is stale, or we just killed it on version mismatch).
# Pitfall 8: do NOT move any new initialization logic above this block.
# shellcheck source=../lib/worker-client.sh
source "${PLUGIN_ROOT}/lib/worker-client.sh"
# shellcheck source=../lib/worker-restart.sh
source "${PLUGIN_ROOT}/lib/worker-restart.sh"

should_restart_worker
if [[ "$_should_restart" != "true" ]]; then
  # Worker is running and versions match — nothing to do.
  echo "worker already running (PID ${_worker_pid})"
  exit 0
fi

# Clean up stale or mismatched worker before spawning.
case "$_restart_reason" in
  version_mismatch)
    echo "version mismatch (installed=${_installed_version}, running=${_running_version}) — restarting" >&2
    kill "$_worker_pid" 2>/dev/null || true
    sleep 1
    kill -0 "$_worker_pid" 2>/dev/null && kill -9 "$_worker_pid" 2>/dev/null || true
    rm -f "$PID_FILE" "$PORT_FILE"
    ;;
  stale_pid)
    echo "removing stale PID file (PID ${_worker_pid} no longer exists)" >&2
    rm -f "$PID_FILE"
    ;;
  no_pid_file)
    : # nothing to clean up
    ;;
esac

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
