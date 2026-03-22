---
phase: 78-scan-reliability
plan: 02
subsystem: ui
tags: [graph, actors, dedup, filter, serviceNameToId]

# Dependency graph
requires:
  - phase: 74-scan-bug-fixes
    provides: "SBUG-01 known-service guard in persistFindings (DB layer)"
provides:
  - "Actor dedup filter in graph.js loadProject() using serviceNameToId (UI layer defense in depth)"
  - "Source analysis tests for actor filter in tests/ui/graph-actor-dedup.test.js"
affects: [graph-rendering, actor-hexagons, ui-layer-scan-reliability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Defense-in-depth filtering at UI layer before synthetic node creation"
    - "Source analysis tests using node:test + readFileSync to verify graph.js patterns"

key-files:
  created:
    - tests/ui/graph-actor-dedup.test.js
  modified:
    - plugins/ligamen/worker/ui/graph.js
    - tests/ui/graph-exposes.test.js
    - tests/ui/graph-fit-to-screen.test.js
    - tests/ui/graph-hidpi.test.js
    - tests/ui/renderer-hidpi.test.js

key-decisions:
  - "SREL-02: Filter actors at UI layer (graph.js) using existing serviceNameToId map — no new DB fetch required"
  - "Filter inserted between raw actor assignment (line 107) and synthetic node creation loop — minimal change, both loops auto-benefit"

patterns-established:
  - "UI-layer dedup via serviceNameToId: actor.name in serviceNameToId lookup before synthetic node push"

requirements-completed: [SREL-02]

# Metrics
duration: 4min
completed: 2026-03-22
---

# Phase 78 Plan 02: Actor Dedup Filter Summary

**UI-layer defense in depth: filters phantom actor hexagons whose name matches a known service using existing serviceNameToId map in graph.js loadProject()**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-22T18:02:47Z
- **Completed:** 2026-03-22T18:06:01Z
- **Tasks:** 1 (TDD: RED commit + GREEN commit)
- **Files modified:** 6

## Accomplishments

- Added SREL-02 actor dedup filter in graph.js between raw actor assignment and synthetic node creation loop
- Filter uses the existing serviceNameToId map — no new data fetch
- Both synthetic node loop and synthetic edge loop now iterate only the filtered list
- Created 4 source analysis tests in graph-actor-dedup.test.js — all pass

## Task Commits

1. **Task 1 RED: Create graph-actor-dedup.test.js** - `241e22f` (test)
2. **Task 1 GREEN: Add filter to graph.js + fix test paths** - `6921898` (feat)

## Files Created/Modified

- `tests/ui/graph-actor-dedup.test.js` - 4 source analysis tests verifying actor dedup filter exists
- `plugins/ligamen/worker/ui/graph.js` - SREL-02 filter added after line 107 (raw actor assignment)
- `tests/ui/graph-exposes.test.js` - Fixed broken path (pre-Phase-49 path corrected)
- `tests/ui/graph-fit-to-screen.test.js` - Fixed broken path (pre-Phase-49 path corrected)
- `tests/ui/graph-hidpi.test.js` - Fixed broken path (pre-Phase-49 path corrected)
- `tests/ui/renderer-hidpi.test.js` - Fixed broken path (pre-Phase-49 path corrected)

## Decisions Made

- Filter inserted between the two existing `state.graphData.actors =` assignments so both synthetic loops benefit without modification
- Used `actor.name in serviceNameToId` (not `.hasOwnProperty`) for idiomatic property check on a plain object
- No changes to `/graph` endpoint or getGraph() query — UI-layer only per plan spec

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed broken test file paths in existing tests/ui/*.test.js files**
- **Found during:** Task 1 (TDD RED — when path fix was needed to make tests run at all)
- **Issue:** All 4 existing tests/ui/ graph test files referenced `../../worker/ui/graph.js` (pre-Phase-49 path). After Phase 49 moved source to `plugins/ligamen/`, this path resolved to a non-existent file. The tests were silently broken.
- **Fix:** Updated path to `../../plugins/ligamen/worker/ui/graph.js` in graph-exposes.test.js, graph-fit-to-screen.test.js, graph-hidpi.test.js, and renderer-hidpi.test.js
- **Files modified:** tests/ui/graph-exposes.test.js, tests/ui/graph-fit-to-screen.test.js, tests/ui/graph-hidpi.test.js, tests/ui/renderer-hidpi.test.js
- **Verification:** Tests now load graph.js correctly and pass
- **Committed in:** 6921898 (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - pre-existing bug exposed by path fix)
**Impact on plan:** Necessary for plan's verification command to function. No scope creep.

## Deferred Issues

**graph-fit-to-screen.test.js: 2 stale test assertions (out of scope)**
- Tests "fitToScreen() function is defined" and "fitToScreen() calls render() after updating transform" assert for a named `function fitToScreen()`
- This function was refactored inline into loadProject() in Phase 26 (project-switcher extraction)
- The tests were previously hidden by the broken path (ENOENT) — fixing the path exposed these stale assertions
- Not caused by this plan's changes; out of scope per scope boundary rule
- Logged to deferred-items: recommend updating graph-fit-to-screen.test.js to match current inline implementation

## Issues Encountered

None beyond the pre-existing test path issue described above.

## Next Phase Readiness

- SREL-02 is complete: phantom actor hexagons eliminated at both DB layer (Phase 74 SBUG-01) and UI layer (this plan)
- graph-actor-dedup.test.js establishes the source analysis test pattern for graph.js filter verification
- 2 stale fitToScreen assertions in graph-fit-to-screen.test.js should be addressed in a cleanup plan

---
*Phase: 78-scan-reliability*
*Completed: 2026-03-22*
