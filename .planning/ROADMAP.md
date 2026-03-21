# Roadmap: Ligamen

## Milestones

- ✅ **v1.0 Plugin Foundation** — Phases 1-13 (shipped 2026-03-15)
- ✅ **v2.0 Service Dependency Intelligence** — Phases 14-21 (shipped 2026-03-15)
- ✅ **v2.1 UI Polish & Observability** — Phases 22-26 (shipped 2026-03-16)
- ✅ **v2.2 Scan Data Integrity** — Phases 27-29 (shipped 2026-03-16)
- ✅ **v2.3 Type-Specific Detail Panels** — Phases 30-32 (shipped 2026-03-18)
- ✅ **v3.0 Layered Graph & Intelligence** — Phases 33-38 (shipped 2026-03-18)
- ✅ **v4.0 Ligamen Rebrand** — Phases 39-45 (shipped 2026-03-20)
- ✅ **v4.1 Command Cleanup** — Phases 46-48 (shipped 2026-03-20)
- ✅ **v5.0 Marketplace Restructure** — Phases 49-51 (shipped 2026-03-21)
- 🚧 **v5.1 Graph Interactivity** — Phases 52-58 (in progress)

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

- [x] Phase 30-32: 3 phases, 5 plans

Full details: `.planning/milestones/v2.3-ROADMAP.md`

</details>

<details>
<summary>✅ v3.0 Layered Graph & Intelligence (Phases 33-38) — SHIPPED 2026-03-18</summary>

- [x] Phase 33-38: 6 phases, 11 plans

Full details: `.planning/milestones/v3.0-ROADMAP.md`

</details>

<details>
<summary>✅ v4.0 Ligamen Rebrand (Phases 39-45) — SHIPPED 2026-03-20</summary>

- [x] Phase 39-45: 7 phases, 14 plans — full allclear → ligamen rename across 91 files

Full details: `.planning/milestones/v4.0-ROADMAP.md`

</details>

<details>
<summary>✅ v4.1 Command Cleanup (Phases 46-48) — SHIPPED 2026-03-20</summary>

- [x] Phase 46-48: 3 phases, 6 plans — K8s commands removed, MCP expanded to 8 drift tools

Full details: `.planning/milestones/v4.1-ROADMAP.md`

</details>

<details>
<summary>✅ v5.0 Marketplace Restructure (Phases 49-51) — SHIPPED 2026-03-21</summary>

- [x] Phase 49-51: 3 phases, 5 plans — repo restructured as Claude Code marketplace, 173/173 bats tests passing

Full details: `.planning/milestones/v5.0-ROADMAP.md`

</details>

### 🚧 v5.1 Graph Interactivity (In Progress)

**Milestone Goal:** Make the graph visualization useful for daily debugging with keyboard-driven navigation, subgraph isolation, change detection, and edge bundling.

- [x] **Phase 52: Keyboard Shortcuts & PNG Export** - F/Esc/slash keyboard shortcuts and one-click canvas export (completed 2026-03-21)
- [x] **Phase 53: Clickable Detail Panel Targets** - Service names in connections list navigate to that node on click (completed 2026-03-21)
- [ ] **Phase 54: Subgraph Isolation** - I key isolates selected node's N-hop neighborhood; 2/3 keys expand depth
- [ ] **Phase 55: Scan Version API** - /graph API exposes scan_version_id per service and connection
- [ ] **Phase 56: What-Changed Overlay** - New/modified nodes and edges from the latest scan are visually highlighted
- [ ] **Phase 57: Edge Bundling** - Parallel edges between same node pair collapse into single weighted edge with expand-in-panel
- [ ] **Phase 58: Documentation** - README and docs/commands.md updated with all v5.1 features

## Phase Details

### Phase 52: Keyboard Shortcuts & PNG Export
**Goal**: Users can navigate the graph and export diagrams without touching the mouse
**Depends on**: Phase 51 (v5.0 complete)
**Requirements**: NAV-01, NAV-02, NAV-03, EXP-01
**Success Criteria** (what must be TRUE):
  1. Pressing F with the graph focused fits all nodes to the visible canvas area (same effect as the fit button)
  2. Pressing Esc closes the detail panel and deselects any selected node
  3. Pressing / moves keyboard focus to the search input field immediately
  4. Clicking the export button downloads a PNG file of the current canvas view including all visible nodes and edges
**Plans**: 2 plans
Plans:
- [ ] 52-01-PLAN.md — keyboard.js: F/Esc/slash shortcut handler wired into graph.js
- [ ] 52-02-PLAN.md — export.js + Export PNG button in toolbar wired into graph.js

### Phase 53: Clickable Detail Panel Targets
**Goal**: Users can navigate directly to a connected node from the detail panel without manually finding it
**Depends on**: Phase 52
**Requirements**: NAV-04
**Success Criteria** (what must be TRUE):
  1. Clicking a service name in the detail panel's connections list selects that node and pans the canvas to center it
  2. The clicked node's detail panel opens, replacing the previous panel
  3. Clicking a target that is hidden by the current filter shows no broken behavior (click is a no-op or filter is surfaced)
**Plans**: 1 plan
Plans:
- [ ] 53-01-PLAN.md — Add selectAndPanToNode helper and .conn-target click wiring

### Phase 54: Subgraph Isolation
**Goal**: Users can focus on a selected node's immediate neighborhood, hiding the rest of the graph
**Depends on**: Phase 53
**Requirements**: NAV-05, NAV-06
**Success Criteria** (what must be TRUE):
  1. Pressing I on a selected node hides all nodes and edges not within 1 hop of that node
  2. Pressing 2 expands isolation to show all nodes and edges within 2 hops of the originally selected node
  3. Pressing 3 expands isolation to show all nodes and edges within 3 hops of the originally selected node
  4. Pressing Esc (or I again) exits isolation mode and restores the full graph view
**Plans**: 2 plans
Plans:
- [ ] 54-01-PLAN.md — Add isolation state fields and getNeighborIdsNHop BFS utility
- [ ] 54-02-PLAN.md — Wire isolation filter into renderer and add I/2/3/Esc keyboard handlers

### Phase 55: Scan Version API
**Goal**: The /graph API response carries scan_version_id on every service and connection so the frontend can compare recency
**Depends on**: Phase 51 (v5.0 complete — can be developed in parallel with Phases 52-54 but listed here before Phase 56)
**Requirements**: GRAPH-04
**Success Criteria** (what must be TRUE):
  1. Each service object in the /graph response includes a `scan_version_id` field with the ID of the scan that last updated it
  2. Each connection object in the /graph response includes a `scan_version_id` field with the ID of the scan that created it
  3. The maximum scan_version_id across all services represents the latest scan and is included in the response metadata
**Plans**: 1 plan
Plans:
- [ ] 55-01-PLAN.md — Add scan_version_id to getGraph() SQL and /graph response, with tests

### Phase 56: What-Changed Overlay
**Goal**: Nodes and edges introduced or modified in the latest scan are visually distinct so users can spot recent changes at a glance
**Depends on**: Phase 55
**Requirements**: GRAPH-03
**Success Criteria** (what must be TRUE):
  1. Nodes that were created or updated in the most recent scan are visually distinguished from unchanged nodes (glow effect or "NEW" badge)
  2. Edges that were created in the most recent scan are visually distinguished from unchanged edges
  3. The visual distinction is visible without selecting the node — it appears in the default graph view
  4. Unchanged nodes and edges render identically to how they did before this feature (no visual regression)
**Plans**: 2 plans

Plans:
- [ ] 56-01-PLAN.md — State layer: extract scan_version_id from /graph response, add latestScanVersionId + showChanges to state
- [ ] 56-02-PLAN.md — Render layer: glow ring for new nodes, bright edge for new edges, Changes toggle button

### Phase 57: Edge Bundling
**Goal**: Multiple parallel connections between the same source-target pair collapse into one weighted edge, reducing visual clutter
**Depends on**: Phase 56
**Requirements**: GRAPH-01, GRAPH-02
**Success Criteria** (what must be TRUE):
  1. When two or more edges share the same source and target nodes, they are rendered as a single thicker edge with a numeric badge showing the count
  2. The bundled edge color/style reflects the dominant or most severe protocol type among the bundled connections
  3. Clicking a bundled edge opens the detail panel listing all individual connections within the bundle (protocol, kind, endpoint)
  4. Unbundled (unique) edges render and behave identically to pre-bundling behavior
**Plans**: 2 plans
Plans:
- [ ] 57-01-PLAN.md — computeEdgeBundles + bundle rendering in renderer.js (thick line, count badge, mismatch cross)
- [ ] 57-02-PLAN.md — edgeHitTest + showBundlePanel (click bundle to see all connections)

### Phase 58: Documentation
**Goal**: README and commands reference are updated to accurately describe all v5.1 graph capabilities
**Depends on**: Phase 57
**Requirements**: DOC-01, DOC-02
**Success Criteria** (what must be TRUE):
  1. README contains a keyboard shortcut reference table listing F, Esc, /, I, 2, 3 with their actions
  2. README describes the PNG export button, subgraph isolation, what-changed overlay, and edge bundling in the graph UI section
  3. docs/commands.md graph UI section reflects all new interactive capabilities introduced in v5.1
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 52 → 53 → 54 → 55 → 56 → 57 → 58

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-13 | v1.0 | 17/17 | Complete | 2026-03-15 |
| 14-21 | v2.0 | 19/19 | Complete | 2026-03-15 |
| 22-26 | v2.1 | 11/11 | Complete | 2026-03-16 |
| 27-29 | v2.2 | 5/5 | Complete | 2026-03-16 |
| 30-32 | v2.3 | 5/5 | Complete | 2026-03-18 |
| 33-38 | v3.0 | 11/11 | Complete | 2026-03-18 |
| 39-45 | v4.0 | 14/14 | Complete | 2026-03-20 |
| 46-48 | v4.1 | 6/6 | Complete | 2026-03-20 |
| 49-51 | v5.0 | 5/5 | Complete | 2026-03-21 |
| 52. Keyboard Shortcuts & PNG Export | 2/2 | Complete   | 2026-03-21 | - |
| 53. Clickable Detail Panel Targets | 1/1 | Complete   | 2026-03-21 | - |
| 54. Subgraph Isolation | v5.1 | 0/2 | Not started | - |
| 55. Scan Version API | v5.1 | 0/1 | Not started | - |
| 56. What-Changed Overlay | v5.1 | 0/TBD | Not started | - |
| 57. Edge Bundling | v5.1 | 0/TBD | Not started | - |
| 58. Documentation | v5.1 | 0/TBD | Not started | - |
