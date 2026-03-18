---
phase: 35-external-actors
plan: 02
subsystem: ui
tags: [canvas, hexagon, graph, detail-panel, external-actors, layout]

# Dependency graph
requires:
  - phase: 35-01
    provides: "actors array in getGraph API response with connected_services"
  - phase: 34-01
    provides: "computeLayout with ACTOR_COLUMN_RESERVE_RATIO reserving right 18%"
  - phase: 34-02
    provides: "diamond shapes for library/infra nodes, leaving hexagon available for actors"
provides:
  - "Actor hexagon nodes rendered in right column with coral (#e06060) color"
  - "Synthetic actor nodes with negative IDs in graphData.nodes"
  - "Synthetic edges from services to actor nodes"
  - "Actor detail panel showing connected services with protocol and path"
  - "renderActorDetail function in detail-panel.js"
affects: [35-external-actors, graph-ui, layout]

# Tech tracking
tech-stack:
  added: []
  patterns: ["synthetic negative IDs for non-service nodes", "pointy-top hexagon via Math.PI/3 angle offset"]

key-files:
  created: []
  modified:
    - worker/ui/modules/state.js
    - worker/ui/modules/utils.js
    - worker/ui/modules/layout.js
    - worker/ui/graph.js
    - worker/ui/modules/renderer.js
    - worker/ui/modules/detail-panel.js

key-decisions:
  - "Synthetic negative IDs (-actor.id) for actor nodes to avoid collision with service IDs"
  - "Pointy-top hexagon orientation for actors vs flat-top used historically for libraries"
  - "_isActor flag on nodes for fast type detection without string comparison"

patterns-established:
  - "Synthetic node pattern: external entities normalized into graphData.nodes with flag + negative ID"
  - "Synthetic edge pattern: _isActorEdge flag on edges for potential future filtering"

requirements-completed: [ACTOR-02, ACTOR-03, ACTOR-04, NODE-04]

# Metrics
duration: 3min
completed: 2026-03-18
---

# Phase 35 Plan 02: Actor UI Summary

**Coral hexagon nodes for external actors in right column with cross-boundary edges and detail panel showing connected services/protocols**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-18T20:13:30Z
- **Completed:** 2026-03-18T20:16:00Z
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 6

## Accomplishments
- Actor nodes render as pointy-top hexagons in coral (#e06060) in the reserved right column
- Edges from services to actors cross the system boundary area naturally
- Clicking an actor hexagon opens detail panel with name, kind, direction, and connected services list
- Hover tooltip shows "actor" type for actor nodes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add actor nodes to state, layout, utils, and graph wiring** - `1ae73cc` (feat)
2. **Task 2: Render actor hexagons, cross-boundary edges, and actor detail panel** - `0595fb1` (feat)
3. **Task 3: Visual verification** - checkpoint, approved by user

## Files Created/Modified
- `worker/ui/modules/state.js` - Added actors[] to graphData, actor color #e06060 to NODE_TYPE_COLORS
- `worker/ui/modules/utils.js` - getNodeType/getNodeColor detect _isActor flag first
- `worker/ui/graph.js` - Normalize raw.actors into synthetic nodes (negative IDs) and synthetic edges
- `worker/ui/modules/layout.js` - Filter actor nodes to dedicated right column positioning
- `worker/ui/modules/renderer.js` - Pointy-top hexagon shape for actor nodes with coral fill
- `worker/ui/modules/detail-panel.js` - renderActorDetail showing connected services with protocol/path

## Decisions Made
- Used synthetic negative IDs (-actor.id) to avoid collision with service IDs in graphData.nodes
- Pointy-top hexagon orientation (angle offset -Math.PI/2) distinguishes actors from library diamonds
- _isActor flag on nodes enables fast type detection without string comparison in hot paths

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- External actors feature complete for v3.0 milestone
- All ACTOR requirements (02, 03, 04) and NODE-04 satisfied
- Graph UI now shows full system topology: services, libraries, infra, and external actors

## Self-Check: PASSED

All 6 modified files verified present. Both task commits (1ae73cc, 0595fb1) verified in git log.

---
*Phase: 35-external-actors*
*Completed: 2026-03-18*
