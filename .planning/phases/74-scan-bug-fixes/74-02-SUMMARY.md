---
phase: 74-scan-bug-fixes
plan: 02
subsystem: scan
tags: [detectRepoType, docker-compose, go, java, poetry, classification, tdd]

# Dependency graph
requires:
  - phase: 74-01
    provides: SBUG-01 and SBUG-03 scan bug fixes already landed in manager.js
provides:
  - detectRepoType exported and testable via named export
  - docker-compose exemption: service repos with docker-compose.yml correctly classified as service
  - Go library heuristic: go.mod without main.go/cmd/ returns library
  - Java library heuristic: pom.xml/build.gradle without Application.java/*Main.java returns library
  - Poetry library heuristic: pyproject.toml with [tool.poetry] but no [tool.poetry.scripts] returns library
  - _hasServiceEntryPoint and _findJavaEntryPoint helpers
affects:
  - 74-scan-bug-fixes (phase complete after this plan)
  - 76 (scan pipeline hardening — depends on Phase 74)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD red-green cycle: failing tests committed before implementation"
    - "docker-compose exemption: hard infra indicators vs service-entry-point-aware docker-compose check"
    - "_hasServiceEntryPoint helper encapsulates service entry detection logic"
    - "_findJavaEntryPoint recursive search (max depth 5) for Application.java or *Main.java"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/scan/manager.js
    - plugins/ligamen/worker/scan/manager.test.js

key-decisions:
  - "SBUG-02: docker-compose.yml is infra ONLY when no service entry-point detected — docker-compose for local dev must not misclassify Node/Python/Go services as infra"
  - "Hard infra indicators (kustomization.yaml, Chart.yaml, helmfile.yaml) remain unconditional — only docker-compose gets the exemption treatment"
  - "Poetry detection uses [tool.poetry] and [tool.poetry.scripts] (not [project] and [project.scripts]) — addresses Poetry-specific pyproject.toml format"
  - "Java library detection falls back to 'library' when src/main/java/ dir is absent entirely, avoiding false positives for non-standard layouts"

patterns-established:
  - "_hasServiceEntryPoint: checks Node.js scripts.start/serve, main.py/app.py, main.go, cmd/ dir, Java src/main/java, Makefile run/serve targets"
  - "_findJavaEntryPoint: recursive search capped at depth 5 for Application.java or *Main.java"

requirements-completed: [SBUG-02]

# Metrics
duration: 8min
completed: 2026-03-22
---

# Phase 74 Plan 02: Scan Bug Fixes — detectRepoType Summary

**docker-compose misclassification fixed and Go/Java/Poetry library detection added to detectRepoType, with full TDD test coverage**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-22T17:51:26Z
- **Completed:** 2026-03-22T17:59:00Z
- **Tasks:** 1 (TDD: 2 commits — test then feat)
- **Files modified:** 2

## Accomplishments

- detectRepoType is now exported as a named export, directly testable without going through scanRepos
- SBUG-02: docker-compose repos with a service entry-point (Node.js start script, main.py, main.go, cmd/ dir, Java src/main/java) are correctly classified as "service" instead of "infra"
- Go repos with go.mod but no main.go and no cmd/ dir are now classified as "library"
- Java repos with pom.xml/build.gradle but no Application.java or *Main.java are now classified as "library"
- Poetry repos with [tool.poetry] but no [tool.poetry.scripts] in pyproject.toml are now classified as "library"
- 33 tests pass (22 existing + 11 new detectRepoType tests); full phase verification suite (60 tests) passes

## Task Commits

Each task was committed atomically using TDD:

1. **Task 1 (RED): Add failing tests for detectRepoType** - `df93a2a` (test)
2. **Task 1 (GREEN): Implement detectRepoType fixes** - `071b11d` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks have two commits — failing tests committed first (RED), then implementation (GREEN)._

## Files Created/Modified

- `plugins/ligamen/worker/scan/manager.js` - Added `_hasServiceEntryPoint`, `_findJavaEntryPoint` helpers; refactored infra detection; added Go/Java/Poetry library heuristics; exported `detectRepoType`
- `plugins/ligamen/worker/scan/manager.test.js` - Added `detectRepoType` to imports; added `afterEach` to imports; added `mkdirSync` to fs imports; added 11-test `detectRepoType` describe block

## Decisions Made

- docker-compose exemption applies to docker-compose.yml and docker-compose.yaml but NOT to kustomization.yaml, Chart.yaml, or helmfile.yaml — those remain hard infra indicators
- `_hasServiceEntryPoint` is a module-private helper (not exported) — it's an implementation detail of detectRepoType
- Poetry detection targets `[tool.poetry]` + `[tool.poetry.scripts]` (not the generic `[project]` table) — this is the Poetry-specific pattern
- Java library detection returns "library" when `src/main/java/` directory is entirely absent (no need to recurse if the tree doesn't exist)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing `afterEach` in node:test import**
- **Found during:** Task 1 GREEN (running tests after implementation)
- **Issue:** `afterEach` was used in the new detectRepoType describe block but not imported from `node:test`
- **Fix:** Added `afterEach` to the existing `import { test, describe, before, after, beforeEach } from "node:test"` line
- **Files modified:** plugins/ligamen/worker/scan/manager.test.js
- **Verification:** All 33 tests pass after fix
- **Committed in:** 071b11d (GREEN phase feat commit — fixed before commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - missing import caught during test run)
**Impact on plan:** Trivial fix, no scope change.

## Issues Encountered

None — plan executed smoothly once the missing `afterEach` import was caught by the test runner.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 74 plan 02 complete — all SBUG-02 requirements satisfied
- Phase 76 (scan pipeline hardening) is now unblocked — depends on Phase 74 completion
- All three phase 74 test files pass: query-engine-actors, codeowners, manager
