---
phase: 22-canvas-zoom
plan: 01
subsystem: ui
tags: [canvas, hidpi, retina, devicePixelRatio, font-size, graph]

# Dependency graph
requires: []
provides:
  - HiDPI/Retina-crisp canvas rendering via devicePixelRatio scaling in resize() and render()
  - DPR-change watcher (watchDPR) for multi-monitor window moves
  - Larger baseline font sizes (13px labels, 11px subtitles) for readability
affects:
  - 22-canvas-zoom (subsequent plans use the now-correct CSS pixel coordinate system)
  - 26-project-switcher (canvas teardown must preserve the HiDPI resize watcher)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "HiDPI Canvas MDN pattern: canvas.width = cssW * dpr; canvas.style.width = cssW + 'px'; ctx.scale(dpr, dpr)"
    - "matchMedia DPR watcher: re-register on change to handle monitor-to-monitor moves"
    - "Force worker always receives CSS pixel dimensions (divide canvas.width by dpr)"

key-files:
  created:
    - tests/ui/graph-hidpi.test.js
    - tests/ui/renderer-hidpi.test.js
  modified:
    - worker/ui/graph.js
    - worker/ui/modules/renderer.js

key-decisions:
  - "CSS pixel space is the single source of truth for all coordinates — DPR is render-time only"
  - "watchDPR uses matchMedia re-registration pattern (not persistent listener) to handle DPR changes when moving between monitors"
  - "Initial node positions computed from CSS bounds (canvas.width/dpr) not physical pixels"

patterns-established:
  - "Pattern: All coordinate math (state.transform, state.positions, mouse events) stays in CSS pixel space; dpr multiplied only at canvas.width/height assignment and ctx.scale"
  - "Pattern: Force worker receives CSS dimensions — layout bounds must match the coordinate space of positions"

requirements-completed: [CANVAS-01, CANVAS-02]

# Metrics
duration: 3min
completed: 2026-03-16
---

# Phase 22 Plan 01: HiDPI Canvas Fix Summary

**Three-step MDN HiDPI pattern applied to canvas resize and render pipeline — graph nodes and edges now pixel-crisp on Retina/MacBook displays with 13px/11px font sizes for readability**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-16T12:42:49Z
- **Completed:** 2026-03-16T12:45:51Z
- **Tasks:** 2
- **Files modified:** 4 (2 source, 2 test)

## Accomplishments

- `resize()` in graph.js now sets `canvas.width/height = cssW * dpr` (physical pixels) and `canvas.style.width/height` (CSS pixels) — the MDN three-step pattern
- `render()` in renderer.js applies `ctx.scale(dpr, dpr)` as first operation in `ctx.save()` block so all draw calls are in CSS pixel space automatically
- Added `watchDPR()` watcher using matchMedia re-registration for multi-monitor DPR change detection
- Force worker receives CSS dimensions (`canvas.width / dpr`) not physical pixels — preserves layout correctness
- Initial node positions corrected to use CSS pixel bounds (was using physical pixel `canvas.width`)
- Node label base font increased from 11px to 13px; type subtitle increased from 9px to 11px

## Task Commits

Each task was committed atomically:

1. **Task 1: HiDPI resize in graph.js (RED)** - `3cea1da` (test)
2. **Task 1: HiDPI resize in graph.js (GREEN)** - `5f5dacc` (feat)
3. **Task 2: HiDPI render() scaling and font size (RED)** - `45f8504` (test)
4. **Task 2: HiDPI render() scaling and font size (GREEN)** - `d66fbb2` (feat)

_TDD tasks have separate test and implementation commits (test -> feat)_

## Files Created/Modified

- `worker/ui/graph.js` - HiDPI resize(): DPR multiplication, CSS style sizing, watchDPR(), CSS dimensions to force worker
- `worker/ui/modules/renderer.js` - ctx.scale(dpr, dpr) in save/restore block, 13px/11px font sizes
- `tests/ui/graph-hidpi.test.js` - Static source analysis tests for graph.js HiDPI fix (5 assertions)
- `tests/ui/renderer-hidpi.test.js` - Static source analysis tests for renderer.js HiDPI fix (6 assertions)

## Decisions Made

- CSS pixel space is the single coordinate truth — DPR is render-time detail only. No mouse event or transform values multiplied by DPR.
- `watchDPR()` uses matchMedia re-registration (not persistent listener) — this is the correct pattern for DPR change detection; a persistent listener fires stale DPR values.
- Initial node positions were using physical `canvas.width` (Rule 1 bug fix applied inline) — corrected to use `canvas.width / dpr`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Initial node positions used physical canvas.width instead of CSS pixels**
- **Found during:** Task 1 (graph.js HiDPI resize implementation)
- **Issue:** After the resize fix, `canvas.width` became physical pixels (cssW * dpr). The position initialization block `Math.random() * canvas.width` placed nodes at physical pixel coordinates, which are 2x larger than the CSS coordinate space used by state.positions and the force worker.
- **Fix:** Computed `cssBoundsW/H = canvas.width / dpr` and used those for position initialization
- **Files modified:** `worker/ui/graph.js`
- **Verification:** Positions now initialized in same CSS pixel space as state.positions
- **Committed in:** `5f5dacc` (Task 1 feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in position initialization)
**Impact on plan:** Essential correctness fix — without it, initial node positions would be scattered off-screen on Retina displays. No scope creep.

## Issues Encountered

- Test for "old 11px label font removed" was initially too strict — it matched the subtitle's new 11px value. Refined the test assertion to check for absence of old 9px instead. Tests updated in same task commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Canvas rendering is now pixel-crisp on all displays — prerequisite for Phase 22 zoom/pan work
- All coordinate math remains in CSS pixel space — subsequent plans can implement zoom/pan controls without HiDPI concerns
- No blockers for Phase 22 Plan 02

---
*Phase: 22-canvas-zoom*
*Completed: 2026-03-16*

## Self-Check: PASSED

All files verified present, all commits confirmed in git log.
