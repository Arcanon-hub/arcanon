---
phase: 37-controls-filters
plan: 01
subsystem: ui
tags: [html, css, state, filter-panel, toolbar]

# Dependency graph
requires:
  - phase: 36-edge-rendering
    provides: Completed graph rendering with protocol line dash patterns
provides:
  - 6 new filter state fields in state.js (activeLayers, mismatchesOnly, hideIsolated, boundaryFilter, languageFilter, filterPanelOpen)
  - Minimal top bar with Filters button replacing inline protocol checkboxes
  - Collapsible #filter-panel DOM shell with Protocol, Layer, Show, Boundary, Language sections
affects: [37-02-filter-panel-js, 37-03-renderer-filtering]

# Tech tracking
tech-stack:
  added: []
  patterns: [collapsible-panel-shell, state-first-dom-wiring]

key-files:
  created: []
  modified:
    - worker/ui/modules/state.js
    - worker/ui/index.html

key-decisions:
  - "Keep #fit-btn in toolbar between project-select and filters-btn — zoom utility separate from filters"
  - "filter-panel shell populated in HTML now, wired by filter-panel.js in plan 02 — avoids JS-create-DOM pattern"

patterns-established:
  - "Filter panel: display:none shell exists in HTML, JS toggles visibility — no JS DOM creation needed"
  - "DOM IDs in filter panel match state field names to simplify filter-panel.js wiring"

requirements-completed: [CTRL-01, CTRL-02, CTRL-03, CTRL-04, CTRL-05, CTRL-06, CTRL-07]

# Metrics
duration: 8min
completed: 2026-03-18
---

# Phase 37 Plan 01: Controls & Filters — State + HTML Shell Summary

**Minimal top bar (Search, Project, Fit, Filters button) + collapsible #filter-panel shell with 5 sections, backed by 6 new state fields**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-18T20:43:00Z
- **Completed:** 2026-03-18T20:51:29Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended state.js with 6 new filter fields (activeLayers Set, mismatchesOnly, hideIsolated, boundaryFilter, languageFilter, filterPanelOpen)
- Removed inline div#filters (protocol checkboxes) and div#legend from toolbar
- Added button#filters-btn to toolbar
- Added div#filter-panel (display:none) with Protocol, Layer, Show, Boundary, Language filter sections
- Added CSS for filter panel, sections, labels, selects, and filters button

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend state.js with filter fields** - `950664f` (feat)
2. **Task 2: Restructure index.html — minimal top bar + filter panel shell** - `bf36ffa` (feat)

## Files Created/Modified
- `worker/ui/modules/state.js` - Added 6 new filter state fields after activeProtocols
- `worker/ui/index.html` - Cleaned toolbar, added #filter-panel shell and CSS

## Decisions Made
- Kept #fit-btn in toolbar (between project-select and filters-btn) — zoom utility is not a filter and graph.js references it
- Filter panel HTML shell populated now (not created by JS) so plan 02's filter-panel.js only needs to wire events, not create DOM

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- state.js fields and DOM IDs are ready for filter-panel.js (plan 02) to wire toggle and event handlers
- #filter-panel exists with correct data-protocol and data-layer attributes, correct IDs for all controls
- No existing JS functionality broken: graph.js still finds #fit-btn, #search, #project-select, #node-info, #detail-close

---
*Phase: 37-controls-filters*
*Completed: 2026-03-18*
