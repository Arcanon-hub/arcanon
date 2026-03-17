---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Type-Specific Detail Panels
status: planning
stopped_at: Completed 31-api-surface-extension 31-01-PLAN.md
last_updated: "2026-03-17T15:37:00.686Z"
last_activity: 2026-03-17 — Roadmap created, Phase 30 ready to plan
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 5
  completed_plans: 3
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
| Phase 30-storage-correctness P30-01 | 2min | 1 tasks | 2 files |
| Phase 30-storage-correctness P30-02 | 15min | 1 tasks | 3 files |
| Phase 31 P31-01 | 2min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

- [v2.3]: kind discriminant column on existing `exposed_endpoints` table — avoids table rename, keeps all cross-cutting concerns (mismatch detection, FTS5, future reports) pointing at one table
- [v2.3]: Embed exposes in /graph response — not a per-click fetch; avoids async rendering state and 20-200ms click latency
- [v2.3]: Migration 007 must purge malformed rows before fixed parser lands — INSERT OR IGNORE silently blocks correct rows when malformed rows occupy the same UNIQUE key
- [v2.3]: utils.js infra guard must commit before detail-panel.js changes — prevents infra nodes falling through to service renderer during incremental work
- [Phase 30-storage-correctness]: DELETE predicate confirmed: method IS NULL AND path NOT LIKE '/% correctly targets malformed library/infra rows while preserving valid null-method REST rows
- [Phase 30-storage-correctness]: kind column is NOT NULL DEFAULT 'endpoint' — enforces discriminant on all future inserts, ALTER TABLE default backfills existing rows without an UPDATE sweep
- [Phase 30-storage-correctness]: COALESCE(method, '') in UNIQUE index on exposed_endpoints — SQLite NULL != NULL in UNIQUE constraints requires COALESCE for library/infra row deduplication on re-scan
- [Phase 30-storage-correctness]: Migration 007 table recreation to replace inline UNIQUE constraint — SQLite ALTER TABLE cannot drop constraints; recreate table to install COALESCE index
- [Phase 31]: SELECT kind in exposed_endpoints query now so Phase 32 detail panels get all fields without another query change
- [Phase 31]: try/catch guard on exposed_endpoints SELECT mirrors detectMismatches() pattern — returns exposes:[] when migration 007 not applied
- [Phase 31]: exposes:s.exposes||[] in loadProject() node mapping ensures state nodes always have exposes array, never undefined

### Pending Todos

None.

### Blockers/Concerns

- Phase 30: Validate DELETE predicate for malformed-row purge against a real DB with pre-existing library/infra scans — `method IS NULL AND path NOT LIKE '/%'` is the proposed predicate; confirm at Phase 30 test time
- Phase 30: Decide boundary_entry persistence (add to services table in migration 007 or defer to migration 008) — affects whether source file link is available in Phase 32 library panel
- Phase 32: Audit all `${e.path}`, `${e.method}`, `${e.source_file}` template literal insertions in detail-panel.js for XSS — function signatures from scan results are user-controlled strings

## Session Continuity

Last session: 2026-03-17T15:37:00.683Z
Stopped at: Completed 31-api-surface-extension 31-01-PLAN.md
Resume file: None
