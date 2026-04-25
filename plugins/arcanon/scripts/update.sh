#!/usr/bin/env bash
# Arcanon — update.sh
# Deterministic shell for /arcanon:update orchestration.
# Modes:
#   --check        (98-01)    Emit JSON {installed, remote, update_available, changelog_preview, status} to stdout
#   --kill         (98-02)    Kill-only worker stop with scan-lock guard
#   --prune-cache  (98-03)    Remove old cache version dirs (lsof-guarded)
#   --verify       (98-03)    Poll /api/version for up to 10s, confirm match
#
# Exits 0 on success or graceful-fallback (offline, already-current). Exits 1 only on
# bad invocation (unknown mode). Never exits non-zero for operational failures — the
# caller (commands/update.md) reads JSON status instead.
set -euo pipefail
trap 'exit 0' ERR

# PLUGIN_ROOT resolution (identical to worker-stop.sh lines 11-15)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

MODE="${1:-}"
case "$MODE" in
  --check|--kill) ;;  # fall through to mode-specific logic below
  --prune-cache) ;;  # fall through to prune logic below
  --verify) ;;  # fall through to verify logic below
  *)
    echo "usage: update.sh --check|--kill|--prune-cache|--verify" >&2
    exit 1
    ;;
esac

# ─── --kill mode (REQ UPD-07, UPD-08) ────────────────────────────────────────
if [[ "$MODE" == "--kill" ]]; then
  # Resolve DATA_DIR via shared resolver — same pattern as worker-stop.sh:11-15.
  # shellcheck source=../lib/data-dir.sh
  source "${PLUGIN_ROOT}/lib/data-dir.sh"
  DATA_DIR="$(resolve_arcanon_data_dir)"
  PID_FILE="${DATA_DIR}/worker.pid"
  PORT_FILE="${DATA_DIR}/worker.port"
  SCAN_LOCK="${DATA_DIR}/scan.lock"

  # REQ UPD-07: scan-in-progress guard. scan.lock is written/removed by
  # worker/scan/manager.js per Phase 80 SEC-03 and contains the scanning PID.
  if [[ -f "$SCAN_LOCK" ]]; then
    _lock_pid=$(cat "$SCAN_LOCK" 2>/dev/null || true)
    if [[ -n "$_lock_pid" ]] && kill -0 "$_lock_pid" 2>/dev/null; then
      printf '{"status":"scan_in_progress","lock_pid":"%s","message":"A scan is currently running (PID %s). Wait for it to finish or cancel it before updating."}\n' \
        "$_lock_pid" "$_lock_pid"
      exit 0  # REQ UPD-07: abort gracefully, not an error. commands/update.md reads status.
    fi
    # Stale lock — ignore it and proceed.
    rm -f "$SCAN_LOCK"
  fi

  # REQ UPD-08: kill-only semantics (no restart).
  if [[ ! -f "$PID_FILE" ]]; then
    printf '{"status":"killed","reason":"no_pid_file","message":"worker was not running"}\n'
    exit 0
  fi

  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  # T-98-05: validate PID is numeric before using it with kill
  if [[ -z "$PID" ]] || ! [[ "$PID" =~ ^[0-9]+$ ]] || ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE" "$PORT_FILE"
    printf '{"status":"killed","reason":"stale_pid","message":"worker was not running (stale PID)"}\n'
    exit 0
  fi

  # SIGTERM, poll 10x500ms = 5s, SIGKILL. Mirrors worker-stop.sh:36-54.
  kill -TERM "$PID" 2>/dev/null || true

  _iter=0
  while [[ $_iter -lt 10 ]]; do
    sleep 0.5
    if ! kill -0 "$PID" 2>/dev/null; then
      rm -f "$PID_FILE" "$PORT_FILE"
      printf '{"status":"killed","reason":"sigterm","pid":"%s"}\n' "$PID"
      exit 0
    fi
    _iter=$((_iter + 1))
  done

  # 5s elapsed — force-kill.
  kill -KILL "$PID" 2>/dev/null || true
  sleep 0.1  # let kernel reap
  rm -f "$PID_FILE" "$PORT_FILE"
  printf '{"status":"killed","reason":"sigkill","pid":"%s"}\n' "$PID"
  exit 0
fi

# ─── --prune-cache mode (REQ UPD-09 — Pitfall 17) ───────────────────────────
if [[ "$MODE" == "--prune-cache" ]]; then
  CURRENT_VER=$(jq -r '.version // empty' "${PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null || true)
  if [[ -z "$CURRENT_VER" ]]; then
    CURRENT_VER=$(jq -r '.version // empty' "${PLUGIN_ROOT}/package.json" 2>/dev/null || true)
  fi

  if [[ -z "$CURRENT_VER" ]]; then
    printf '{"status":"skipped","reason":"no_current_version","pruned":[],"kept":[]}\n'
    exit 0
  fi

  # Track what we pruned and what we kept for transparent reporting.
  declare -a PRUNED=()
  declare -a KEPT=()
  declare -a LOCKED=()

  # Glob-discover cache dirs. Anti-Pattern 4: do NOT hardcode the marketplace segment.
  shopt -s nullglob
  for dir in "${HOME}"/.claude/plugins/cache/*/arcanon/*/; do
    # Extract version (last path segment before trailing slash)
    ver="${dir%/}"
    ver="${ver##*/}"

    # Keep the current version — that's the one we just installed
    if [[ "$ver" == "$CURRENT_VER" ]]; then
      KEPT+=("$dir")
      continue
    fi

    # Pitfall 17: refuse to delete a dir that has active file handles.
    # Worker was killed in 98-02 Step 4, so old dir should be idle, but belt-and-suspenders.
    if command -v lsof >/dev/null 2>&1 && lsof +D "$dir" >/dev/null 2>&1; then
      LOCKED+=("$dir")
      continue
    fi

    # Safe to remove
    if rm -rf "$dir" 2>/dev/null; then
      PRUNED+=("$dir")
    else
      LOCKED+=("$dir")  # rm failed for some other reason — treat like locked
    fi
  done
  shopt -u nullglob

  # Emit JSON report. Handle empty arrays correctly with jq.
  PRUNED_JSON=$(printf '%s\n' "${PRUNED[@]+"${PRUNED[@]}"}" | jq -R . | jq -s .)
  KEPT_JSON=$(printf '%s\n' "${KEPT[@]+"${KEPT[@]}"}" | jq -R . | jq -s .)
  LOCKED_JSON=$(printf '%s\n' "${LOCKED[@]+"${LOCKED[@]}"}" | jq -R . | jq -s .)
  printf '{"status":"pruned","current_version":"%s","pruned":%s,"kept":%s,"locked":%s}\n' \
    "$CURRENT_VER" "$PRUNED_JSON" "$KEPT_JSON" "$LOCKED_JSON"
  exit 0
fi

# ─── --verify mode (REQ UPD-10, UPD-12) ─────────────────────────────────────
if [[ "$MODE" == "--verify" ]]; then
  # shellcheck source=../lib/data-dir.sh
  source "${PLUGIN_ROOT}/lib/data-dir.sh"
  DATA_DIR="$(resolve_arcanon_data_dir)"

  # Target version = the newly installed plugin version
  TARGET_VER=$(jq -r '.version // empty' "${PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null || true)
  if [[ -z "$TARGET_VER" ]]; then
    TARGET_VER=$(jq -r '.version // empty' "${PLUGIN_ROOT}/package.json" 2>/dev/null || true)
  fi
  [[ -z "$TARGET_VER" ]] && TARGET_VER="unknown"

  # Start a fresh worker (98-02 --kill left the worker down).
  # worker-start.sh is idempotent-on-stale and quick to return.
  bash "${PLUGIN_ROOT}/scripts/worker-start.sh" >/dev/null 2>&1 || true

  PORT_FILE="${DATA_DIR}/worker.port"

  # Poll /api/version up to 10 times at 1s intervals (REQ UPD-10).
  # First iteration sleeps before checking — worker needs time to spawn.
  RUNNING_VER=""
  ELAPSED=0
  for i in $(seq 1 10); do
    sleep 1
    ELAPSED=$i
    if [[ ! -f "$PORT_FILE" ]]; then
      continue  # port file not yet written
    fi
    PORT=$(cat "$PORT_FILE" 2>/dev/null || true)
    [[ -z "$PORT" ]] && continue

    RUNNING_VER=$(curl -s --max-time 1 "http://127.0.0.1:${PORT}/api/version" 2>/dev/null \
      | jq -r '.version // empty' 2>/dev/null || true)

    if [[ -n "$RUNNING_VER" && "$RUNNING_VER" != "unknown" && "$RUNNING_VER" == "$TARGET_VER" ]]; then
      printf '{"status":"verified","target":"%s","running":"%s","elapsed_s":%d}\n' \
        "$TARGET_VER" "$RUNNING_VER" "$ELAPSED"
      exit 0
    fi
  done

  # Fell through — either the worker never came up, or it's running a different version.
  if [[ -z "$RUNNING_VER" ]]; then
    printf '{"status":"verify_failed","reason":"no_response","target":"%s","elapsed_s":%d,"message":"Worker did not respond within 10s."}\n' \
      "$TARGET_VER" "$ELAPSED"
  else
    printf '{"status":"verify_failed","reason":"version_mismatch","target":"%s","running":"%s","elapsed_s":%d,"message":"Worker is running v%s but target is v%s."}\n' \
      "$TARGET_VER" "$RUNNING_VER" "$ELAPSED" "$RUNNING_VER" "$TARGET_VER"
  fi
  exit 0  # Pitfall 11: graceful failure — plugin is installed, just not yet serving.
fi

# ─── --check mode ───────────────────────────────────────────────────────────
# 1. Read installed version (prefer plugin.json, fallback package.json)
INSTALLED_VER=$(jq -r '.version // empty' "${PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null || true)
if [[ -z "$INSTALLED_VER" ]]; then
  INSTALLED_VER=$(jq -r '.version // empty' "${PLUGIN_ROOT}/package.json" 2>/dev/null || true)
fi
[[ -z "$INSTALLED_VER" ]] && INSTALLED_VER="unknown"

# 2. Refresh marketplace with 5s cap (REQ UPD-11 — Pitfall 10)
#    Uses background-subshell+timer because timeout(1) is not on macOS by default.
#    The timer caps how long we wait for refresh; its outcome (timeout or success)
#    is informational only and does NOT gate the offline branch below. (THE-1027)
MARKETPLACE_DIR="${HOME}/.claude/plugins/marketplaces/arcanon"
{
  (claude plugin marketplace update arcanon >/dev/null 2>&1) &
  refresh_pid=$!
  elapsed=0
  while kill -0 "$refresh_pid" 2>/dev/null; do
    sleep 0.2
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge 25 ]]; then  # 25 * 0.2s = 5s
      kill -TERM "$refresh_pid" 2>/dev/null || true
      sleep 0.1
      kill -KILL "$refresh_pid" 2>/dev/null || true
      # Timer fired: stop waiting for refresh. Do NOT flip an offline flag —
      # the cached mirror file (if present) is still authoritative. (THE-1027)
      break
    fi
  done
  wait "$refresh_pid" 2>/dev/null || true
} 2>/dev/null

# Offline gate: mirror file existence is the single source of truth.
# Refresh-process timeout is a staleness signal (we may have an old mirror)
# but NOT an offline signal — if the mirror file is on disk, we still
# compute newer/equal/ahead from it. (THE-1027, UPD-01..03)
if [[ ! -f "${MARKETPLACE_DIR}/plugins/arcanon/.claude-plugin/marketplace.json" ]]; then
  # REQ UPD-11: exit 0 with offline status; commands/update.md formats the user-facing message
  printf '{"status":"offline","installed":"%s","remote":null,"update_available":false,"changelog_preview":""}\n' "$INSTALLED_VER"
  exit 0
fi

# 3. Read remote version
REMOTE_VER=$(jq -r '.version // empty' \
  "${MARKETPLACE_DIR}/plugins/arcanon/.claude-plugin/marketplace.json" 2>/dev/null || true)
[[ -z "$REMOTE_VER" ]] && REMOTE_VER="unknown"

# 4. Semver comparison (REQ UPD-02 — Pitfall 1). Node + semver.
#    Validates with semver.valid() before gt/lt to guard against injection (T-98-01, T-98-02).
#    If semver is not resolvable, reports unknown rather than falling back to string compare.
CMP_RESULT="unknown"
if [[ "$INSTALLED_VER" != "unknown" && "$REMOTE_VER" != "unknown" ]]; then
  NODE_PATH="${PLUGIN_ROOT}/node_modules" node -e "
    const s = require('semver');
    if (!s.valid('${INSTALLED_VER}') || !s.valid('${REMOTE_VER}')) { process.exit(2); }
    if (s.gt('${REMOTE_VER}', '${INSTALLED_VER}')) process.exit(0);
    else if (s.eq('${REMOTE_VER}', '${INSTALLED_VER}')) process.exit(1);
    else process.exit(3);
  " 2>/dev/null || NODE_EXIT=$?
  NODE_EXIT="${NODE_EXIT:-0}"
  case $NODE_EXIT in
    0) CMP_RESULT="newer" ;;
    1) CMP_RESULT="equal" ;;
    3) CMP_RESULT="ahead" ;;  # installed > remote (edge: running a dev build)
    *) CMP_RESULT="unknown" ;;
  esac
fi

# 5. Extract changelog preview (REQ UPD-04) if newer
CHANGELOG_PREVIEW=""
if [[ "$CMP_RESULT" == "newer" ]]; then
  CHANGELOG_FILE="${MARKETPLACE_DIR}/plugins/arcanon/CHANGELOG.md"
  if [[ -f "$CHANGELOG_FILE" ]]; then
    # Take the first 2-4 bullet lines under the first "## [" heading in the remote CHANGELOG.
    CHANGELOG_PREVIEW=$(awk '
      /^## \[/ { if (seen) exit; seen=1; next }
      seen && /^- / { print; count++; if (count >= 4) exit }
    ' "$CHANGELOG_FILE" | head -c 400)
  fi
fi

# 6. Emit JSON
UPDATE_AVAILABLE=$([[ "$CMP_RESULT" == "newer" ]] && echo "true" || echo "false")
# jq ensures preview is JSON-safe (newlines, quotes escaped)
PREVIEW_JSON=$(printf '%s' "$CHANGELOG_PREVIEW" | jq -Rs .)
printf '{"status":"%s","installed":"%s","remote":"%s","update_available":%s,"changelog_preview":%s}\n' \
  "$CMP_RESULT" "$INSTALLED_VER" "$REMOTE_VER" "$UPDATE_AVAILABLE" "$PREVIEW_JSON"
exit 0
