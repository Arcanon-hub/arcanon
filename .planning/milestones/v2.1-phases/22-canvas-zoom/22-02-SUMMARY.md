---
phase: 22-canvas-zoom
plan: "02"
subsystem: ui
tags: [canvas, zoom, pan, trackpad, wheel-event, interactions]

# Dependency graph
requires: []
provides:
  - Smooth exponential wheel zoom (Math.pow(2, delta) formula replacing fixed 1.1/0.9 step)
  - ctrlKey split: pinch/Ctrl+scroll zooms, two-finger scroll pans
  - Lower zoom bound 0.15 (was 0.2) for large graphs
affects:
  - 22-canvas-zoom
  - 26-project-switcher (setupInteractions refactor work)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ctrlKey=true = zoom gesture (pinch or Ctrl+scroll); ctrlKey=false = pan gesture"
    - "D3-style exponential delta: rawDelta = -deltaY * (deltaMode===1 ? 0.05 : deltaMode ? 1 : SENSITIVITY)"
    - "Math.pow(2, rawDelta) for exponential zoom feel"

key-files:
  created:
    - worker/ui/modules/interactions.test.js
  modified:
    - worker/ui/modules/interactions.js

key-decisions:
  - "ctrlKey=false path pans (not zooms) — mouse wheel users use Ctrl+scroll to zoom, which is the standard shortcut"
  - "SENSITIVITY=0.001 (half of D3's 0.002) for gentler zoom speed on high-resolution trackpads"
  - "Lower zoom bound relaxed to 0.15 from 0.2 to accommodate large graphs with many nodes"

patterns-established:
  - "Wheel event: always check e.ctrlKey to distinguish pinch-zoom from two-finger-scroll"
  - "deltaMode normalization: deltaMode===1 (line) multiply by 0.05, deltaMode===2 (page) multiply by 1, deltaMode===0 (pixel) multiply by SENSITIVITY"

requirements-completed:
  - ZOOM-01
  - ZOOM-02

# Metrics
duration: 1min
completed: 2026-03-16
---

# Phase 22 Plan 02: Smooth Wheel Zoom + Pan/Zoom Split Summary

**Replaced coarse 10% fixed zoom step with smooth Math.pow(2, delta) exponential formula and split wheel handler so trackpad two-finger scroll pans while pinch-to-zoom and Ctrl+scroll zoom.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-16T12:42:50Z
- **Completed:** 2026-03-16T12:44:07Z
- **Tasks:** 1
- **Files modified:** 1 (+ 1 test file created)

## Accomplishments
- Replaced coarse 1.1/0.9 fixed step with Math.pow(2, rawDelta) exponential formula — smooth zoom at any trackpad sensitivity
- Added ctrlKey split: pinch gesture and Ctrl+scroll zoom; two-finger scroll and plain mouse wheel pan
- Lowered minimum zoom bound from 0.2 to 0.15 for large dependency graphs
- Added deltaMode normalization for cross-platform wheel event consistency
- Preserved zoom-to-cursor calculation (ratio * offset formula) in zoom path

## Task Commits

Each task was committed atomically (TDD: test then feat):

1. **Task 1 (RED): Add failing tests** - `deff5c7` (test)
2. **Task 1 (GREEN): Implement wheel handler** - `53289b1` (feat)

_TDD tasks have multiple commits (test → feat)_

## Files Created/Modified
- `worker/ui/modules/interactions.js` - Replaced wheel listener with ctrlKey-split smooth delta formula
- `worker/ui/modules/interactions.test.js` - Pattern-based tests for wheel handler requirements

## Decisions Made
- ctrlKey=false maps to pan (not zoom) — plain mouse wheel will pan rather than zoom; mouse users use Ctrl+scroll (standard shortcut) to zoom. This is the correct split per browser conventions.
- SENSITIVITY set to 0.001 (half of D3's default 0.002) for more controlled zoom feel on high-DPI trackpads
- deltaMode normalization included for compatibility: line mode (1) gets 0.05 multiplier, page mode (2) gets 1, pixel mode (0) gets SENSITIVITY

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wheel zoom is smooth and gesture-aware; ready for HiDPI/devicePixelRatio work (plan 22-03 if it exists)
- Phase 26 (Project Switcher) still requires named-handler refactor of setupInteractions() — unchanged by this plan

---
*Phase: 22-canvas-zoom*
*Completed: 2026-03-16*
