---
phase: 24-log-terminal-api
plan: 01
subsystem: api
tags: [fastify, node, http, logs, filtering]

# Dependency graph
requires:
  - phase: 23-logging-instrumentation
    provides: structured JSON log file at {dataDir}/logs/worker.log with component-tagged lines
provides:
  - GET /api/logs endpoint in worker/server/http.js with component and since query filters
  - options.dataDir wired through createHttpServer so log path is never hardcoded
affects:
  - 25-log-terminal-ui

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Top-level fs import for synchronous reads in http.js (vs dynamic import used in /api/version)"
    - "TDD: RED commit (test) then GREEN commit (feat) for single task"

key-files:
  created: []
  modified:
    - worker/server/http.js
    - worker/server/http.test.js
    - worker/index.js

key-decisions:
  - "GET /api/logs uses synchronous fs.readFileSync (log tail is small — never >500 lines parsed, no need for async)"
  - "ISO timestamp string comparison used for ?since= filter — safe because ISO 8601 sorts lexicographically"
  - "options.dataDir defaults to null — tests that don't exercise logs pass null, production worker always passes dataDir"

patterns-established:
  - "Log endpoint pattern: read file sync, split on newline, tail 500, parse JSON lines, skip corrupt, filter"

requirements-completed:
  - LOG-API-INFRA

# Metrics
duration: 2min
completed: 2026-03-16
---

# Phase 24 Plan 01: Log Terminal API Summary

**GET /api/logs endpoint on Fastify server reading structured JSON log file with component and since filtering, capped at 500 lines**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-16T13:06:17Z
- **Completed:** 2026-03-16T13:08:01Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments

- Added `GET /api/logs` route to Fastify HTTP server that reads `{dataDir}/logs/worker.log`
- Implemented `?component=` filter (exact match on `component` field) and `?since=` filter (ISO timestamp, lexicographic comparison)
- Endpoint returns `{ lines: [] }` for missing/empty log file — never returns 500
- Caps response at 500 lines (last 500), silently skips non-JSON lines
- Wired `dataDir` into `createHttpServer` options in `worker/index.js` — production worker now passes it through

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for GET /api/logs** - `7c71a8b` (test)
2. **Task 1 GREEN: Implement /api/logs route + wire dataDir** - `5cf5c0d` (feat)

_Note: TDD tasks may have multiple commits (test then feat)_

## Files Created/Modified

- `worker/server/http.js` - Added `import fs from "node:fs"` at top; added `/api/logs` route (route 8)
- `worker/server/http.test.js` - Updated `makeServer` helper to accept `opts`; added `makeTempDataDir` helper; added 8 behavioral tests
- `worker/index.js` - Added `dataDir` to `createHttpServer` options call

## Decisions Made

- Used synchronous `fs.readFileSync` in the log route — log tailing is a small bounded read (max 500 lines parsed), no async benefit
- ISO 8601 timestamp string comparison is safe for `?since=` filter — lexicographic order matches chronological order for ISO dates
- `options.dataDir` defaults to `null` — existing tests pass `null` implicitly and get `{ lines: [] }`, no test breakage

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `/api/logs` endpoint is fully specified and tested — Phase 25 (Log Terminal UI) can poll this endpoint every 2 seconds
- Response contract: `{ lines: [{ ts, level, msg, component, ...extra }] }` — always 200, always JSON
- Phase 25 should implement polling (not SSE) to match this contract

## Self-Check: PASSED

All files present. Both commits (7c71a8b, 5cf5c0d) confirmed in git log.

---
*Phase: 24-log-terminal-api*
*Completed: 2026-03-16*
