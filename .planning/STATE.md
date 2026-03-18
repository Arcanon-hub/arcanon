---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Layered Graph & Intelligence
status: planning
stopped_at: null
last_updated: "2026-03-18T18:30:00.000Z"
last_activity: 2026-03-18 — Milestone v3.0 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-18)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** Defining requirements for v3.0

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-18 — Milestone v3.0 started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 57 (across v1.0–v2.3)

## Accumulated Context

### Decisions

- [v3.0]: Services top, libraries middle, infra bottom — infra is the foundation services run on
- [v3.0]: External actors on right side — outbound connections flow right, visually outside system boundary
- [v3.0]: Minimal top bar with collapsible filter panel — Search + Project + Filters button; all toggles in dropdown
- [v3.0]: Outbound external actors from scan only — no config-based or inferred inbound actors this milestone
- [v3.0]: Custom grid layout over Dagre/ELK — simple row-based layout per type layer, pull in library only if needed
- [v3.0]: node_metadata table for extensibility — avoids migration bloat when future views (STRIDE, vulns) add data
- [v3.0]: Layered scanning approach — core scan unchanged, future views get their own optional scan passes
- [v3.0]: Separate actors table over extending services — actors don't have repos, languages, or exposes; half the columns would be NULL

### Pending Todos

None.

### Blockers/Concerns

- Boundary data must come from user config (allclear.config.json) — auto-inference deferred due to hallucination risk
- External actor detection relies on `crossing: "external"` in scan output — verify current scan prompt captures this reliably
- Layout engine complexity — start with custom grid, only pull in Dagre/ELK if edge routing within complex boundaries demands it

## Session Continuity

Last session: 2026-03-18
Stopped at: null
Resume file: None
