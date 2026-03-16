---
phase: 28-scan-version-bracket
plan: "02"
subsystem: scan
tags: [scan-versioning, manager, sqlite, tdd]

requires:
  - phase: 28-01
    provides: beginScan/endScan/persistFindings(scanVersionId) on QueryEngine

provides:
  - scanRepos loop with full beginScan/endScan bracket wiring
  - persistFindings moved into scanRepos (manager owns persistence end-to-end)
  - TDD tests for bracket call-order, skip-mode, and parse-failure behavior

affects: [worker/scan/manager.js, tests/worker/scan-bracket.test.js]

tech-stack:
  added: []
  patterns: [scan-bracket-pattern, tdd-red-green]

key-files:
  created:
    - tests/worker/scan-bracket.test.js
  modified:
    - worker/scan/manager.js
    - worker/scan/manager.test.js

key-decisions:
  - "persistFindings is called inside scanRepos (not by the caller) — manager owns persistence end-to-end"
  - "setRepoState is no longer called directly by scanRepos — persistFindings handles repo state internally"
  - "beginScan is called even when parse later fails — scan was started, but endScan not called so prior data survives"

patterns-established:
  - "Bracket pattern: beginScan before agent, persistFindings+endScan after success, endScan skipped on failure"
  - "Mock queryEngine pattern: include beginScan/persistFindings/endScan stubs for all scanRepos tests"

requirements-completed: [SCAN-03]

duration: 7min
completed: 2026-03-16
---

# Phase 28 Plan 02: Scan Version Bracket Manager Wiring Summary

**`scanRepos` now wraps each non-skip agent invocation in a `beginScan`/`endScan` bracket, making re-scans atomic — stale rows are deleted after a successful persist, failed scans leave prior data intact.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-16T15:25:42Z
- **Completed:** 2026-03-16T15:32:00Z
- **Tasks:** 1 auto + 1 human-verify checkpoint
- **Files modified:** 3

## Accomplishments

- Wired `beginScan(repo.id)` before agent invocation in the `scanRepos` for...of loop
- Moved `persistFindings` call into `scanRepos` (was previously the caller's responsibility) — manager now owns persistence end-to-end
- `endScan(repo.id, scanVersionId)` called after `persistFindings` on the success path only
- Parse failure leaves `endScan` uncalled — prior scan data remains intact (stale rows not deleted)
- Skip mode bypasses the bracket entirely — no scan version row created for no-op scans
- All three required test suites pass: 17 + 15 + 3 = 35 tests, 0 failures

## Task Commits

Each task was committed atomically:

1. **TDD RED: Failing bracket tests** - `b0ef3e6` (test)
2. **TDD GREEN: Wire beginScan/endScan bracket** - `5de2a4d` (feat)

**Plan metadata:** (this commit) (docs: complete plan)

_Note: TDD tasks have two commits (test → feat)_

## Files Created/Modified

- `tests/worker/scan-bracket.test.js` — New test file: 3 tests covering full-mode call order, skip-mode, and parse-failure bracket behavior using mock queryEngine
- `worker/scan/manager.js` — Bracket wiring: `beginScan` before agent, `persistFindings`+`endScan` on success, removed direct `setRepoState` call
- `worker/scan/manager.test.js` — Updated mock to include `beginScan`/`persistFindings`/`endScan`; updated one test that asserted `setRepoStateCalled` to assert `persistFindingsCalled`

## Decisions Made

- `persistFindings` is now called inside `scanRepos` rather than by the HTTP handler. The `/scan` POST endpoint in `http.js` remains unchanged — it handles externally-submitted pre-computed findings (a different call path).
- `setRepoState` is no longer called directly by `scanRepos` — `persistFindings` sets repo state internally on the real QueryEngine, so the mock was updated to drop the setRepoState assertion.
- `beginScan` is invoked even when the agent later fails to parse — the scan was started, but `endScan` is deliberately omitted so the `scan_versions` row remains incomplete and prior data survives.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated manager.test.js mock and test assertion after setRepoState removed**
- **Found during:** Task 1 (GREEN phase verification)
- **Issue:** Existing `manager.test.js` mock lacked `beginScan`/`persistFindings`/`endScan`, causing `TypeError: queryEngine.beginScan is not a function` on 3 tests. One test also asserted `setRepoStateCalled`, which is no longer valid since `persistFindings` owns repo state.
- **Fix:** Added stub methods to `makeQueryEngine()`; updated the "successful scan" test to assert `persistFindingsCalled` instead of `setRepoStateCalled`.
- **Files modified:** `worker/scan/manager.test.js`
- **Verification:** All 14 manager.test.js tests pass after fix.
- **Committed in:** `5de2a4d` (Task 1 feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — pre-existing test mock incompatible with new interface)
**Impact on plan:** Essential correctness fix — no scope creep.

## Issues Encountered

None — implementation matched the plan's action description exactly.

## Next Phase Readiness

- SCAN-03 fully addressed: scan version bracket is complete end-to-end (schema in 28-01, manager wiring in 28-02)
- Phase 28 is complete — all scan data integrity work shipped
- Re-scans now atomically replace prior data; failed scans leave old data intact

## Self-Check: PASSED

- [x] `tests/worker/scan-bracket.test.js` exists (3 tests)
- [x] `worker/scan/manager.js` modified with bracket wiring
- [x] Commit b0ef3e6 exists (RED: failing tests)
- [x] Commit 5de2a4d exists (GREEN: implementation)
- [x] All 35 tests pass (17 + 15 + 3 = 35, 0 failures)

---
*Phase: 28-scan-version-bracket*
*Completed: 2026-03-16*
