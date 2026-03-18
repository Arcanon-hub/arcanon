# Roadmap: AllClear

## Milestones

- ✅ **v1.0 Plugin Foundation** — Phases 1-13 (shipped 2026-03-15)
- ✅ **v2.0 Service Dependency Intelligence** — Phases 14-21 (shipped 2026-03-15)
- ✅ **v2.1 UI Polish & Observability** — Phases 22-26 (shipped 2026-03-16)
- ✅ **v2.2 Scan Data Integrity** — Phases 27-29 (shipped 2026-03-16)
- ✅ **v2.3 Type-Specific Detail Panels** — Phases 30-32 (shipped 2026-03-18)
- 🚧 **v3.0 Layered Graph & Intelligence** — Phases 33-38 (in progress)

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

- [x] Phase 27-29: 3 phases, 5 plans

Full details: `.planning/milestones/v2.2-ROADMAP.md`

</details>

<details>
<summary>✅ v2.3 Type-Specific Detail Panels (Phases 30-32) — SHIPPED 2026-03-18</summary>

- [x] Phase 30: Storage Correctness (2/2 plans)
- [x] Phase 31: API Surface Extension (1/1 plan)
- [x] Phase 32: UI Detail Panels (2/2 plans)

Full details: `.planning/milestones/v2.3-ROADMAP.md`

</details>

### 🚧 v3.0 Layered Graph & Intelligence (In Progress)

**Milestone Goal:** Replace force-directed graph with deterministic layered layout, surface external system actors, and enrich the data model for richer MCP impact responses.

- [x] **Phase 33: Data Model** — actors table, actor_connections table, node_metadata table, migration from existing external connections (completed 2026-03-18)
- [x] **Phase 34: Layout Engine & Node Rendering** — deterministic layered layout replacing force simulation, node shapes per type, boundary boxes (completed 2026-03-18)
- [x] **Phase 35: External Actors** — external actor detection, storage, rendering as hexagons, detail panel (completed 2026-03-18)
- [x] **Phase 36: Edge Rendering** — protocol-differentiated edge styles (solid, dashed, dotted), mismatch highlighting (completed 2026-03-18)
- [x] **Phase 37: Controls & Filters** — minimal top bar, collapsible filter panel with all toggles (completed 2026-03-18)
- [x] **Phase 38: Intelligence** — enriched ChromaDB embeddings, boundary-aware and actor-aware MCP responses (completed 2026-03-18)

## Phase Details

### Phase 33: Data Model
**Goal**: The database schema supports external actors and extensible node metadata before any UI changes land
**Depends on**: Phase 32
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. `actors` table exists with name, kind, direction, and source columns; rows survive re-scan via upsert
  2. `actor_connections` table links actor rows to service rows with direction and protocol
  3. `node_metadata` table accepts arbitrary key/value pairs keyed by (service_id, view, key) without schema changes
  4. Running the migration against an existing database populates actor rows from connections where `crossing = 'external'`
**Plans:** 1/1 plans complete
Plans:
- [ ] 33-01-PLAN.md — Migration 008: actors, actor_connections, node_metadata tables + tests

### Phase 34: Layout Engine & Node Rendering
**Goal**: The graph renders with a deterministic, stable layered layout and distinct node shapes per type
**Depends on**: Phase 33
**Requirements**: LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04, LAYOUT-05, NODE-01, NODE-02, NODE-03, NODE-05
**Success Criteria** (what must be TRUE):
  1. Reloading the page shows nodes in identical positions — no randomness or force simulation drift
  2. Services appear in the top row, libraries in the middle row, infrastructure in the bottom row
  3. Nodes within each layer are evenly spaced using grid-based positioning
  4. Services belonging to a user-defined boundary in `allclear.config.json` are enclosed by a dashed rounded rectangle with semi-transparent fill and a label
  5. Hovering any node shows a tooltip displaying its type and connection count
**Plans:** 2/2 plans complete
Plans:
- [ ] 34-01-PLAN.md — Layout engine, force worker removal, boundary API
- [ ] 34-02-PLAN.md — Node shapes, boundary box rendering, tooltip upgrade

### Phase 35: External Actors
**Goal**: External systems detected during scan are visible as distinct actor nodes outside the system boundary
**Depends on**: Phase 34
**Requirements**: ACTOR-01, ACTOR-02, ACTOR-03, ACTOR-04, NODE-04
**Success Criteria** (what must be TRUE):
  1. Scanning a repo with outbound external connections creates rows in the `actors` table (verifiable via `/allclear:map`)
  2. External actor nodes render as hexagons in a dedicated column to the right of the system boundary
  3. Edges from services to external actors visually cross the system boundary line
  4. Clicking an external actor node opens a detail panel listing which services connect to it and via what protocol
**Plans:** 2/2 plans complete
Plans:
- [ ] 35-01-PLAN.md — Actor persistence in scan pipeline, getGraph actors API
- [ ] 35-02-PLAN.md — Actor layout, hexagon rendering, detail panel

### Phase 36: Edge Rendering
**Goal**: Edge visual style communicates connection protocol at a glance
**Depends on**: Phase 34
**Requirements**: EDGE-01, EDGE-02, EDGE-03, EDGE-04, EDGE-05
**Success Criteria** (what must be TRUE):
  1. REST edges render as solid lines; gRPC edges render as dashed lines; event/messaging edges render as dotted lines
  2. SDK/import edges render as solid lines with arrowheads indicating direction
  3. Edges flagged as mismatches render in red, visually distinct from healthy edges
**Plans:** 1/1 plans complete
Plans:
- [ ] 36-01-PLAN.md — Protocol line styles (solid/dashed/dotted) and mismatch red highlight

### Phase 37: Controls & Filters
**Goal**: Users can filter the graph to the nodes and edges they care about through a minimal, uncluttered UI
**Depends on**: Phase 34, Phase 35, Phase 36
**Requirements**: CTRL-01, CTRL-02, CTRL-03, CTRL-04, CTRL-05, CTRL-06, CTRL-07
**Success Criteria** (what must be TRUE):
  1. The top bar shows only Search, Project selector, and a Filters button — no other persistent controls
  2. Clicking Filters opens a collapsible panel with protocol toggles (REST, gRPC, Events, SDK, Internal) that show/hide matching edges
  3. Layer toggles in the filter panel show/hide entire layers (Services, Libraries, Infra, External)
  4. Enabling "Mismatches only" hides all edges except those with detected mismatches
  5. Enabling "Hide isolated nodes" removes nodes with zero connections from the canvas
  6. Boundary and Language dropdowns filter to nodes in the selected boundary or written in the selected language
**Plans:** 3/3 plans complete
Plans:
- [ ] 37-01-PLAN.md — State extensions + HTML/CSS minimal top bar and filter panel shell
- [ ] 37-02-PLAN.md — filter-panel.js module: wire all controls to state + render
- [ ] 37-03-PLAN.md — renderer.js filter logic: layer, mismatch, isolated, boundary, language

### Phase 38: Intelligence
**Goal**: ChromaDB embeddings and MCP tool responses carry boundary and actor context so agents receive richer impact answers
**Depends on**: Phase 33, Phase 35
**Requirements**: INTEL-01, INTEL-02, INTEL-03
**Success Criteria** (what must be TRUE):
  1. After a scan, ChromaDB document payloads include boundary name (if configured) and actor relationships alongside existing graph data
  2. `impact_query` MCP responses include type-aware phrasing — e.g., "library used by 3 services in the payments boundary"
  3. `impact_search` MCP responses include actor relationships — e.g., "payments-api connects to external Stripe via REST"
**Plans:** 2/2 plans complete
Plans:
- [ ] 38-01-PLAN.md — ChromaDB embedding enrichment: boundary + actor fields in syncFindings
- [ ] 38-02-PLAN.md — MCP response enrichment: type-aware impact_query and actor-aware impact_search

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-13 | v1.0 | 17/17 | Complete | 2026-03-15 |
| 14-21 | v2.0 | 19/19 | Complete | 2026-03-15 |
| 22-26 | v2.1 | 11/11 | Complete | 2026-03-16 |
| 27-29 | v2.2 | 5/5 | Complete | 2026-03-16 |
| 30-32 | v2.3 | 5/5 | Complete | 2026-03-18 |
| 33. Data Model | 1/1 | Complete    | 2026-03-18 | - |
| 34. Layout Engine & Node Rendering | 2/2 | Complete    | 2026-03-18 | - |
| 35. External Actors | 2/2 | Complete    | 2026-03-18 | - |
| 36. Edge Rendering | 1/1 | Complete    | 2026-03-18 | - |
| 37. Controls & Filters | 3/3 | Complete    | 2026-03-18 | - |
| 38. Intelligence | 2/2 | Complete    | 2026-03-18 | - |
