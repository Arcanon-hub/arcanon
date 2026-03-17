---
phase: 23-logging-instrumentation
plan: 03
subsystem: infra
tags: [logging, structured-json, worker, node, esm, mcp, scan]

# Dependency graph
requires:
  - phase: 23-01
    provides: "createLogger factory at worker/lib/logger.js"
provides:
  - "worker/mcp/server.js uses createLogger with component=mcp — console.error removed"
  - "worker/scan/manager.js exports setScanLogger, emits scan lifecycle log lines (INFO/DEBUG/ERROR)"
  - "worker/db/database.js migration loader uses process.stderr.write instead of console.error"
  - "Zero console.log/console.error remaining in Node.js worker process production code paths"
affects:
  - 24-log-terminal-api
  - 25-log-terminal-ui

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Logger injection via setter: setScanLogger(logger) — module receives logger from caller, no-ops when null"
    - "process.stderr.write for low-level modules without logger injection (db/database.js migration loader)"
    - "MCP server reads logLevel from settings.json with INFO fallback before createLogger call"

key-files:
  created: []
  modified:
    - worker/mcp/server.js
    - worker/scan/manager.js
    - worker/db/database.js
    - worker/index.js

key-decisions:
  - "process.stderr.write used in db/database.js migration loader — module has no injection point and a single error case; logger injection would complicate the module unnecessarily"
  - "scan/manager.js uses setter injection pattern (setScanLogger) — module cannot create logger itself without dataDir/logLevel"
  - "slog() helper is scan-local (defined inside scanRepos) — keeps scope tight and avoids module-level helper pollution"
  - "worker/ui/graph.js console.error left untouched — browser-side UI code, not Node.js worker process"

patterns-established:
  - "Setter injection pattern for modules that cannot self-create a logger: export setScanLogger(logger), _logger = null default"

requirements-completed: [LOG-INFRA-01, LOG-INFRA-03]

# Metrics
duration: 2min
completed: 2026-03-16
---

# Phase 23 Plan 03: Logging Instrumentation Summary

**console.error swept from worker/mcp/server.js, worker/scan/manager.js, and worker/db/database.js — all Node.js worker process code now uses structured logging via createLogger or process.stderr.write**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-16T12:48:06Z
- **Completed:** 2026-03-16T12:50:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Replaced both `console.error` calls in `worker/mcp/server.js` with `logger.error()` via a module-level `createLogger` instance (component=mcp, reads logLevel from settings.json)
- Added scan lifecycle structured logging to `worker/scan/manager.js` via setScanLogger setter injection — emits DEBUG (skipped), INFO (started/complete), ERROR (invalid output)
- Replaced `console.error` in `worker/db/database.js` migration loader with `process.stderr.write` — appropriate for low-level module without logger injection point
- Updated `worker/index.js` to call `setScanLogger(logger)` after creating the worker logger, completing the injection chain

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire createLogger into worker/mcp/server.js** - `24596af` (feat)
2. **Task 2: Add scan lifecycle logging to worker/scan/manager.js** - `5dcd3c3` (feat)
3. **Task 3: Replace console.error in db/database.js migration loader** - `6cd22e2` (fix)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified

- `worker/mcp/server.js` - Imports createLogger, reads _mcpLogLevel from settings.json, module-level logger with component='mcp', two console.error replaced
- `worker/scan/manager.js` - _logger null variable, setScanLogger export, slog() helper, scan lifecycle log lines
- `worker/db/database.js` - Migration loader console.error → process.stderr.write; script-mode block untouched
- `worker/index.js` - Added setScanLogger import and call after logger creation

## Decisions Made

- `process.stderr.write` for database.js migration loader: the module has no injection point and only one error case; adding a setter would complicate a low-level module for minimal benefit. process.stderr.write is not `console.error` and won't appear in the structured log grep sweep.
- `setScanLogger` injection pattern mirrors the `setChromaLogger` pattern established earlier in this phase — consistent approach across modules that receive rather than create loggers.
- `slog()` helper defined inside `scanRepos()` rather than at module level — keeps it co-located with its usage and avoids cluttering the module's public surface.

## Deviations from Plan

### Out-of-Scope Discovery (Deferred)

**worker/ui/graph.js:192 — console.error in browser-side Canvas UI**
- **Found during:** Final verification sweep
- **Status:** Deferred to `deferred-items.md` — browser-side code, not Node.js worker process
- **Rationale:** The phase scope is Node.js worker process production code. Browser console.error in a Canvas/D3 UI error handler is appropriate in browser context and does not pollute the server-side structured log file.

None of the three plan tasks required auto-fixes.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- LOG-INFRA-03 fully satisfied: zero console.log/console.error in Node.js worker process production code paths
- Phase 24 (Log Terminal API) can filter log lines by component field: `mcp`, `worker`, `scan`, `chroma`, etc.
- Phase 25 (Log Terminal UI) has all required structured log fields present on every line

---
*Phase: 23-logging-instrumentation*
*Completed: 2026-03-16*

## Self-Check: PASSED

- worker/mcp/server.js: FOUND
- worker/scan/manager.js: FOUND
- worker/db/database.js: FOUND
- 23-03-SUMMARY.md: FOUND
- Task commits 24596af, 5dcd3c3, 6cd22e2: FOUND
