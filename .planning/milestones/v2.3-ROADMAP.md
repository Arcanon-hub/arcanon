# Roadmap: AllClear

## Milestones

- ✅ **v1.0 Plugin Foundation** — Phases 1-13 (shipped 2026-03-15)
- ✅ **v2.0 Service Dependency Intelligence** — Phases 14-21 (shipped 2026-03-15)
- ✅ **v2.1 UI Polish & Observability** — Phases 22-26 (shipped 2026-03-16)
- ✅ **v2.2 Scan Data Integrity** — Phases 27-29 (shipped 2026-03-16)
- 🚧 **v2.3 Type-Specific Detail Panels** — Phases 30-32 (in progress)

## Phases

<details>
<summary>✅ v1.0 Plugin Foundation (Phases 1-13) — SHIPPED 2026-03-15</summary>

- [x] Phase 1-13: 5 commands, 4 hooks, shared libraries, 150+ tests

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v2.0 Service Dependency Intelligence (Phases 14-21) — SHIPPED 2026-03-15</summary>

- [x] Phase 14-21: 8 phases, 19 plans

Full details: `.planning/milestones/v2.0-ROADMAP.md`

</details>

<details>
<summary>✅ v2.1 UI Polish & Observability (Phases 22-26) — SHIPPED 2026-03-16</summary>

- [x] Phase 22-26: 5 phases, 11 plans

Full details: `.planning/milestones/v2.1-ROADMAP.md`

</details>

<details>
<summary>✅ v2.2 Scan Data Integrity (Phases 27-29) — SHIPPED 2026-03-16</summary>

- [x] Phase 27: Schema Foundation + Upsert Repair (2/2 plans)
- [x] Phase 28: Scan Version Bracket (2/2 plans)
- [x] Phase 29: Cross-Project MCP Queries (1/1 plan)

Full details: `.planning/milestones/v2.2-ROADMAP.md`

</details>

### 🚧 v2.3 Type-Specific Detail Panels (In Progress)

**Milestone Goal:** Make the graph detail panel show type-appropriate data for library and infrastructure nodes — exported types/interfaces for libraries, managed resources for infra — with correct data storage replacing the broken "METHOD PATH" parser.

- [x] **Phase 30: Storage Correctness** — Migration 007 adds `kind` column and purges malformed rows; `persistFindings()` dispatches on node type (completed 2026-03-17)
- [x] **Phase 31: API Surface Extension** — `getGraph()` attaches `exposes` arrays to nodes; `graph.js` forwards data into `state.graphData` (completed 2026-03-17)
- [x] **Phase 32: UI Detail Panels** — `utils.js` infra guard + three-way panel routing + library and infra renderers (completed 2026-03-17)

## Phase Details

### Phase 30: Storage Correctness
**Goal**: The `exposed_endpoints` table contains only well-formed rows classified by kind, and re-scanning a library or infra repo produces correct export/resource records
**Depends on**: Nothing (first phase of v2.3)
**Requirements**: STORE-01, STORE-02, STORE-03
**Success Criteria** (what must be TRUE):
  1. After running migration 007, `SELECT kind FROM exposed_endpoints LIMIT 1` returns a value (column exists with default `'endpoint'`)
  2. After migration 007, `SELECT COUNT(*) FROM exposed_endpoints WHERE method IS NULL AND path NOT LIKE '/%'` returns 0 (malformed non-REST rows purged)
  3. After re-scanning a library repo, `SELECT path, kind FROM exposed_endpoints WHERE service_id = <lib_id>` returns full function signatures (e.g., `"functionName(param: T): R"`) with `kind = 'export'` — not whitespace-split fragments
  4. After re-scanning an infra repo, `SELECT path, kind FROM exposed_endpoints WHERE service_id = <infra_id>` returns full resource references (e.g., `"k8s:deployment/payment"`) with `kind = 'resource'`
  5. Service node re-scan continues to produce REST-format rows (`method = 'GET'`, `path = '/orders'`) with `kind = 'endpoint'`
**Plans**: 2 plans

Plans:
- [ ] 30-01-PLAN.md — Migration 007: add kind column and purge malformed rows
- [ ] 30-02-PLAN.md — Fix persistFindings() type-conditional dispatch on svc.type

### Phase 31: API Surface Extension
**Goal**: The `/graph` HTTP response includes `exposes` arrays on each node and the browser graph state exposes them for click-time panel rendering
**Depends on**: Phase 30
**Requirements**: API-01, API-02
**Success Criteria** (what must be TRUE):
  1. A `GET /graph` response contains `"exposes": [{"kind": "...", "method": ..., "path": "..."}]` on each node that has stored endpoints, exports, or resources
  2. In browser devtools after `loadProject()`, `state.graphData.nodes` shows at least one node with a non-empty `exposes` array for a library or infra repo that has been scanned
  3. Service nodes with no stored exposes have `exposes: []` in the graph response (not `undefined` or absent)
**Plans**: 1 plan

Plans:
- [ ] 31-01-PLAN.md — Extend getGraph() and loadProject() to attach and forward exposes data

### Phase 32: UI Detail Panels
**Goal**: Clicking a library node shows its exported types and interfaces with consumer services; clicking an infra node shows its managed resources and wired services; clicking a service node is unchanged
**Depends on**: Phase 31
**Requirements**: PANEL-01, PANEL-02, PANEL-03, PANEL-04
**Success Criteria** (what must be TRUE):
  1. Clicking a library node opens a detail panel with an "Exports" section listing function signatures and type definitions, with functions and types grouped separately
  2. The library panel shows a "Used by" section listing services that import from the library
  3. Clicking an infra node opens a detail panel with a "Manages" section listing resources grouped by prefix (`k8s:`, `tf:`, `helm:`) with per-prefix counts
  4. The infra panel shows a "Wires" section listing services connected to the infra node
  5. Clicking a service node renders the existing service panel without any visual or behavioral change
**Plans**: 2 plans

Plans:
- [ ] 32-01-PLAN.md — Infra guard in getNodeType()/getNodeColor() and NODE_TYPE_COLORS infra color
- [ ] 32-02-PLAN.md — Three-way panel routing, library exports renderer, infra resources renderer, escapeHtml

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-13 | v1.0 | 17/17 | Complete | 2026-03-15 |
| 14-21 | v2.0 | 19/19 | Complete | 2026-03-15 |
| 22-26 | v2.1 | 11/11 | Complete | 2026-03-16 |
| 27-29 | v2.2 | 5/5 | Complete | 2026-03-16 |
| 30. Storage Correctness | 2/2 | Complete    | 2026-03-17 | - |
| 31. API Surface Extension | 1/1 | Complete    | 2026-03-17 | - |
| 32. UI Detail Panels | 2/2 | Complete    | 2026-03-17 | - |
