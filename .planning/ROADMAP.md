# Roadmap: AllClear

## Milestones

- ✅ **v1.0 Plugin Foundation** — Phases 1-13 (shipped 2026-03-15)
- ✅ **v2.0 Service Dependency Intelligence** — Phases 14-21 (shipped 2026-03-15)
- ✅ **v2.1 UI Polish & Observability** — Phases 22-26 (shipped 2026-03-16)
- 🚧 **v2.2 Scan Data Integrity** — Phases 27-29 (in progress)

## Phases

<details>
<summary>✅ v1.0 Plugin Foundation (Phases 1-13) — SHIPPED 2026-03-15</summary>

- [x] Phase 1-13: 5 commands, 4 hooks, shared libraries, 150+ tests

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v2.0 Service Dependency Intelligence (Phases 14-21) — SHIPPED 2026-03-15</summary>

- [x] Phase 14: Storage Foundation (2/2 plans)
- [x] Phase 15: Worker Lifecycle (2/2 plans)
- [x] Phase 16: MCP Server (3/3 plans)
- [x] Phase 17: HTTP Server & Web UI (2/2 plans)
- [x] Phase 18: Agent Scanning (2/2 plans)
- [x] Phase 19: Repo Discovery & User Confirmation (2/2 plans)
- [x] Phase 20: Command Layer (2/2 plans)
- [x] Phase 21: Integration & Config (4/4 plans)

Full details: `.planning/milestones/v2.0-ROADMAP.md`

</details>

<details>
<summary>✅ v2.1 UI Polish & Observability (Phases 22-26) — SHIPPED 2026-03-16</summary>

- [x] Phase 22: Canvas & Zoom (3/3 plans)
- [x] Phase 23: Logging Instrumentation (3/3 plans)
- [x] Phase 24: Log Terminal API (1/1 plan)
- [x] Phase 25: Log Terminal UI (2/2 plans)
- [x] Phase 26: Project Switcher (2/2 plans)

Full details: `.planning/milestones/v2.1-ROADMAP.md`

</details>

### 🚧 v2.2 Scan Data Integrity (In Progress)

**Milestone Goal:** Fix data duplication from re-scanning, enforce consistent service naming, and enable cross-project MCP queries from any repo.

- [x] **Phase 27: Schema Foundation + Upsert Repair** — Migration 004 adds UNIQUE constraint, deduplicates existing data, rebuilds FTS5; upsert rewrite ships atomically; agent naming convention enforced (completed 2026-03-16)
- [x] **Phase 28: Scan Version Bracket** — Migration 005 adds scan_versions table; beginScan/endScan bracket makes re-scan atomic; stale rows cleaned up after successful persist (completed 2026-03-16)
- [x] **Phase 29: Cross-Project MCP Queries** — MCP tools accept optional `project` parameter; per-call DB resolution via pool.js; agents in any repo can query any project graph (completed 2026-03-16)

## Phase Details

### Phase 27: Schema Foundation + Upsert Repair
**Goal**: Re-scanning a repo replaces its service data rather than appending duplicates, with no child-row data loss
**Depends on**: Phase 26 (v2.1 complete)
**Requirements**: SCAN-01, SCAN-02, SCAN-04
**Success Criteria** (what must be TRUE):
  1. Running `/allclear:map` twice produces the same number of service rows as once — no duplicates. If the second scan discovers updated metadata (language, type, new connections), existing rows are updated in-place with the latest values.
  2. Re-scanning preserves the service row ID; connections, endpoints, schemas, and fields referencing that service are not cascade-deleted
  3. FTS5 search returns correct results after a re-scan — no stale rowid references
  4. Agent scanning output uses lowercase-hyphenated service names derived from the package manifest name field
  5. The `MAX(id) GROUP BY name` workaround is removed from `getGraph()` — graph renders directly from clean data
**Plans**: 2 plans

Plans:
- [ ] 27-01-PLAN.md — Migration 004: UNIQUE constraint, dedup, FTS5 rebuild + upsert rewrite
- [ ] 27-02-PLAN.md — Agent prompt: service naming convention (lowercase-hyphenated, manifest-derived)

### Phase 28: Scan Version Bracket
**Goal**: Each re-scan atomically replaces prior scan data so deleted services and connections are removed from the graph
**Depends on**: Phase 27
**Requirements**: SCAN-03
**Success Criteria** (what must be TRUE):
  1. After re-scanning a repo where a service was removed, that service no longer appears in the graph
  2. If a scan fails mid-run, the previous scan's data remains intact and queryable — no partial or corrupt graph state
  3. Each completed scan is recorded as a version entry; the graph always reflects the latest completed scan
**Plans**: 2 plans

Plans:
- [ ] 28-01-PLAN.md — Migration 005 (scan_versions table + scan_version_id FK columns) + QueryEngine beginScan/endScan + persistFindings with scanVersionId
- [ ] 28-02-PLAN.md — Wire beginScan/endScan bracket in scanRepos + human verify

### Phase 29: Cross-Project MCP Queries
**Goal**: MCP tools resolve the correct project database from any working directory, enabling agents to query any repo's graph
**Depends on**: Phase 27 (pool.js cleanup requires migrations 004+005 in place; can be developed in parallel but must land after Phase 27)
**Requirements**: SCAN-05
**Success Criteria** (what must be TRUE):
  1. An agent working in repo-B can call an MCP impact tool with `project: "repo-A"` and receive correct results from repo-A's graph
  2. MCP tools with no `project` parameter continue to work as before — no breaking change for single-project users
  3. Passing an unknown project name or path returns a structured error with a hint to run `/allclear:map` first — never silent empty results
**Plans**: 1 plan
Plans:
- [ ] 29-01-PLAN.md — pool.js getQueryEngineByRepo + mcp/server.js per-call resolveDb with optional project param on all 5 tools

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-13 | v1.0 | 17/17 | Complete | 2026-03-15 |
| 14-21 | v2.0 | 19/19 | Complete | 2026-03-15 |
| 22-26 | v2.1 | 11/11 | Complete | 2026-03-16 |
| 27. Schema Foundation + Upsert Repair | 2/2 | Complete   | 2026-03-16 | - |
| 28. Scan Version Bracket | 2/2 | Complete   | 2026-03-16 | - |
| 29. Cross-Project MCP Queries | 1/1 | Complete   | 2026-03-16 | - |
