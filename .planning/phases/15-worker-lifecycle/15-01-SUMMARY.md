---
phase: 15-worker-lifecycle
plan: "01"
subsystem: worker-lifecycle
tags: [worker, daemon, shell, pid-management, readiness]
dependency_graph:
  requires: []
  provides:
    - scripts/worker-start.sh (daemon start with PID/port file write and stale-PID detection)
    - scripts/worker-stop.sh (graceful SIGTERM shutdown with PID file cleanup)
    - lib/worker-client.sh (worker_running, worker_call, wait_for_worker shell functions)
  affects:
    - Phase 16: MCP server startup (uses worker-start.sh and wait_for_worker)
    - Phase 17: UI development (uses worker_call for HTTP requests)
    - Phase 18: Agent scan (uses wait_for_worker readiness gate)
tech_stack:
  added: []
  patterns:
    - PID-file daemon pattern (nohup background spawn + PID_FILE)
    - Port-file discovery (PORT_FILE read by client library)
    - Readiness probe via /api/readiness HTTP endpoint
    - Stale-PID detection via kill -0
key_files:
  created:
    - scripts/worker-start.sh
    - scripts/worker-stop.sh
    - lib/worker-client.sh
  modified: []
decisions:
  - DATA_DIR defaults to ~/.allclear (machine-wide), overridable via ALLCLEAR_DATA_DIR env var
  - Port resolution order: ALLCLEAR_WORKER_PORT env -> settings.json -> allclear.config.json -> 37888
  - PORT_FILE written before spawning to allow immediate port discovery by callers
  - worker-client.sh has no shebang or set -e — designed as a sourceable library
metrics:
  duration: "84 seconds"
  completed_date: "2026-03-15"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 0
requirements_satisfied:
  - WRKR-01
  - WRKR-02
  - WRKR-03
  - WRKR-04
  - WRKR-05
---

# Phase 15 Plan 01: Worker Lifecycle Shell Scripts Summary

**One-liner:** PID-file daemon pattern for AllClear worker with stale-PID detection, port-file discovery, SIGTERM/SIGKILL shutdown, and curl-based readiness probe.

## What Was Built

Three shell files that manage the AllClear background worker process lifecycle, establishing the PID-file daemon pattern and readiness infrastructure that all subsequent phases reuse.

### scripts/worker-start.sh

Executable bash script that starts the AllClear worker as a background daemon:

- Resolves `PLUGIN_ROOT` from `CLAUDE_PLUGIN_ROOT` env var or script-relative path
- `DATA_DIR` defaults to `~/.allclear`, overridable via `ALLCLEAR_DATA_DIR`
- Stale-PID detection: reads existing PID_FILE, checks liveness with `kill -0`, removes stale files before spawning
- "Already running" guard: exits 0 with informative message if process is alive
- Port resolution: `ALLCLEAR_WORKER_PORT` env > `settings.json` > `allclear.config.json` > default 37888
- Writes `PORT_FILE` before spawning so callers can discover port immediately
- Spawns worker with `nohup node worker/index.js --port $PORT --data-dir $DATA_DIR` with logs to `DATA_DIR/logs/worker.log`

### scripts/worker-stop.sh

Executable bash script for graceful worker shutdown:

- Handles no-PID-file and stale-PID cases gracefully (exit 0 with informative message)
- Sends `SIGTERM` and polls for exit at 500ms intervals (10 iterations = 5 seconds)
- Falls back to `SIGKILL` (`kill -9`) if process still alive after 5 seconds
- Cleans up both `PID_FILE` and `PORT_FILE` on all exit paths

### lib/worker-client.sh

Sourceable bash library (no shebang, no `set -e`) with three functions:

- `worker_running()`: curls `/api/readiness` with 1-second timeout; returns 0 if worker responds, 1 otherwise
- `worker_call()`: reads port from `DATA_DIR/worker.port`, delegates HTTP request to `curl` with 10-second timeout; passes all extra arguments through
- `wait_for_worker()`: polls `worker_running()` with configurable attempts and interval (default 20 retries at 250ms = 5 second total); prints timeout error to stderr and returns 1 on failure

## Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | worker-start.sh | 50d3e41 | scripts/worker-start.sh |
| 2 | worker-stop.sh | e32d990 | scripts/worker-stop.sh |
| 3 | worker-client.sh | dc47271 | lib/worker-client.sh |

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

All verification checks passed:

- `bash -n scripts/worker-start.sh` — syntax ok
- `bash -n scripts/worker-stop.sh` — syntax ok
- `source lib/worker-client.sh` — all 3 functions defined
- Both scripts executable (`chmod +x`)
- `kill -0` stale-PID detection present in worker-start.sh
- `/api/readiness` endpoint used in worker-client.sh

## Self-Check: PASSED

- `/Users/ravichillerega/sources/allclear/scripts/worker-start.sh` — FOUND
- `/Users/ravichillerega/sources/allclear/scripts/worker-stop.sh` — FOUND
- `/Users/ravichillerega/sources/allclear/lib/worker-client.sh` — FOUND
- commit 50d3e41 — FOUND
- commit e32d990 — FOUND
- commit dc47271 — FOUND
