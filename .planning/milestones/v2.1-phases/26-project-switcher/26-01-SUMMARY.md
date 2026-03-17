---
phase: 26-project-switcher
plan: "01"
subsystem: ui
tags: [canvas, interactions, event-handlers, refactor, module-scope]

# Dependency graph
requires:
  - phase: 22-canvas-zoom
    provides: interactions.js with wheel handler and canvas event setup

provides:
  - teardownInteractions(canvas) exported from interactions.js — removes all 6 canvas listeners using named function refs
  - Named module-scope handlers: onMouseMove, onMouseDown, onMouseUp, onClick, onWheel, onMouseLeave
  - loadProject(hash, canvas, fitToScreen) exported from graph.js — full data-fetch + force-simulation startup
  - state.currentProject field — tracks active project hash
  - project-switcher.js stub — safe import target for Plan 26-02

affects:
  - 26-02 (project-switcher implementation imports teardownInteractions and loadProject)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Module-scope named event handler pattern — handlers declared outside setup function so removeEventListener can match reference
    - _canvas/_tooltip module refs — set at setup time, referenced by named handlers to avoid stale closure
    - _detailCloseWired guard — idempotent DOM listener attachment across multiple loadProject() calls
    - loadProject(hash, canvas, fitToScreen) as extracted async entry point — enables project switching without page reload

key-files:
  created:
    - worker/ui/modules/project-switcher.js
  modified:
    - worker/ui/modules/interactions.js
    - worker/ui/modules/state.js
    - worker/ui/graph.js
    - worker/ui/modules/interactions.test.js

key-decisions:
  - "Named handlers at module scope (not inside setupInteractions) so removeEventListener can match the exact function reference"
  - "_canvas and _tooltip stored as module-level refs, set in setupInteractions, referenced by named handlers"
  - "loadProject signature includes canvas and fitToScreen parameters — init() passes its own closure refs"
  - "loadProject resolves ?hash= param always — project-switcher always passes a hash from /projects response"
  - "_detailCloseWired boolean guard prevents duplicate detail-close listeners on repeated loadProject calls"

patterns-established:
  - "Named-handler teardown pattern: declare handlers at module scope, register in setup(), deregister in teardown()"
  - "Extracted async load function: init() orchestrates lifecycle, loadProject() owns data + simulation + interaction wiring"

requirements-completed:
  - PROJ-01

# Metrics
duration: 15min
completed: 2026-03-16
---

# Phase 26 Plan 01: Project Switcher Prerequisites Summary

**Named canvas event handlers + teardownInteractions() export + loadProject(hash) extraction enabling zero-reload project switching in Plan 26-02**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-16T~session
- **Completed:** 2026-03-16
- **Tasks:** 2
- **Files modified:** 4 (+ 1 created)

## Accomplishments

- Refactored all 6 anonymous canvas event handlers in interactions.js to module-scope named functions (onMouseMove, onMouseDown, onMouseUp, onClick, onWheel, onMouseLeave)
- Added and exported teardownInteractions(canvas) that correctly removes all 6 listeners using the named refs
- Extended interactions.test.js with 15 new tests covering named handler structure and teardown export (all 24 pass)
- Extracted the data-fetch + force-simulation + interaction wiring sequence into export async function loadProject(hash, canvas, fitToScreen)
- Added state.currentProject field set on every project load
- Created project-switcher.js stub so the import in graph.js does not break

## Task Commits

1. **test(26-01): add failing tests for named handlers + teardownInteractions export** - `db0c926` (test - TDD RED)
2. **feat(26-01): refactor interactions.js — named handlers + teardownInteractions() export** - `9514b48` (feat - TDD GREEN)
3. **feat(26-01): extract loadProject(hash) from graph.js + add currentProject to state + project-switcher stub** - `76f93d6` (feat)

## Files Created/Modified

- `worker/ui/modules/interactions.js` - All 6 handlers extracted to module scope; `_canvas`/`_tooltip` module refs; `teardownInteractions()` exported
- `worker/ui/modules/interactions.test.js` - Extended with 15 new structural + behavioral tests; all 24 pass
- `worker/ui/modules/state.js` - Added `currentProject: null` field after `forceWorker`
- `worker/ui/graph.js` - `loadProject(hash, canvas, fitToScreen)` extracted; `initProjectSwitcher(resolvedHash)` called in `init()`; `_detailCloseWired` guard added
- `worker/ui/modules/project-switcher.js` - New stub file with no-op `initProjectSwitcher(_currentHash)`

## Decisions Made

- Named handlers declared at module scope (not inside `setupInteractions` body) — `removeEventListener` requires the identical function reference; closures inside `setupInteractions` would create new references each call
- `_canvas` and `_tooltip` stored as module-level `let` variables, set at the top of `setupInteractions` — named handlers reference them from module scope without closure
- `loadProject` receives `canvas` and `fitToScreen` as parameters (not reading from DOM/closure) — init() owns those values and passes them in, keeping loadProject testable and reusable
- `_detailCloseWired` boolean guard: the `detail-close` handler is idempotent for the same function but explicit guard documents intent and avoids redundant calls on hot-reload

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Plan 26-02 (project-switcher.js implementation) can now import `teardownInteractions` from interactions.js and `loadProject` from graph.js safely
- Named handler teardown is fully verified (24/24 tests pass)
- The `project-switcher.js` stub prevents import errors during development of Plan 26-02

## Self-Check: PASSED

- FOUND: worker/ui/modules/interactions.js
- FOUND: worker/ui/modules/state.js
- FOUND: worker/ui/graph.js
- FOUND: worker/ui/modules/project-switcher.js
- FOUND: .planning/phases/26-project-switcher/26-01-SUMMARY.md
- FOUND: commit db0c926 (test RED)
- FOUND: commit 9514b48 (feat GREEN)
- FOUND: commit 76f93d6 (feat Task 2)

---
*Phase: 26-project-switcher*
*Completed: 2026-03-16*
