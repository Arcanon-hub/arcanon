# Roadmap: AllClear

## Milestones

- ✅ **v1.0 Plugin Foundation** — Phases 1-13 (shipped 2026-03-15)
- ✅ **v2.0 Service Dependency Intelligence** — Phases 14-21 (shipped 2026-03-15)
- 🚧 **v2.1 UI Polish & Observability** — Phases 22-26 (in progress)

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

### 🚧 v2.1 UI Polish & Observability (In Progress)

**Milestone Goal:** Make the graph UI production-quality with crisp HiDPI rendering, usable zoom/pan controls, structured logging across all components, an embedded log terminal for real-time worker observability, and persistent project switching without page reload.

- [ ] **Phase 22: Canvas & Zoom** - Crisp HiDPI rendering, tuned zoom/pan controls, and fit-to-screen
- [ ] **Phase 23: Logging Instrumentation** - Structured logger with component tags across all worker modules
- [ ] **Phase 24: Log Terminal API** - Server-side log streaming endpoint with filtering and query params
- [ ] **Phase 25: Log Terminal UI** - Collapsible log panel with live-tail, component filter, and search
- [ ] **Phase 26: Project Switcher** - Persistent dropdown to switch projects in-place without page reload

## Phase Details

### Phase 22: Canvas & Zoom
**Goal**: The graph renders crisp and navigable on all displays, including Retina Macs, with natural zoom/pan behavior and a way to recover any lost view
**Depends on**: Nothing (first v2.1 phase; independent of all other v2.1 work)
**Requirements**: CANVAS-01, CANVAS-02, ZOOM-01, ZOOM-02, ZOOM-03
**Success Criteria** (what must be TRUE):
  1. On a Retina/HiDPI display, graph nodes and edges are sharp — not blurry or doubled-looking
  2. Node labels, detail panel text, and tooltips are readable without zooming in
  3. Mouse wheel zoom feels smooth and controllable — not jumping multiple zoom levels per tick
  4. Two-finger scroll on a trackpad pans the graph; pinch zooms the graph (not both zoom)
  5. Clicking the fit-to-screen button resets the view to show all nodes centered in the canvas
**Plans**: 3 plans

Plans:
- [ ] 22-01-PLAN.md — HiDPI canvas rendering (renderer.js + graph.js resize)
- [ ] 22-02-PLAN.md — Zoom/pan tuning: smooth delta + trackpad ctrlKey split
- [ ] 22-03-PLAN.md — Fit-to-screen button in toolbar

### Phase 23: Logging Instrumentation
**Goal**: All worker components emit structured JSON logs with a consistent component tag, enabling downstream filtering by scan, MCP, HTTP, and worker subsystems
**Depends on**: Nothing (can parallel with Phase 22)
**Requirements**: LOG-INFRA-01, LOG-INFRA-02, LOG-INFRA-03
**Success Criteria** (what must be TRUE):
  1. A shared logger module exists that all worker components import instead of console.log/console.error
  2. Every log line in worker.log includes a `component` field with one of: worker, http, mcp, scan
  3. MCP server, HTTP server, scan manager, and worker index all use the shared logger
  4. No console.log or console.error calls remain in production worker code (test files excluded)
**Plans**: 3 plans
Plans:
- [ ] 23-01-PLAN.md — Create worker/lib/logger.js shared logger factory with createLogger and component field
- [ ] 23-02-PLAN.md — Wire logger into worker/index.js, worker/server/http.js, worker/server/chroma.js
- [ ] 23-03-PLAN.md — Wire logger into worker/mcp/server.js, worker/scan/manager.js, worker/db/database.js

### Phase 24: Log Terminal API
**Goal**: The worker HTTP server exposes a queryable log endpoint that the UI can poll to retrieve filtered log lines
**Depends on**: Phase 23 (logs must have component tags before filtering makes sense)
**Requirements**: (infrastructure phase — enables LOG-01 through LOG-04)
**Success Criteria** (what must be TRUE):
  1. A GET request to /api/logs returns a JSON response with a lines array
  2. The ?component= query param filters results to only lines matching that component label
  3. The ?since= query param returns only lines newer than the given timestamp
  4. Closing the browser tab or connection does not leave a zombie connection in the worker process
**Plans**: 1 plan
Plans:
- [ ] 24-01-PLAN.md — Add GET /api/logs route to Fastify server with component/since filtering, 500-line cap, and dataDir option wiring

### Phase 25: Log Terminal UI
**Goal**: Users can observe real-time worker activity from within the graph UI, filtering and searching logs without leaving the browser
**Depends on**: Phase 24
**Requirements**: LOG-01, LOG-02, LOG-03, LOG-04
**Success Criteria** (what must be TRUE):
  1. A collapsed log panel appears at the bottom of the page; clicking its header opens and closes it
  2. When open, the panel shows new log lines as they arrive without any manual refresh
  3. A component dropdown filters the visible log lines to a single subsystem (scan, MCP, worker, HTTP)
  4. Typing in a search box further filters visible lines to those containing the search string
  5. The panel scrolls automatically to the newest line, but stops auto-scrolling when the user scrolls up and resumes when they scroll back to the bottom
**Plans**: 2 plans
Plans:
- [ ] 25-01-PLAN.md — Add log panel HTML/CSS to index.html, extend state.js, create log-terminal.js module (polling, ring buffer, filter, search, auto-scroll)
- [ ] 25-02-PLAN.md — Wire initLogTerminal into graph.js and verify end-to-end browser behavior

### Phase 26: Project Switcher
**Goal**: Users can switch between tracked projects in the graph UI without a full page reload
**Depends on**: Phase 22 (requires stable graph.js after canvas refactor; named-handler refactor gates this phase)
**Requirements**: PROJ-01
**Success Criteria** (what must be TRUE):
  1. A dropdown in the UI header is always visible and lists all projects known to the worker
  2. Selecting a different project in the dropdown loads that project's graph in place — no page reload, no browser navigation
  3. After switching, the previously selected project's graph, workers, and event listeners are fully torn down — clicks and forces from the old project do not fire
**Plans**: 2 plans
Plans:
- [ ] 26-01-PLAN.md — Refactor interactions.js to named handlers + teardownInteractions(); extract loadProject() from graph.js; add currentProject to state.js
- [ ] 26-02-PLAN.md — Implement project-switcher.js module + human verify end-to-end

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-13 | v1.0 | 17/17 | Complete | 2026-03-15 |
| 14-21 | v2.0 | 19/19 | Complete | 2026-03-15 |
| 22. Canvas & Zoom | 1/3 | In Progress|  | - |
| 23. Logging Instrumentation | v2.1 | 0/3 | Not started | - |
| 24. Log Terminal API | v2.1 | 0/1 | Not started | - |
| 25. Log Terminal UI | v2.1 | 0/TBD | Not started | - |
| 26. Project Switcher | v2.1 | 0/TBD | Not started | - |
