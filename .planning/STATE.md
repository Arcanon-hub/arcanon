---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: Scan Data Integrity
status: planning
stopped_at: Completed 28-02-PLAN.md — scanRepos beginScan/endScan bracket wiring
last_updated: "2026-03-16T15:32:00Z"
last_activity: 2026-03-16 — Phase 28 complete
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 5
  completed_plans: 5
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-16)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** v2.2 Phase 28 — Scan Version Bracket (complete)

## Current Position

Phase: 28 of 29 (Scan Version Bracket)
Plan: 02 of 02 (complete)
Status: Phase complete — all plans shipped
Last activity: 2026-03-16 — Phase 28 complete (28-02: scanRepos bracket wiring)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 47 (across v1.0–v2.1)
- v2.2 plans completed: 5

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 28 | 28-02 | 7min | 2 | 3 |

## Accumulated Context

### Decisions

- [v2.0]: Service is the unit, not repo — works for mono-repo and multi-repo
- [v2.0]: SQLite primary, ChromaDB optional
- [v2.1]: Graph dedup via MAX(id) GROUP BY name — workaround, scheduled for removal in Phase 27
- [v2.2]: SCAN-01 + SCAN-02 must ship atomically — migration 004 + ON CONFLICT DO UPDATE together, or cascade-delete wipes child rows
- [v2.2]: SCAN-04 (agent naming) grouped with Phase 27 — cheapest identity fix, no schema dependency
- [Phase 27-02]: Naming convention enforced at agent prompt level (cheapest fix — no schema or code change required)
- [Phase 27-02]: Disallowed names: server, worker, api, app, main, service, backend, frontend — disambiguation via directory/module path suffix
- [Phase 27-01]: In-place dedup strategy: SQLite 3.51+ rewrites FK refs on ALTER TABLE RENAME even with legacy_alter_table=ON — in-place DELETE+CREATE UNIQUE INDEX avoids DROP TABLE FK failure inside transactions
- [Phase 27-01]: Migration 004 + ON CONFLICT DO UPDATE shipped atomically — UNIQUE constraint alone with INSERT OR REPLACE causes cascade-delete of child rows
- [Phase 28]: Migration 005 uses ALTER TABLE ADD COLUMN without DEFAULT — nullable FK, existing rows get NULL
- [Phase 28]: endScan deletes connections before services (no CASCADE on FK in migration 001 services table)
- [Phase 29-cross-project-mcp-queries]: resolveDb routing: absolute path → getQueryEngine; 12-char hex → getQueryEngineByHash; other string → getQueryEngineByRepo; undefined → ALLCLEAR_PROJECT_ROOT / cwd
- [Phase 29-cross-project-mcp-queries]: Pool-owned connections: MCP tool handlers never call db.close() — pool.js owns connection lifetime via QueryEngine cache
- [Phase 28-02]: persistFindings is called inside scanRepos (not by caller) — manager owns persistence end-to-end; /scan POST endpoint in http.js handles a separate call path for externally-submitted findings
- [Phase 28-02]: beginScan is called even when agent parse later fails — scan started, but endScan omitted so prior data survives; scan_versions row remains incomplete

### Pending Todos

None.

### Blockers/Concerns

- Phase 27: Migration 004 must be tested against a database with existing duplicate (repo_id, name) rows — clean fixture is insufficient
- Phase 27: Audit actual service names in existing project DBs before finalizing generic name block-list
- Phase 29: Decide allowed-roots policy for `projectRoot` validation (e.g., must be under HOME, must appear in ~/.allclear/projects/)
- Phase 29: Confirm pool.js lines 178-202 inline migration workaround is safe to remove after migrations 004+005 land

## Session Continuity

Last session: 2026-03-16T15:32:00Z
Stopped at: Completed 28-02-PLAN.md — scanRepos beginScan/endScan bracket wiring
Resume file: None
