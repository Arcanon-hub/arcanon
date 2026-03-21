---
phase: 56-what-changed-overlay
plan: 02
subsystem: ui
tags: [canvas, renderer, graph, overlay, highlight]

# Dependency graph
requires:
  - phase: 56-01
    provides: latestScanVersionId and showChanges in state.js; scan_version_id on nodes and edges from /graph API
provides:
  - Warm-yellow glow ring drawn around nodes whose scan_version_id matches latestScanVersionId when showChanges is true
  - Warm-yellow color + lineWidth 2 on edges whose scan_version_id matches latestScanVersionId when showChanges is true and no selection/blast active
  - COLORS.node.new and COLORS.edge.new ('#f6e05e') constants in state.js
  - Changes toggle button (#changes-btn) in toolbar with active state synced to state.showChanges
affects: [future renderer changes, toolbar layout changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - cloneNode pattern for re-wiring event listeners on project reload (consistent with existing fit-btn pattern)
    - ctx.save()/ctx.restore() for glow ring to isolate shadowBlur from subsequent canvas operations
    - Overlay guard: showChanges && latestScanVersionId !== null for safe null default

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/ui/modules/state.js
    - plugins/ligamen/worker/ui/modules/renderer.js
    - plugins/ligamen/worker/ui/index.html
    - plugins/ligamen/worker/ui/graph.js

key-decisions:
  - "Glow ring drawn after selection/blast border but before label — ring visible without obscuring text"
  - "isNewEdge block placed after mismatch override so mismatch red always wins over yellow"
  - "Button cloneNode pattern used to match existing fit-btn pattern — prevents duplicate listeners on project reload"
  - "class='active' set in HTML to match default showChanges: true"

patterns-established:
  - "Overlay guard pattern: state.showChanges && state.latestScanVersionId !== null — both conditions required for safety"
  - "ctx.save()/ctx.restore() for shadow effects to prevent bleed to subsequent draw calls"

requirements-completed: [GRAPH-03]

# Metrics
duration: 2min
completed: 2026-03-21
---

# Phase 56 Plan 02: What-Changed Overlay Rendering Summary

**Canvas overlay rendering warm-yellow glow rings on new nodes and bright-yellow edges for latest-scan items, with a toolbar toggle button wired to state.showChanges**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-21T11:25:13Z
- **Completed:** 2026-03-21T11:27:37Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `COLORS.node.new` and `COLORS.edge.new` (`"#f6e05e"`) to COLORS in state.js
- Implemented `isNewEdge` check in renderer.js edge loop: yellow color + lineWidth 2 when `showChanges && latestScanVersionId !== null && !hasSelection && !hasBlast`; mismatch red still wins (block placed after mismatch override)
- Implemented `isNewNode` check in renderer.js node loop: warm-yellow glow ring using `ctx.save()/ctx.restore()` + `shadowBlur` drawn after selection border and before label; supports all node shapes (circle, hexagon, diamond)
- Added `#changes-btn` button to toolbar in index.html (after `#export-btn`, before `#filters-btn`) with `class="active"` matching default `showChanges: true`
- Added `#changes-btn` CSS with warm-yellow hover/active state matching overlay color
- Wired click handler in graph.js `loadProject()` using cloneNode pattern — toggles `state.showChanges`, syncs `.active` class, calls `render()`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add new color constants and render glow/highlight in renderer.js** - `32817e7` (feat)
2. **Task 2: Add Changes toggle button to toolbar in index.html and wire click handler in graph.js** - `77cf80a` (feat)

## Files Created/Modified

- `plugins/ligamen/worker/ui/modules/state.js` - Added `COLORS.node.new` and `COLORS.edge.new` entries (`"#f6e05e"`)
- `plugins/ligamen/worker/ui/modules/renderer.js` - Added `isNewEdge` yellow edge highlight and `isNewNode` glow ring logic
- `plugins/ligamen/worker/ui/index.html` - Added `#changes-btn` button in toolbar and CSS block
- `plugins/ligamen/worker/ui/graph.js` - Wired `#changes-btn` click handler in `loadProject()` using cloneNode pattern

## Decisions Made

- Glow ring block placed after `if (isSelected || isBlastNode)` stroke block and before label rendering — ring appears above node border but behind text
- `isNewEdge` block placed after mismatch override so mismatch red always wins; yellow only fires when `!hasSelection && !hasBlast` to avoid visual conflict with selection/blast states
- `class="active"` set directly in HTML button element to match default `state.showChanges: true` on initial page load
- cloneNode pattern used for changes-btn to match existing fit-btn listener wiring convention — prevents duplicate event listeners on project reload

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 56 (What-Changed Overlay) is fully complete — both API data plumbing (Plan 01) and visual rendering (Plan 02) are shipped
- The overlay is visible by default (showChanges: true) and can be toggled via the "Changes" toolbar button
- No blockers or concerns for subsequent phases

---
*Phase: 56-what-changed-overlay*
*Completed: 2026-03-21*
