---
phase: 55-scan-version-api
plan: 01
subsystem: api
tags: [sqlite, better-sqlite3, fastify, graph-api, scan-versions]

# Dependency graph
requires: []
provides:
  - "getGraph() selects s.scan_version_id on every service row"
  - "getGraph() selects c.scan_version_id on every connection row"
  - "getGraph() computes and returns latest_scan_version_id (MAX across services, null if all null)"
  - "GET /graph response body carries scan_version_id per service and connection, plus top-level latest_scan_version_id"
affects: [56-what-changed-overlay]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL column addition: append to existing SELECT list without restructuring query"
    - "JS reduce pattern for nullable MAX computation"
    - "Plain spread { ...graph, boundaries } in /graph handler passes new fields automatically"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/db/query-engine.js
    - plugins/ligamen/worker/server/http.test.js

key-decisions:
  - "55-01: http.js required no changes — plain spread { ...graph, boundaries } passes latest_scan_version_id automatically"
  - "55-01: latest_scan_version_id computed in getGraph() at DB layer, not HTTP layer — single source of truth"

patterns-established:
  - "Nullable MAX via reduce: (max, s) => (s.scan_version_id != null && ...) ? s.scan_version_id : max"

requirements-completed: [GRAPH-04]

# Metrics
duration: 5min
completed: 2026-03-21
---

# Phase 55 Plan 01: Scan Version API Summary

**scan_version_id exposed per service and connection in /graph response, plus computed latest_scan_version_id at top level — data contract for Phase 56 What-Changed Overlay**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-21T11:16:53Z
- **Completed:** 2026-03-21T11:21:28Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended getGraph() SQL to select `s.scan_version_id` on services and `c.scan_version_id` on connections
- Added `latest_scan_version_id` computation (nullable reduce MAX) and included it in getGraph() return value
- Confirmed http.js /graph handler required no changes (plain spread passes new fields through automatically)
- Added 3 new http.test.js tests covering scan_version_id per service, per connection, and latest_scan_version_id (null and MAX cases)
- All 25 http tests pass (22 existing + 3 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add scan_version_id to getGraph() SQL queries** - `d832198` (feat)
2. **Task 2: Pass scan_version_id through /graph HTTP handler and add tests** - `35e6076` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `plugins/ligamen/worker/db/query-engine.js` - Added s.scan_version_id and c.scan_version_id to SELECT lists; computed latest_scan_version_id; updated return statement
- `plugins/ligamen/worker/server/http.test.js` - Added 3 new tests for scan_version_id on services, connections, and latest_scan_version_id at top level

## Decisions Made
- http.js required no changes — the handler already uses `{ ...graph, boundaries }` spread which passes all getGraph() fields through automatically
- latest_scan_version_id is computed at the DB/query-engine layer (not HTTP layer) keeping the data contract in one place

## Deviations from Plan

None - plan executed exactly as written.

**Note:** `query-engine-upsert.test.js` has a pre-existing failure (`SqliteError: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`) that existed before this plan. This is out of scope and deferred to `deferred-items.md`.

## Issues Encountered
- Pre-existing failure in `query-engine-upsert.test.js` (SqliteError on ON CONFLICT clause) — existed before this plan, not caused by these changes. Noted but out of scope per deviation rules.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 56 (What-Changed Overlay) can now read `scan_version_id` per service/connection and `latest_scan_version_id` from GET /graph to determine which items belong to the latest scan
- Data contract fully delivered: services array items have scan_version_id, connections array items have scan_version_id, top-level latest_scan_version_id is the MAX value

---
*Phase: 55-scan-version-api*
*Completed: 2026-03-21*
