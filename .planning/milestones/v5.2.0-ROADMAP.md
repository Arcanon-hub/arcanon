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
- ✅ **v5.1 Graph Interactivity** — Phases 52-58 (shipped 2026-03-21)
- 🚧 **v5.2.0 Plugin Distribution Fix** — Phases 59-61 (in progress)

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

<details>
<summary>✅ v5.1 Graph Interactivity (Phases 52-58) — SHIPPED 2026-03-21</summary>

- [x] Phase 52-58: 7 phases, 11 plans — keyboard shortcuts, subgraph isolation, what-changed overlay, edge bundling, PNG export

Full details: see Phase Details below (archived)

</details>

### 🚧 v5.2.0 Plugin Distribution Fix (In Progress)

**Milestone Goal:** Make the MCP server work when the plugin is installed from the marketplace by implementing runtime dependency installation and confirming correct ESM module resolution.

- [ ] **Phase 59: Runtime Dependency Installation** - SessionStart hook installs MCP runtime deps into ${CLAUDE_PLUGIN_ROOT} with idempotency guard and self-healing MCP wrapper
- [x] **Phase 60: MCP Server Launch Verification** - Confirm end-to-end MCP server startup from a marketplace-simulated install with ESM resolution working correctly
- [ ] **Phase 61: Version Sync** - All five manifest files bumped to 5.2.0 with automated bump script and root .mcp.json cleaned up

## Phase Details

<details>
<summary>✅ v5.1 Graph Interactivity (Phases 52-58) — SHIPPED 2026-03-21</summary>

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
- [x] 52-01-PLAN.md — keyboard.js: F/Esc/slash shortcut handler wired into graph.js
- [x] 52-02-PLAN.md — export.js + Export PNG button in toolbar wired into graph.js

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
- [x] 53-01-PLAN.md — Add selectAndPanToNode helper and .conn-target click wiring

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
- [x] 54-01-PLAN.md — Add isolation state fields and getNeighborIdsNHop BFS utility
- [x] 54-02-PLAN.md — Wire isolation filter into renderer and add I/2/3/Esc keyboard handlers

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
- [x] 55-01-PLAN.md — Add scan_version_id to getGraph() SQL and /graph response, with tests

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
- [x] 56-01-PLAN.md — State layer: extract scan_version_id from /graph response, add latestScanVersionId + showChanges to state
- [x] 56-02-PLAN.md — Render layer: glow ring for new nodes, bright edge for new edges, Changes toggle button

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
- [x] 57-01-PLAN.md — computeEdgeBundles + bundle rendering in renderer.js (thick line, count badge, mismatch cross)
- [x] 57-02-PLAN.md — edgeHitTest + showBundlePanel (click bundle to see all connections)

### Phase 58: Documentation
**Goal**: README and commands reference are updated to accurately describe all v5.1 graph capabilities
**Depends on**: Phase 57
**Requirements**: DOC-01, DOC-02
**Success Criteria** (what must be TRUE):
  1. README contains a keyboard shortcut reference table listing F, Esc, /, I, 2, 3 with their actions
  2. README describes the PNG export button, subgraph isolation, what-changed overlay, and edge bundling in the graph UI section
  3. docs/commands.md graph UI section reflects all new interactive capabilities introduced in v5.1
**Plans**: 1 plan

</details>

### Phase 59: Runtime Dependency Installation
**Goal**: The MCP server's runtime npm dependencies are installed into ${CLAUDE_PLUGIN_ROOT} on every session start, with idempotency to skip unchanged installs and a self-healing wrapper for the first-session race condition
**Depends on**: Phase 58 (v5.1 complete)
**Requirements**: DEPS-01, DEPS-02, DEPS-03, DEPS-04, MCP-02
**Success Criteria** (what must be TRUE):
  1. On the second session after marketplace install, all 8 MCP tools are visible to Claude (deps installed by SessionStart on first session)
  2. Running `/ligamen:map` twice does not trigger a second npm install (idempotency guard skips if runtime-deps.json is unchanged)
  3. If npm install fails mid-way, the next session retries from scratch rather than using a partial node_modules
  4. The existing session-start.sh session dedup logic is unaffected — dep install runs before SESSION_ID check
  5. The MCP wrapper script attempts self-healing dep install before exec'ing server.js, covering the first-session race
**Plans**: 2 plans
Plans:
- [ ] 59-01-PLAN.md — install-deps.sh with diff-based idempotency + hooks.json wiring + bats tests
- [ ] 59-02-PLAN.md — Self-healing mcp-wrapper.sh extension + .mcp.json wiring + bats tests

### Phase 60: MCP Server Launch Verification
**Goal**: The MCP server starts correctly from a marketplace-simulated install environment, with ESM resolution working without NODE_PATH and ChromaDB degrading gracefully when absent
**Depends on**: Phase 59
**Requirements**: MCP-01, MCP-03
**Success Criteria** (what must be TRUE):
  1. Starting the MCP server via the .mcp.json command after deps are installed at ${CLAUDE_PLUGIN_ROOT} produces no ERR_MODULE_NOT_FOUND errors
  2. All 8 MCP tools (5 impact + 3 drift) are listed and callable after server startup
  3. Removing @chroma-core/default-embed from node_modules and restarting the server does not crash it — the 3-tier search fallback activates instead
  4. The root dev-repo .mcp.json is confirmed as {"mcpServers": {}} and does not interfere with the plugin's .mcp.json
**Plans**: 1 plan
Plans:
- [x] 60-01-PLAN.md — MCP launch verification + ChromaDB fallback + root .mcp.json validation bats tests

### Phase 61: Version Sync
**Goal**: All five manifest files are at version 5.2.0 and a bump script prevents future version drift
**Depends on**: Phase 59 (runtime-deps.json version must be set correctly before install hook reads it; can run in parallel with Phase 60)
**Requirements**: VER-01, VER-02
**Success Criteria** (what must be TRUE):
  1. Running `claude plugin marketplace add` offers version 5.2.0 of the plugin (root marketplace.json is current)
  2. All five files (root marketplace.json, plugin marketplace.json, plugin.json, package.json, runtime-deps.json) contain the same version string
  3. Running `make check` passes when all versions match and fails when any file is out of sync
  4. Running `make bump VERSION=5.3.0` updates all five files atomically in one command
**Plans**: 1 plan
Plans:
- [ ] 61-01-PLAN.md — Bump all 5 manifests to 5.2.0 and verify root .mcp.json

### Phase 62: Plugin cleanup — add README, LICENSE, .gitignore to plugin dir, remove vestigial lint.json, add source guard to worker-client.sh

**Goal:** Plugin directory passes marketplace validation: metadata files present, vestigial hook config removed, all lib scripts consistently guarded against direct execution.
**Requirements**: none (cleanup — no requirement IDs)
**Depends on:** Phase 61
**Plans:** 1 plan

Plans:
- [ ] 62-01-PLAN.md — Add README.md, LICENSE, .gitignore to plugins/ligamen/; delete hooks/lint.json; add source guard to lib/worker-client.sh

## Progress

**Execution Order:**
Phases execute in numeric order: 59 → 60 → 61 → 62

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
| 52-58 | v5.1 | 11/11 | Complete | 2026-03-21 |
| 59. Runtime Dependency Installation | v5.2.0 | 0/2 | Not started | - |
| 60. MCP Server Launch Verification | v5.2.0 | 1/1 | Complete | 2026-03-21 |
| 61. Version Sync | v5.2.0 | 0/TBD | Not started | - |
| 62. Plugin Cleanup | v5.2.0 | 0/1 | Not started | - |
