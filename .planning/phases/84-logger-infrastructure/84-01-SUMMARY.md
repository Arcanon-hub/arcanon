---
phase: 84-logger-infrastructure
plan: 01
subsystem: infra
tags: [logger, log-rotation, tty, nodejs, fs]

# Dependency graph
requires: []
provides:
  - "createLogger with size-based rotation (10 MB, keeps 3 rotated files)"
  - "TTY-aware stderr: only writes when process.stderr.isTTY is truthy"
  - "Test coverage for LOG-01 (rotation) and LOG-02 (daemon stderr dedup)"
affects: [phase-85, phase-86, phase-87]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Size-based log rotation via fs.statSync + renameSync chain, zero dependencies"
    - "TTY-awareness via process.stderr.isTTY guard before stderr.write"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/lib/logger.js
    - tests/worker/logger.test.js

key-decisions:
  - "Rotation deletes .3 (oldest) on each rotation to keep exactly .1, .2, .3 — no .4 ever created"
  - "rotateIfNeeded() called after level-filter so suppressed messages do not trigger rotation"
  - "TTY guard uses process.stderr.isTTY — falsy in daemon/nohup, truthy in interactive terminal"

patterns-established:
  - "Rotation pattern: delete oldest, rename chain down, active becomes .1"
  - "TTY-aware stderr: if (process.stderr.isTTY) { process.stderr.write(...) }"

requirements-completed: [LOG-01, LOG-02]

# Metrics
duration: 8min
completed: 2026-03-23
---

# Phase 84 Plan 01: Logger Infrastructure Summary

**Size-based log rotation (10 MB, 3 rotated files) and daemon-safe TTY-conditional stderr added to logger.js with zero new dependencies**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-23T10:37:00Z
- **Completed:** 2026-03-23T10:45:09Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Fixed broken ESM import path in tests/worker/logger.test.js (was pointing to non-existent path)
- Added 5 new tests covering LOG-01 rotation (threshold, max-3-files, no-rotation) and LOG-02 TTY (falsy/truthy)
- Implemented `rotateIfNeeded()` — deletes .3, renames .2→.3, .1→.2, active→.1 on each >= 10 MB write
- Guarded `process.stderr.write` behind `if (process.stderr.isTTY)` to prevent double-write in daemon mode
- All 15 tests pass (10 original + 5 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix test import path and add failing tests (TDD RED)** - `fef9906` (test)
2. **Task 2: Implement LOG-01 rotation and LOG-02 TTY suppression (TDD GREEN)** - `ff8e628` (feat)

_Note: TDD tasks had two commits (test RED → feat GREEN)_

## Files Created/Modified
- `plugins/ligamen/worker/lib/logger.js` - Added MAX_LOG_BYTES, rotateIfNeeded(), isTTY guard
- `tests/worker/logger.test.js` - Fixed import path, added 5 new tests for LOG-01 and LOG-02

## Decisions Made
- Rotation keeps at most 3 rotated files by deleting .3 on each rotation (not renaming to .4). The plan described a rename-to-.4 pattern but the must_have truth and tests both require .4 to never exist — delete-oldest is the correct interpretation.
- Import path corrected to `../../plugins/ligamen/worker/lib/logger.js` (two levels up from tests/worker/ to reach repo root, then into plugins/). Plan specified `../plugins/ligamen` which would be one level too shallow.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected rotation algorithm to delete .3 instead of renaming to .4**
- **Found during:** Task 2 (implementation)
- **Issue:** Plan's rotation algorithm said rename `.3 → .4` but must_have truth says "at most 3 rotated files (.1, .2, .3) — .4 deleted on next rotation" and test asserts `.4` does NOT exist after rotation
- **Fix:** Changed rotation to delete `.3` (oldest), then rename `.2→.3`, `.1→.2`, active→`.1`
- **Files modified:** plugins/ligamen/worker/lib/logger.js
- **Verification:** "rotation keeps at most 3 rotated files" test passes; all 15 tests green
- **Committed in:** ff8e628

**2. [Rule 1 - Bug] Corrected ESM import path depth in test file**
- **Found during:** Task 1 (TDD RED run)
- **Issue:** Plan specified `../plugins/ligamen/worker/lib/logger.js` but test is in `tests/worker/`, requiring `../../plugins/ligamen/worker/lib/logger.js` (two levels up to repo root)
- **Fix:** Used `../../plugins/ligamen/worker/lib/logger.js` — confirmed by successful test run
- **Files modified:** tests/worker/logger.test.js
- **Verification:** All 10 original tests passed immediately after path fix
- **Committed in:** fef9906

**3. [Rule 1 - Bug] Fixed test stub to include newline for correct line counting**
- **Found during:** Task 2 (GREEN verification)
- **Issue:** "does not rotate" test wrote `"x"` (no newline) as stub, causing the appended JSON line to concat with it — content split gave 1 line instead of 2
- **Fix:** Changed stub to `"x\n"` so the stub and the new log line are separate lines
- **Files modified:** tests/worker/logger.test.js
- **Verification:** "does not rotate when file is below 10 MB" test passes
- **Committed in:** ff8e628

---

**Total deviations:** 3 auto-fixed (3 bugs)
**Impact on plan:** All fixes were necessary for correctness. The rotation algorithm fix aligns implementation with the stated behavioral truth. The path and stub fixes resolved test execution errors. No scope creep.

## Issues Encountered
- Plan's rotation description (rename .3→.4) contradicted the must_have truth (at most 3 files, .4 never exists). Resolved by following the must_have truth and test assertions, which are the authoritative spec.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 85 (ERR-01, ERR-02, LOG-03): logger.js is ready — error sites in http.js and mcp/server.js can now use the updated logger with rotation and daemon-safe stderr
- Phase 86 (SCAN-01, SCAN-02, SCAN-03): scan lifecycle logging will use the same createLogger
- Phase 87 (ADOPT-01): QueryEngine optional logger param can inject this logger

---
*Phase: 84-logger-infrastructure*
*Completed: 2026-03-23*
