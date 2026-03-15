---
phase: 19-repo-discovery-user-confirmation
plan: 01
subsystem: discovery
tags: [node-js, repo-discovery, config, filesystem, esm, node-test]

# Dependency graph
requires:
  - phase: 18-agent-scan-prompt
    provides: scan-manager that discovery feeds into (via Phase 20 command layer)
provides:
  - Pure ESM repo-discovery module with loadFromConfig, discoverNew, deduplicateRepos, saveConfirmed, isViewOnlyMode, formatRepoList
  - Unit tests (node:test) covering all discovery scenarios — 16 tests, zero failures
  - allclear.config.json linked-repos round-trip with non-destructive key preservation
affects:
  - 20-map-command-layer (primary consumer of repo-discovery exports)
  - allclear.config.json linked-repos lifecycle

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ESM module with named exports — no default export, no side effects at load time"
    - "node:test + node:assert/strict for unit tests — no external test framework"
    - "fs.mkdtempSync + cleanup per test for temp dir fixture isolation"
    - "config wins over discovered when deduplicating same path (source priority)"

key-files:
  created:
    - worker/repo-discovery.js
    - worker/repo-discovery.test.js
  modified: []

key-decisions:
  - "Used ESM (import/export) not CommonJS — package.json has type:module, all worker files use ESM"
  - "discoverNew checks 5 manifest files: package.json, pyproject.toml, go.mod, Cargo.toml, pom.xml"
  - "saveConfirmed appends newline to JSON output for clean git diffs"
  - "isViewOnlyMode uses Array.includes for exact match — --viewer does not match --view"

patterns-established:
  - "Repo object shape: { path, name, source: 'config'|'discovered', isNew: boolean }"
  - "Discovery sources: config (priority 1), parent dir scan (priority 3) — memory context (priority 2) handled by Phase 20 caller"

requirements-completed: [DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06]

# Metrics
duration: 2min
completed: 2026-03-15
---

# Phase 19 Plan 01: Repo Discovery Module Summary

**Pure ESM repo-discovery module with parent-dir scanning, config round-trip, and [NEW] marker formatting — 16 unit tests, zero failures**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-15T19:15:23Z
- **Completed:** 2026-03-15T19:17:05Z
- **Tasks:** 2 (Task 1: TDD implementation, Task 2: formatRepoList — co-implemented in same TDD cycle)
- **Files modified:** 2

## Accomplishments

- `worker/repo-discovery.js` — pure ESM module with 6 named exports, zero side effects at load time
- `worker/repo-discovery.test.js` — 16 unit tests covering all discovery scenarios using node:test
- Round-trip test confirms allclear.config.json persistence merges linked-repos without destroying other keys

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests** - `989af94` (test)
2. **Task 1+2 GREEN: Implementation** - `2bdf448` (feat)

_Note: TDD tasks have multiple commits (test → feat). formatRepoList (Task 2) was implemented in the same GREEN cycle as Task 1._

## Files Created/Modified

- `worker/repo-discovery.js` — Repo discovery module: loadFromConfig, discoverNew, deduplicateRepos, saveConfirmed, isViewOnlyMode, formatRepoList
- `worker/repo-discovery.test.js` — 16 unit tests for all discovery scenarios

## Decisions Made

- Used ESM (`import/export`) instead of the CommonJS `require/module.exports` mentioned in plan action prose — the package has `"type": "module"` and all existing worker files use ESM. Using CJS would have caused import failures from other ESM worker files.
- Tasks 1 and 2 share a single GREEN commit because `formatRepoList` was small enough to implement in the same TDD cycle without a separate RED phase — tests for it were included in the initial test file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used ESM syntax instead of CommonJS**
- **Found during:** Task 1 (pre-implementation check)
- **Issue:** Plan action said "CommonJS module (require/module.exports)" but `package.json` has `"type": "module"` and every existing worker file uses ESM. Using CJS would cause `ERR_REQUIRE_ESM` or import failures.
- **Fix:** Implemented with ESM `export function` syntax — matches actual project convention
- **Files modified:** `worker/repo-discovery.js`
- **Verification:** `node --test worker/repo-discovery.test.js` — all 16 tests pass
- **Committed in:** `2bdf448`

---

**Total deviations:** 1 auto-fixed (Rule 1 — module system mismatch between plan text and project reality)
**Impact on plan:** Required for correctness. No scope creep.

## Issues Encountered

None — implementation was straightforward once module system was corrected.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `worker/repo-discovery.js` is ready to be imported by Phase 20 command layer
- All 6 exports (loadFromConfig, discoverNew, deduplicateRepos, saveConfirmed, isViewOnlyMode, formatRepoList) tested and functional
- Phase 20 should call: loadFromConfig → discoverNew → deduplicateRepos → (user confirms) → saveConfirmed

---
*Phase: 19-repo-discovery-user-confirmation*
*Completed: 2026-03-15*
