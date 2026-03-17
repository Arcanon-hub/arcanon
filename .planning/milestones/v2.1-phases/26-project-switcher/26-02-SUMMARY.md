---
phase: 26-project-switcher
plan: "02"
subsystem: ui
tags: [canvas, project-switcher, dropdown, teardown, event-listeners, history-api]

# Dependency graph
requires:
  - phase: 26-01
    provides: teardownInteractions(canvas) export and loadProject(hash, canvas, fitToScreen) from graph.js
  - phase: 22-canvas-zoom
    provides: setupInteractions(), force worker lifecycle, canvas rendering

provides:
  - initProjectSwitcher(currentHash) exported from project-switcher.js — fetches /projects, populates #project-select, wires onchange
  - onProjectChange handler — terminates force worker, tears down listeners, resets state, updates URL, calls loadProject
  - In-place project switching: selecting a project swaps the graph without a page reload
  - Resilient loadProject: canvas and fitToScreen params are now optional (DOM fallback)

affects:
  - Future plans that call loadProject() from outside graph.js init() closure

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Teardown-before-load pattern: terminate worker + teardownInteractions + state reset before calling loadProject
    - history.replaceState for URL sync without navigation
    - Optional param DOM fallback: loadProject(hash, canvas?, fitToScreen?) — canvas defaults to getElementById when omitted

key-files:
  created: []
  modified:
    - worker/ui/modules/project-switcher.js
    - worker/ui/graph.js

key-decisions:
  - "project-switcher calls loadProject(hash) without canvas/fitToScreen — graph.js falls back to getElementById('graph-canvas') so the call is safe"
  - "fitToScreen addEventListener guarded with if(fitToScreen) — project-switcher omits it; fit-btn keeps working on initial load where it is wired by init()"
  - "Sort projects by serviceCount desc — most active projects appear first in the dropdown"
  - "Keep transform state across project switch — user may want same zoom level; only reset graphData/positions/selection"

patterns-established:
  - "loadProject optional canvas: pass canvas from closure when available; DOM fallback when called outside init()"
  - "Project switch teardown order: stop worker message → terminate worker → teardownInteractions → reset state → replaceState URL → loadProject"

requirements-completed:
  - PROJ-01

# Metrics
duration: 10min
completed: 2026-03-16
---

# Phase 26 Plan 02: Project Switcher Summary

**Persistent toolbar dropdown that switches the service dependency graph in place — zero page reload, full event listener teardown and force worker termination between projects**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-16T~session
- **Completed:** 2026-03-16
- **Tasks:** 2 (1 auto + 1 human-verify)
- **Files modified:** 2

## Accomplishments

- Replaced the no-op `initProjectSwitcher` stub with full implementation: fetches `/projects`, sorts by `serviceCount` desc, populates `#project-select` with folder names (last segment of `projectRoot`), marks the current project selected, unhides the dropdown
- `onProjectChange` performs the full teardown + reload sequence: sends `{type:'stop'}` to force worker, terminates it, calls `teardownInteractions(canvas)`, resets `graphData`/`positions`/`selectedNodeId`/`blastNodeId`/`blastSet`/`blastCache`, syncs URL via `history.replaceState`, then calls `loadProject(newHash)`
- Made `loadProject()` safe to call without `canvas` and `fitToScreen` arguments — applies DOM fallback and conditional guard so the function works both from `init()` and from project-switcher
- Human checkpoint approved: dropdown visible, in-place switching works, URL updates, no duplicate listeners, no page reload

## Task Commits

1. **Task 1: Implement project-switcher.js — populate dropdown, wire onchange with full teardown** - `9c314b3` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `worker/ui/modules/project-switcher.js` - Full implementation: initProjectSwitcher + onProjectChange with teardown sequence
- `worker/ui/graph.js` - canvas DOM fallback in loadProject; fitToScreen addEventListener guard

## Decisions Made

- `loadProject` receives `canvas` and `fitToScreen` as optional parameters — when called from project-switcher (outside init's closure), it falls back to `document.getElementById('graph-canvas')` for canvas and skips the fitToScreen listener wiring. The Fit button listener wired in `init()` persists unchanged.
- Transform (`state.transform.x/y/scale`) is intentionally preserved across project switches — the user's current zoom level and pan position carry over, which feels natural when the new project has a similar graph density.
- Early-exit guard `if (newHash === state.currentProject) return` prevents redundant teardown+reload if the user re-selects the same project already loaded.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] loadProject canvas parameter crash when called without canvas argument**
- **Found during:** Task 1 (implementing onProjectChange)
- **Issue:** `loadProject(hash, canvas, fitToScreen)` uses `canvas.width` at line 84 — calling it with only `hash` (as project-switcher does) would throw `TypeError: Cannot read properties of undefined (reading 'width')`
- **Fix:** Added `if (!canvas) canvas = document.getElementById('graph-canvas')` at the top of loadProject; added `if (fitToScreen)` guard around the fit-btn addEventListener
- **Files modified:** worker/ui/graph.js
- **Verification:** grep confirmed both guards present; consistent with plan's own fallback note ("If the circular import causes a runtime error… resolve it")
- **Committed in:** 9c314b3 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug)
**Impact on plan:** Necessary for correctness — without it the dropdown would crash on first use. No scope creep.

## Issues Encountered

The plan's code sample calls `await loadProject(newHash)` (hash only) but `loadProject`'s actual signature requires canvas to compute initial node positions. Applied Rule 1 fix inline — DOM fallback makes the call safe without changing the function's contract for callers that do pass canvas.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 26 is complete. Both plans delivered:
  - Plan 26-01: named handler teardown + loadProject extraction
  - Plan 26-02: full project switcher with dropdown, teardown, and in-place reload
- The `/projects` endpoint (from Phase 24 HTTP server) is the only runtime dependency — no new infrastructure required
- Known: if worker tracks only one project, dropdown shows one option; selecting it is a no-op (early-exit guard fires)

---
*Phase: 26-project-switcher*
*Completed: 2026-03-16*
