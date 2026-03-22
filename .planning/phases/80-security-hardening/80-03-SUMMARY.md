---
phase: 80-security-hardening
plan: 03
subsystem: infra
tags: [filesystem-lock, concurrency, security, scan, node]

# Dependency graph
requires:
  - phase: 80-security-hardening
    provides: SEC-01 and SEC-02 path-traversal and injection hardening already applied
provides:
  - Filesystem-based per-project scan lock preventing concurrent /ligamen:map corruption
  - acquireScanLock / releaseScanLock / scanLockHash exported from manager.js
  - Stale lock cleanup via PID liveness check (process.kill(pid, 0))
affects: [manager.js, scan pipeline, any caller of scanRepos]

# Tech tracking
tech-stack:
  added: [node:crypto (sha256 hash), node:os (homedir)]
  patterns: [filesystem lock file with PID, try/finally lock release, stale-lock cleanup pattern]

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/scan/manager.js
    - plugins/ligamen/worker/scan/manager.test.js

key-decisions:
  - "Lock scope is the full repoPaths array passed to scanRepos — one lock per invocation set"
  - "Lock path uses $LIGAMEN_DATA_DIR or ~/.ligamen to allow test isolation via env var"
  - "Stale detection uses process.kill(pid, 0) — throws ESRCH when PID is dead, EPERM when alive"
  - "acquireScanLock/releaseScanLock/scanLockHash exported for testability"

patterns-established:
  - "Scan lock file: $LIGAMEN_DATA_DIR/scan-{sha256-12-char}.lock with JSON {pid, startedAt, repoPaths}"
  - "Lock acquire before any async work in scanRepos; release in finally block"

requirements-completed: [SEC-03]

# Metrics
duration: 15min
completed: 2026-03-22
---

# Phase 80 Plan 03: Concurrent Scan Lock Summary

**Filesystem-based per-project scan lock in scanRepos rejecting concurrent /ligamen:map invocations with "Scan already in progress" and cleaning stale locks via PID liveness check**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-22T20:25:00Z
- **Completed:** 2026-03-22T20:40:00Z
- **Tasks:** 1 (TDD)
- **Files modified:** 2

## Accomplishments
- Added `acquireScanLock` / `releaseScanLock` / `scanLockHash` to manager.js with full exports
- scanRepos wraps its entire body in try/finally to guarantee lock release on any exit path
- Stale lock detection: reads PID from lock JSON, calls `process.kill(pid, 0)` — dead PIDs are cleaned automatically
- Lock path follows `$LIGAMEN_DATA_DIR/scan-{12-char-sha256}.lock` pattern; test isolation via env var
- 6 new tests in "concurrent scan locking (SEC-03)" describe block; full 55-test suite passes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add project scan lock with stale detection to manager.js** - `7905ce2` (feat)

**Plan metadata:** _(docs commit follows)_

_Note: TDD tasks — RED (failing test import) confirmed, GREEN (implementation) made all 55 tests pass in single commit_

## Files Created/Modified
- `plugins/ligamen/worker/scan/manager.js` - Added LOCK_DIR constant, scanLockHash, isProcessRunning, acquireScanLock, releaseScanLock helpers; wrapped scanRepos body in try/finally
- `plugins/ligamen/worker/scan/manager.test.js` - Added acquireScanLock/releaseScanLock/scanLockHash imports; new "concurrent scan locking (SEC-03)" describe with 6 tests; updated fs imports

## Decisions Made
- Lock scope covers the full `repoPaths` array (all repos in one scanRepos call share one lock) — prevents the double-beginScan scenario described in SEC-03
- `$LIGAMEN_DATA_DIR` env var used as override for lock directory, enabling test isolation without touching ~/.ligamen
- Exported lock helpers for testability — harmless to expose, enables direct unit testing without going through scanRepos

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SEC-03 complete: concurrent scan corruption is blocked at the filesystem level
- Remaining Phase 80 plans can proceed
- Lock files auto-clean on process exit via finally block; no manual cleanup needed

---
*Phase: 80-security-hardening*
*Completed: 2026-03-22*
