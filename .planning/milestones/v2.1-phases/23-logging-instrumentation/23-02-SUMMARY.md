---
phase: 23-logging-instrumentation
plan: "02"
subsystem: infra
tags: [logger, structured-logging, fastify, chromadb, worker]

# Dependency graph
requires:
  - phase: 23-01
    provides: createLogger factory in worker/lib/logger.js
provides:
  - worker/index.js wires createLogger (component=worker), replaces inline log()
  - worker/server/http.js accepts injected logger, logs startup and route errors with component=http
  - worker/server/chroma.js accepts injected logger, structured error logging for init and syncFindings failures
affects:
  - 23-03
  - 24-log-terminal-api
  - 25-log-terminal-ui

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Logger injection pattern: library modules receive logger as last optional arg, fall back to process.stderr.write for test compat"
    - "httpLog() helper: wraps injected logger call, merges component=http into every extra field, no-op when logger absent"

key-files:
  created: []
  modified:
    - worker/index.js
    - worker/server/http.js
    - worker/server/chroma.js

key-decisions:
  - "httpLog helper in http.js merges { component: 'http' } into extra field rather than relying on logger's own component tag — allows the single worker logger instance to be shared while still tagging HTTP lines distinctly"
  - "chroma.js falls back to process.stderr.write when no logger injected — preserves existing test behavior without requiring logger mocks"
  - "Logger instance created in worker/index.js after fs.mkdirSync — ensures logs/ dir exists before first write"

patterns-established:
  - "Logger injection: pass logger as final optional arg (logger = null), set module-level _logger, fall back gracefully"
  - "httpLog wrapper: merge component tag in helper, not in caller — all callers get consistent tagging automatically"

requirements-completed:
  - LOG-INFRA-01
  - LOG-INFRA-02
  - LOG-INFRA-03

# Metrics
duration: 4min
completed: 2026-03-16
---

# Phase 23 Plan 02: Wire Shared Logger into Worker Entry Point and Servers Summary

**Inline log() removed from worker/index.js; HTTP server logs startup and route errors with component=http; ChromaDB errors reported via injected logger with process.stderr.write fallback**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-16T18:47:59Z
- **Completed:** 2026-03-16T18:51:27Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Removed 16-line inline LEVELS/log() block from worker/index.js and replaced with a single createLogger call (component=worker)
- HTTP server now logs startup event and all 500-level route errors with component=http via injected httpLog helper
- ChromaDB init and syncFindings error paths use structured logger when available, fall back to process.stderr.write for test isolation

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace inline log() in worker/index.js** - `4247b18` (feat)
2. **Task 2: Add structured logging to worker/server/http.js** - `072736a` (feat)
3. **Task 3: Replace process.stderr.write in worker/server/chroma.js** - `a2d3065` (feat)
4. **Fix: Add component=http tag to httpLog** - `95b88a1` (fix)

## Files Created/Modified
- `worker/index.js` - Imports createLogger, creates logger instance, replaces all log() calls with logger.log(), passes logger to createHttpServer and initChromaSync
- `worker/server/http.js` - Accepts options.logger, defines httpLog() helper with component=http merge, logs server startup and route errors
- `worker/server/chroma.js` - Adds _logger module variable, accepts logger=null third arg in initChromaSync, structured error reporting with stderr fallback

## Decisions Made
- httpLog helper merges `{ component: 'http', ...extra }` rather than creating a separate component=http logger — keeps a single logger instance in the worker process while still tagging HTTP lines with their own component
- chroma.js does not import createLogger — it receives the instance from index.js, keeping it decoupled from dataDir/logLevel concerns
- _resetForTest() resets _logger to null so test isolation is maintained

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added component=http merge to httpLog extra field**
- **Found during:** Post-task verification (must_haves.artifacts check)
- **Issue:** http.js must_have required `contains: "component"` and description said "component=http structured logging", but initial implementation had no component field in logged lines
- **Fix:** Changed `httpLog` to merge `{ component: 'http', ...extra }` into every log call
- **Files modified:** worker/server/http.js
- **Verification:** `grep -n "component" worker/server/http.js` returns the merge line
- **Committed in:** 95b88a1 (separate fix commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - correctness)
**Impact on plan:** Required for must_have compliance. No scope creep.

## Issues Encountered
- A linter added `import { setScanLogger } from "./scan/manager.js"` and `setScanLogger(logger)` to worker/index.js when the logger was introduced. `setScanLogger` already exists in worker/scan/manager.js — this is a valid forward connection and was kept as-is.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three worker modules (index.js, server/http.js, server/chroma.js) now use the shared logger
- worker/scan/manager.js has setScanLogger wired — Plan 03 can connect scan module logging
- Phase 24 (Log Terminal API) can consume structured log files from worker.log without any further module changes

## Self-Check: PASSED

- worker/index.js: FOUND
- worker/server/http.js: FOUND
- worker/server/chroma.js: FOUND
- 23-02-SUMMARY.md: FOUND
- Commit 4247b18: FOUND
- Commit 072736a: FOUND
- Commit a2d3065: FOUND
- Commit 95b88a1: FOUND

---
*Phase: 23-logging-instrumentation*
*Completed: 2026-03-16*
