#!/usr/bin/env bash
# Arcanon — install-deps.sh
# SessionStart hook: ensures the MCP/worker runtime dependencies are installed
# and the better-sqlite3 native binding actually loads. The single source of
# truth for runtime deps is plugins/arcanon/package.json.
#
# Design: read REAL state, never a marker. is_healthy() inspects node_modules
# and loads the native binding directly, so nothing can outlive the tree and
# desync. Healing is additive (`npm install`); we never rm -rf node_modules.
#
# Non-blocking: every path exits 0. Genuine failures log to stderr; the runtime
# self-surfaces via the worker / MCP server when the user invokes a feature.
set -euo pipefail
trap 'exit 0' ERR

# ---------------------------------------------------------------------------
# Plugin root resolution (env var preferred; script-relative fallback)
# ---------------------------------------------------------------------------
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
else
  PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

# ---------------------------------------------------------------------------
# Guards (each → silent exit 0; not this hook's problem to solve)
# ---------------------------------------------------------------------------
# CLAUDE_PLUGIN_DATA unset ⇒ not running under the Claude Code plugin lifecycle
# (dev / CI). Skip — deps are managed manually there.
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" ]]; then
  exit 0
fi
command -v npm  >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

PACKAGE_JSON="${PLUGIN_ROOT}/package.json"
if [[ ! -f "${PACKAGE_JSON}" ]]; then
  echo "[arcanon] package.json not found at ${PACKAGE_JSON}" >&2
  exit 0
fi

# Optional timeout binary (macOS may have it as gtimeout via Homebrew coreutils).
# Fallback is `env` (a transparent pass-through), NOT an empty array: on bash 3.2
# (stock macOS) `"${EMPTY[@]}"` under `set -u` raises "unbound variable", which
# inside is_healthy()'s subshell would read as a false "unhealthy" → needless
# reinstall every session.
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN=(timeout 10)
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN=(gtimeout 10)
else
  TIMEOUT_BIN=(env)
fi

# ---------------------------------------------------------------------------
# is_healthy: returns 0 only if BOTH hold (reads real state, no marker):
#   1. every key in package.json .dependencies is present in node_modules, and
#   2. the better-sqlite3 native binding loads (require + open :memory:).
# optionalDependencies are intentionally NOT required — an absent optional dep
# (e.g. @chroma-core/default-embed) must not trigger a reinstall loop.
# ---------------------------------------------------------------------------
is_healthy() {
  # ESM input (--input-type=module): the plugin package.json is "type":"module",
  # so a bare `node -e` would run as ESM and a require()-based probe would fail.
  ( cd "${PLUGIN_ROOT}" && "${TIMEOUT_BIN[@]}" node --input-type=module -e '
    import fs from "node:fs";
    import path from "node:path";
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    for (const dep of Object.keys(pkg.dependencies || {})) {
      if (!fs.existsSync(path.join(process.cwd(), "node_modules", dep, "package.json"))) {
        process.exit(1);
      }
    }
    const Database = (await import("better-sqlite3")).default;
    new Database(":memory:").close();
  ' ) >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# run_npm: run an npm subcommand, capping log noise; surface failure via rc.
# Output is captured to a temp file (not piped to head) so npm never receives
# SIGPIPE and reports a false failure on verbose-but-successful runs.
# ---------------------------------------------------------------------------
run_npm() {
  local log rc
  log="$(mktemp)"
  if "$@" >"${log}" 2>&1; then
    rc=0
  else
    rc=$?
    tail -50 "${log}" >&2
  fi
  rm -f "${log}"
  return "${rc}"
}

# ---------------------------------------------------------------------------
# Step 1 — fast path: already healthy (every session, the common case).
# ---------------------------------------------------------------------------
if is_healthy; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 2 — single-flight lock (atomic mkdir). A concurrent session that is
# already installing holds the lock; we back off rather than racing it. A lock
# older than 10 min is treated as stale (a crashed prior run) and taken over.
# ---------------------------------------------------------------------------
LOCK_DIR="${PLUGIN_ROOT}/.arcanon-install.lock"
# GNU first (`stat -c %Y`), then BSD (`stat -f %m`). Order matters: GNU's `-f`
# means --file-system and emits garbage with exit 0 instead of failing, so a
# BSD-first probe would never fall through on Linux. BSD errors on `-c`, so it
# falls through correctly on macOS.
lock_mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  now="$(date +%s)"
  mtime="$(lock_mtime "${LOCK_DIR}")"
  # Numeric guard: a non-epoch value (stat unavailable / unexpected output) is
  # treated as stale rather than fed to arithmetic (which would crash under set -u).
  if [[ "${mtime}" =~ ^[0-9]+$ ]] && (( now - mtime < 600 )); then
    exit 0  # another session is installing — let it finish
  fi
  rmdir "${LOCK_DIR}" 2>/dev/null || true
  mkdir "${LOCK_DIR}" 2>/dev/null || exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

# ---------------------------------------------------------------------------
# Step 3 — additive install (uses the committed lockfile). Non-destructive:
# on failure we leave state untouched and self-heal next session.
# ---------------------------------------------------------------------------
if ! run_npm npm install --prefix "${PLUGIN_ROOT}" --omit=dev --no-audit --no-fund; then
  echo "[arcanon] npm install failed — runtime will surface details on first feature use" >&2
  exit 0
fi

# Step 4 — common case healed (tree was missing or partial).
if is_healthy; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 5 — tree present but binding still won't load ⇒ ABI mismatch (Node
# changed since install). Stop a live worker first so the loaded/locked .node
# can be replaced (mandatory on Windows; harmless elsewhere), then rebuild.
# worker.pid lives under resolve_arcanon_data_dir() (ARCANON_DATA_DIR or
# ~/.arcanon) — NOT CLAUDE_PLUGIN_DATA. session-start.sh restarts it after.
# ---------------------------------------------------------------------------
if [[ -f "${PLUGIN_ROOT}/lib/data-dir.sh" ]]; then
  # shellcheck source=../lib/data-dir.sh
  source "${PLUGIN_ROOT}/lib/data-dir.sh"
  if declare -f resolve_arcanon_data_dir >/dev/null 2>&1; then
    WORKER_DATA_DIR="$(resolve_arcanon_data_dir 2>/dev/null || true)"
    PID_FILE="${WORKER_DATA_DIR}/worker.pid"
    if [[ -n "${WORKER_DATA_DIR}" && -f "${PID_FILE}" ]]; then
      WORKER_PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
      if [[ -n "${WORKER_PID}" ]] && kill -0 "${WORKER_PID}" 2>/dev/null; then
        kill "${WORKER_PID}" 2>/dev/null || true
        # Wait for the process to actually exit before rebuilding: on Windows the
        # loaded better_sqlite3.node stays locked until the worker is gone, so a
        # rebuild started too early would fail to overwrite it. Bounded (~2s);
        # if it outlives that, proceed anyway (rebuild may still succeed elsewhere).
        for _ in 1 2 3 4 5 6 7 8 9 10; do
          kill -0 "${WORKER_PID}" 2>/dev/null || break
          sleep 0.2
        done
      fi
    fi
  fi
fi

echo "[arcanon] better-sqlite3 binding failed to load — running npm rebuild" >&2
if ! run_npm npm rebuild better-sqlite3 --prefix "${PLUGIN_ROOT}"; then
  echo "[arcanon] npm rebuild better-sqlite3 failed — runtime will surface details on first feature use" >&2
  exit 0
fi

# Step 6 — rebuild healed the binding.
if is_healthy; then
  exit 0
fi

# Step 7 — out of options: no prebuilt for this Node and rebuild did not help.
echo "[arcanon] better-sqlite3 won't load on Node $(node -v) — Arcanon requires Node 20 or newer" >&2
exit 0
