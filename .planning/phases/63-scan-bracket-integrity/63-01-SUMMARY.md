---
phase: 63-scan-bracket-integrity
plan: 01
subsystem: api
tags: [scan, query-engine, scan-version, bracket, http, fastify]

# Dependency graph
requires: []
provides:
  - POST /scan handler wrapped in beginScan/endScan bracket
  - scanVersionId passed as 4th arg to persistFindings so rows are stamped
  - endScan skipped when persistFindings throws (no stale row deletion on failure)
affects: [64-project-hash-fallback, 65-service-id-collision, 66-agent-interaction]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scan version bracket: beginScan(repoId) → persistFindings(..., scanVersionId) → endScan(repoId, scanVersionId)"
    - "Inner try/catch without finally ensures endScan is only called on success"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/server/http.js
    - plugins/ligamen/worker/server/http.test.js

key-decisions:
  - "endScan is called ONLY when persistFindings succeeds — failed scans leave bracket open (completed_at=NULL) rather than triggering stale-row deletion"
  - "scanVersionId returned by beginScan is threaded through persistFindings as the 4th argument so every row is stamped with a non-null scan_version_id"

patterns-established:
  - "TDD: write failing tests first, confirm RED, then implement to GREEN"

requirements-completed:
  - SCAN-01

# Metrics
duration: 5min
completed: 2026-03-21
---

# Phase 63 Plan 01: Scan Bracket Integrity Summary

**POST /scan now wraps persistFindings in beginScan/endScan bracket so stale rows from prior scans are deleted and every row gets a non-null scan_version_id**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-21T19:20:00Z
- **Completed:** 2026-03-21T19:21:20Z
- **Tasks:** 2 (combined into single TDD cycle)
- **Files modified:** 2

## Accomplishments
- Fixed root cause: persistFindings was called with 3 args (no scanVersionId), causing every row to get scan_version_id=null so endScan's WHERE clause never deleted anything
- Added beginScan(repoId) call before persistFindings in POST /scan handler
- Added endScan(repoId, scanVersionId) call after persistFindings succeeds (success-only path)
- Updated existing test to stub beginScan/endScan so it doesn't throw
- Added two new tests: bracket order verification and endScan-skip-on-failure

## Task Commits

Each task was committed atomically:

1. **Tasks 1+2: Wrap POST /scan in beginScan/endScan bracket + tests** - `8a79893` (feat)

**Plan metadata:** (see final commit below)

_Note: Both TDD tasks combined — tests written and implementation done in one commit because both files changed together_

## Files Created/Modified
- `plugins/ligamen/worker/server/http.js` - POST /scan handler now calls beginScan → persistFindings(4 args) → endScan
- `plugins/ligamen/worker/server/http.test.js` - Updated existing test + 2 new bracket verification tests (27 total, all pass)

## Decisions Made
- endScan is called ONLY on success path (not in finally): a failed scan leaves the scan_versions row with completed_at=NULL rather than triggering deletion of valid prior-scan rows. This is the safe choice.
- scanVersionId is passed as 4th arg to persistFindings so the DB stamping works correctly and endScan's WHERE clause can match rows.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 63 Plan 01 complete. Stale-row cleanup now works end-to-end: beginScan creates a version, persistFindings stamps rows with it, endScan deletes rows from prior versions.
- Phase 64 (project hash fallback) and Phase 65 (service ID collision) can now execute in parallel.

---
*Phase: 63-scan-bracket-integrity*
*Completed: 2026-03-21*
