---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Type-Specific Detail Panels
status: ready_to_plan
stopped_at: Roadmap created — Phase 30 ready to plan
last_updated: "2026-03-17T00:00:00.000Z"
last_activity: "2026-03-17 — v2.3 roadmap created (3 phases: 30-32)"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 5
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-17)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** v2.3 Type-Specific Detail Panels — Phase 30: Storage Correctness

## Current Position

Phase: 30 of 32 (Storage Correctness)
Plan: —
Status: Ready to plan
Last activity: 2026-03-17 — Roadmap created, Phase 30 ready to plan

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 52 (across v1.0–v2.2)
- v2.3 plans completed: 0

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 28 | 28-02 | 7min | 2 | 3 |

## Accumulated Context

### Decisions

- [v2.3]: kind discriminant column on existing `exposed_endpoints` table — avoids table rename, keeps all cross-cutting concerns (mismatch detection, FTS5, future reports) pointing at one table
- [v2.3]: Embed exposes in /graph response — not a per-click fetch; avoids async rendering state and 20-200ms click latency
- [v2.3]: Migration 007 must purge malformed rows before fixed parser lands — INSERT OR IGNORE silently blocks correct rows when malformed rows occupy the same UNIQUE key
- [v2.3]: utils.js infra guard must commit before detail-panel.js changes — prevents infra nodes falling through to service renderer during incremental work

### Pending Todos

None.

### Blockers/Concerns

- Phase 30: Validate DELETE predicate for malformed-row purge against a real DB with pre-existing library/infra scans — `method IS NULL AND path NOT LIKE '/%'` is the proposed predicate; confirm at Phase 30 test time
- Phase 30: Decide boundary_entry persistence (add to services table in migration 007 or defer to migration 008) — affects whether source file link is available in Phase 32 library panel
- Phase 32: Audit all `${e.path}`, `${e.method}`, `${e.source_file}` template literal insertions in detail-panel.js for XSS — function signatures from scan results are user-controlled strings

## Session Continuity

Last session: 2026-03-17
Stopped at: Roadmap created — Phase 30 ready to plan
Resume file: None
