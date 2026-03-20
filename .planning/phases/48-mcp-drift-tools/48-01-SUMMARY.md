---
phase: 48-mcp-drift-tools
plan: 01
subsystem: api
tags: [mcp, drift, sqlite, better-sqlite3, nodejs-test, tdd]

# Dependency graph
requires:
  - phase: existing-mcp-server
    provides: server.js with querySearch/queryImpact/queryChanged/queryGraph exports, resolveDb pattern, server.tool() registration pattern
provides:
  - queryDriftVersions function exported from worker/mcp/server.js
  - server.tool('drift_versions') registered in MCP manifest
  - worker/mcp/server-drift.test.js scaffold (Wave 0) for all Phase 48 drift tools
  - createDriftTestDb() and createTempRepo() helpers for Plans 02 and 03
affects: [48-mcp-drift-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Drift helper pattern: getDriftRepos reads repos table; extractXxxVersions reads manifest files from disk paths"
    - "TDD RED/GREEN: test file committed before implementation; tests import named export that does not yet exist"
    - "severity filter pattern: severityOrder map with numeric thresholds, 'all' bypasses filtering"

key-files:
  created:
    - worker/mcp/server-drift.test.js
  modified:
    - worker/mcp/server.js

key-decisions:
  - "Port normalize_version and has_range_specifier from drift-versions.sh to JS helpers in server.js"
  - "repos_scanned counts only repo paths that exist on disk (fs.existsSync), matching shell script behavior"
  - "Severity default=WARN (not CRITICAL) mirrors drift-versions.sh default which suppresses INFO but shows WARN"
  - "drift_versions severity param uses z.enum with .default('WARN'), 'all' shows every level"

patterns-established:
  - "Drift query functions follow same signature as queryImpact/querySearch: async (db, params) => result"
  - "createTempRepo(name, manifestFiles) helper creates real filesystem fixtures for drift tests"

requirements-completed: [MCP-01]

# Metrics
duration: 12min
completed: 2026-03-20
---

# Phase 48 Plan 01: MCP Drift Versions Tool Summary

**drift_versions MCP tool with CRITICAL/WARN/INFO version mismatch detection across repos, porting normalize_version and comparison logic from scripts/drift-versions.sh to JS**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-20T19:12:03Z
- **Completed:** 2026-03-20T19:24:54Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Created `worker/mcp/server-drift.test.js` as the Wave 0 scaffold for all Phase 48 drift tools, including `createDriftTestDb()` and `createTempRepo()` helpers needed by Plans 02 and 03
- Implemented `queryDriftVersions` export with helpers `getDriftRepos`, `normalizeVersion`, `hasRangeSpecifier`, `extractPackageJsonVersions`, `extractGoModVersions`, `extractCargoVersions`
- Registered `server.tool('drift_versions', ...)` in the MCP manifest following the existing tool registration pattern
- All 7 drift tests pass; all 20 existing `server.test.js` tests continue to pass (zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create test scaffold and failing tests for drift_versions** - `f816af2` (test)
2. **Task 2: Implement queryDriftVersions and register drift_versions tool** - `b2cad0d` (feat)

_Note: TDD tasks have two commits: test (RED) then feat (GREEN)_

## Files Created/Modified

- `worker/mcp/server-drift.test.js` - Wave 0 test scaffold with 7 behavior tests for queryDriftVersions, plus createDriftTestDb and createTempRepo helpers for Plans 02 and 03
- `worker/mcp/server.js` - Added drift helper functions (getDriftRepos, normalizeVersion, hasRangeSpecifier, extractPackageJsonVersions, extractGoModVersions, extractCargoVersions, extractAllVersions), queryDriftVersions export, and server.tool('drift_versions') registration

## Decisions Made

- Ported `normalize_version` from shell (`sed 's/^[^0-9a-zA-Z]*//'`) to JS regex (`/^[^0-9a-zA-Z]*/`) to maintain identical semantics
- Default severity `"WARN"` (not `"CRITICAL"`) mirrors the shell script default — agents see version mismatch warnings but INFO (same-version) is suppressed unless explicitly requested
- `repos_scanned` counts only repos whose paths exist on disk, so ghost/deleted repos do not inflate the counter
- Placed all drift helper functions in a clearly marked section in `server.js` with a comment noting they are "shared across drift_versions, drift_types, drift_openapi" for Plans 02 and 03 discoverability

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing npm dependencies**
- **Found during:** Task 1 (running tests to verify RED state)
- **Issue:** `node_modules/` did not exist — `better-sqlite3` was declared in `package.json` but never installed
- **Fix:** Ran `npm install`
- **Files modified:** `node_modules/` (not committed — in .gitignore)
- **Verification:** `node --test worker/mcp/server-drift.test.js` ran and produced correct RED output
- **Committed in:** Not separately committed (npm install output, not source)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking)
**Impact on plan:** npm install was prerequisite for running any tests. No scope creep.

## Issues Encountered

- Background `node --test` processes sometimes produced no output when the combined suite was run; verified each suite independently and confirmed all pass

## Next Phase Readiness

- `createDriftTestDb()` and `createTempRepo()` helpers are ready for Plan 02 (drift_types) and Plan 03 (drift_openapi)
- `getDriftRepos()` and helper functions are already in `server.js` and can be reused by Plans 02 and 03 without modification
- Wave 0 scaffold file `server-drift.test.js` is the correct place for Plans 02 and 03 to add their tests

---
*Phase: 48-mcp-drift-tools*
*Completed: 2026-03-20*
