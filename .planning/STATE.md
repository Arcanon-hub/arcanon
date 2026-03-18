---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Layered Graph & Intelligence
status: unknown
stopped_at: Completed 38-01-PLAN.md
last_updated: "2026-03-18T21:02:53.099Z"
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 11
  completed_plans: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-18)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** Phase 38 — intelligence

## Current Position

Phase: 38 (intelligence) — EXECUTING
Plan: 1 of 2

## Performance Metrics

**Velocity:**

- Total plans completed: 58 (across v1.0–v3.0)
- Phase 33 plan 01: ~3 minutes, 2 tasks, 2 files created, 14 tests

## Accumulated Context

### Decisions

- [v3.0]: Services top, libraries middle, infra bottom — infra is the foundation services run on
- [v3.0]: External actors on right side — outbound connections flow right, visually outside system boundary
- [v3.0]: Minimal top bar with collapsible filter panel — Search + Project + Filters button only
- [v3.0]: Outbound external actors from scan only — no config-based or inferred inbound actors this milestone
- [v3.0]: Custom grid layout over Dagre/ELK — simple row-based layout per type layer, pull in library only if needed
- [v3.0]: node_metadata table for extensibility — avoids migration bloat for future views (STRIDE, vulns)
- [v3.0]: Separate actors table over extending services — actors have no repos, languages, or exposes
- [33-01]: ALTER TABLE idempotency via PRAGMA table_info — SQLite has no ADD COLUMN IF NOT EXISTS
- [33-01]: Population uses INSERT OR IGNORE so migration re-runs never create duplicate actor rows
- [Phase 34]: computeLayout() pure function — deterministic positions from node type+sort, no Worker
- [Phase 34]: 18% right canvas reserved for Phase 35 actors via ACTOR_COLUMN_RESERVE_RATIO constant
- [Phase 34]: HTTP handler reads boundaries from allclear.config.json directly — avoids QueryEngine change
- [34-02]: Outline diamond for library/SDK uses dark background fill to prevent edge bleed-through, then nodeColor stroke
- [34-02]: NODE-03 test slice uses 400 chars (ctx.fill() is 308 chars past infra match point)
- [Phase 35-01]: Wrap _stmtUpsertConnection in try/catch for crossing column backward compat — pre-migration-008 DBs fall back to old statement
- [Phase 35-01]: Actor detection uses conn.target as actorName — external target service name becomes actor name, consistent with migration 008
- [Phase 35-02]: Synthetic negative IDs (-actor.id) for actor nodes to avoid collision with service IDs
- [Phase 35-02]: Pointy-top hexagon for actors, _isActor flag for fast type detection
- [Phase 36-edge-rendering]: PROTOCOL_LINE_DASH values are logical pixels; caller divides by transform.scale at render time
- [Phase 36-edge-rendering]: sdk/import map to [] (solid) — corrects prior incorrect [4,4] dashed pattern
- [Phase 37-01]: Keep #fit-btn in toolbar between project-select and filters-btn — zoom utility separate from filters
- [Phase 37-01]: Filter panel HTML shell in index.html now, wired by filter-panel.js in plan 02 — avoids JS-create-DOM pattern
- [Phase 37-02]: Protocol checkbox handling moved into filter-panel.js — setupControls() now only owns search input
- [Phase 37-02]: populateFilterDropdowns() called after mismatches assignment — services node array complete at that point
- [Phase 37-controls-filters]: nodeLayer() helper defined at module scope to avoid per-frame re-creation in render()
- [Phase 37-controls-filters]: hideIsolated post-filter honors mismatchesOnly in its edge-counting pass — consistent with what's drawn
- [Phase 38-intelligence]: Enrichment maps default to empty Map — calling syncFindings(findings) with no second arg produces boundary='' actors='' with zero crashes
- [Phase 38-intelligence]: Actors DB query wrapped in try/catch — Phase 38 may execute before Phase 33 migration 008 is deployed on a given DB

### Pending Todos

None.

### Blockers/Concerns

- Boundary data must come from user config (allclear.config.json) — auto-inference deferred due to hallucination risk
- External actor detection relies on `crossing: "external"` in scan output — verify current scan prompt captures this reliably
- Layout engine complexity — start with custom grid, only pull in Dagre/ELK if edge routing within complex boundaries demands it

## Session Continuity

Last session: 2026-03-18T21:02:39.506Z
Stopped at: Completed 38-01-PLAN.md
Resume file: None
