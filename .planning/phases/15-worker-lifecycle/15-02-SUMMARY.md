---
phase: 15-worker-lifecycle
plan: "02"
subsystem: worker-lifecycle
tags: [worker, fastify, node, pid-file, readiness-probe, structured-logging, tdd, bats]

requires:
  - phase: 15-01
    provides: scripts/worker-start.sh, scripts/worker-stop.sh, lib/worker-client.sh
provides:
  - worker/index.js (Node.js worker entry point: HTTP listener, PID/port file write, SIGTERM handler, /api/readiness route, structured logging)
  - tests/worker-lifecycle.bats (7-test bats suite covering all WRKR acceptance criteria)
affects:
  - Phase 16: MCP server (runs inside same process as this worker)
  - Phase 17: HTTP server / web UI (http-server.js already wired into this worker)
  - Phase 18: Agent scan (depends on /api/readiness being available)

tech-stack:
  added: []
  patterns:
    - TDD (RED-GREEN) — failing bats tests committed before implementation
    - /api/readiness registered as first Fastify route so probe works before DB init
    - Structured JSON log lines appended to logs/worker.log (one object per line, ISO8601 ts)
    - SIGTERM → graceful app.close() → delete PID/port files → process.exit(0)
    - Read ALLCLEAR_LOG_LEVEL from settings.json at startup (graceful fallback to INFO)

key-files:
  created:
    - worker/index.js
    - tests/worker-index.bats
    - tests/worker-lifecycle.bats
  modified: []

key-decisions:
  - "/api/readiness registered before DB init — probe always returns 200 regardless of DB state"
  - "PID file written before listen() so kill -0 checks work even if listen is slow"
  - "Port file written after listen() succeeds — avoids race where caller reads port but port is not yet bound"
  - "tests/worker-lifecycle.bats already committed by adjacent plan (14-02) — identical content, no-op overwrite"

patterns-established:
  - "Startup order: parse args → read settings → mkdir → write PID → register routes → listen → write port → log"
  - "Graceful shutdown: signal → log → app.close() → rm PID → rm port → log → exit 0"

requirements-completed:
  - WRKR-06
  - WRKR-07

duration: 6min
completed: "2026-03-15"
---

# Phase 15 Plan 02: Worker Entry Point and Lifecycle Tests Summary

**Fastify-based Node.js worker entry point with PID/port file lifecycle, SIGTERM graceful shutdown, ALLCLEAR_LOG_LEVEL settings read, structured JSON logging, and a 7-test bats suite proving all WRKR acceptance criteria.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-15T17:14:47Z
- **Completed:** 2026-03-15T17:20:30Z
- **Tasks:** 2 (Task 1 via TDD RED+GREEN, Task 2 verification)
- **Files modified:** 3

## Accomplishments

- Created `worker/index.js` — minimal ES-module Node.js entry point that makes all Phase 15 shell scripts functional
- Implemented TDD flow: wrote 6 failing tests first (RED commit `dd90a43` predecessor), then green implementation
- All 7 WRKR bats tests pass: PID/port file writes, duplicate-start guard, stale-PID clearing, readiness probe, SIGTERM cleanup, structured logging
- Integration smoke test passes end-to-end: start → readiness → curl → stop → cleanup

## Task Commits

Each task was committed atomically:

1. **TDD RED — worker/index.js tests** - `dd90a43` (test)
2. **TDD GREEN — worker/index.js implementation** - `a625b26` (feat)
3. **tests/worker-lifecycle.bats** - committed in `9501d1e` (feat, via adjacent plan — identical content)

## Files Created/Modified

- `worker/index.js` — Fastify HTTP server entry point: /api/readiness, PID/port file lifecycle, SIGTERM handler, ALLCLEAR_LOG_LEVEL read, structured JSON logging to logs/worker.log
- `tests/worker-index.bats` — TDD RED tests for worker/index.js (6 tests, committed before implementation)
- `tests/worker-lifecycle.bats` — Complete lifecycle bats suite covering WRKR-01 through WRKR-07 (7 tests)

## Decisions Made

- `/api/readiness` registered as the very first Fastify route to ensure the readiness probe always returns 200 regardless of whether the DB or other subsystems have initialized. This satisfies the "probe before DB" requirement.
- Port file written after `app.listen()` succeeds to avoid callers reading a port that is not yet bound. PID file written before `listen()` so process-existence checks work during startup.
- `tests/worker-lifecycle.bats` was found to already be committed (commit `9501d1e`) with identical content produced by this plan. Treated as a no-op.

## Deviations from Plan

None — plan executed exactly as written. The only notable discovery was that `tests/worker-lifecycle.bats` had been pre-committed by an adjacent plan run (`9501d1e`) with the same content — the overwrite was idempotent and produced no change.

## Issues Encountered

None — all tests passed on first GREEN run without debugging iterations.

## Next Phase Readiness

- `worker/index.js` is functional: shell scripts from Phase 15-01 can now spawn a real worker
- `/api/readiness` returns 200 immediately — Phase 16 MCP server startup and Phase 18 scan readiness gate are unblocked
- Structured JSON logging in place — log aggregation and debugging infrastructure ready

---
*Phase: 15-worker-lifecycle*
*Completed: 2026-03-15*

## Self-Check: PASSED

- `/Users/ravichillerega/sources/allclear/worker/index.js` — FOUND
- `/Users/ravichillerega/sources/allclear/tests/worker-index.bats` — FOUND
- `/Users/ravichillerega/sources/allclear/tests/worker-lifecycle.bats` — FOUND
- `/Users/ravichillerega/sources/allclear/.planning/phases/15-worker-lifecycle/15-02-SUMMARY.md` — FOUND
- commit dd90a43 — FOUND
- commit a625b26 — FOUND
