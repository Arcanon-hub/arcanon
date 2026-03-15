# Roadmap: AllClear

## Milestones

- ✅ **v1.0 Plugin Foundation** — Phases 1-13 (shipped 2026-03-15)
- **v2.0 Service Dependency Intelligence** — Phases 14-21 (in progress)

## Phases

<details>
<summary>✅ v1.0 Plugin Foundation (Phases 1-13) — SHIPPED 2026-03-15</summary>

- [x] Phase 1: Plugin Skeleton (1/1 plans) — completed 2026-03-15
- [x] Phase 2: Shared Libraries (1/1 plans) — completed 2026-03-15
- [x] Phase 3: Format Hook (1/1 plans) — completed 2026-03-15
- [x] Phase 4: Lint Hook (1/1 plans) — completed 2026-03-15
- [x] Phase 5: Guard Hook (1/1 plans) — completed 2026-03-15
- [x] Phase 6: Session Hook (2/2 plans) — completed 2026-03-15
- [x] Phase 7: Quality Gate Skill (1/1 plans) — completed 2026-03-15
- [x] Phase 8: Config Layer (1/1 plans) — completed 2026-03-15
- [x] Phase 9: Impact Skill (1/1 plans) — completed 2026-03-15
- [x] Phase 10: Drift Skill (2/2 plans) — completed 2026-03-15
- [x] Phase 11: Pulse Skill (1/1 plans) — completed 2026-03-15
- [x] Phase 12: Deploy Skill (1/1 plans) — completed 2026-03-15
- [x] Phase 13: Tests (3/3 plans) — completed 2026-03-15

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### v2.0 Service Dependency Intelligence

- [ ] **Phase 14: Storage Foundation** — SQLite schema, WAL mode, FTS5 indexes, query engine with transitive CTE traversal
- [ ] **Phase 15: Worker Lifecycle** — Node.js daemon, PID file management, readiness probe, worker shell client
- [ ] **Phase 16: MCP Server** — stdio MCP server with impact tools, .mcp.json registration, stderr-only logging
- [ ] **Phase 17: HTTP Server & Web UI** — Fastify REST API, D3 Canvas force-directed graph, single-file UI
- [ ] **Phase 18: Agent Scanning** — Claude agent orchestration, structured findings extraction, incremental scan
- [ ] **Phase 19: Repo Discovery & User Confirmation** — repo discovery flow, confirmation UX grouped by confidence, config persistence
- [ ] **Phase 20: Command Layer** — /allclear:map orchestration, /allclear:cross-impact redesign with fallback
- [ ] **Phase 21: Integration & Config** — session hook auto-start, ChromaDB async sync, E2E tests

## Phase Details

### Phase 14: Storage Foundation
**Goal**: The SQLite database and query engine are fully operational and capable of persisting a service dependency graph and answering transitive impact queries
**Depends on**: Nothing (first v2.0 phase)
**Requirements**: STOR-01, STOR-02, STOR-03, STOR-04, STOR-05
**Success Criteria** (what must be TRUE):
  1. Running `node worker/db.js` creates `~/.allclear/projects/<hash>/impact-map.db` with WAL mode enabled and all required tables (repos, services, connections, schemas, fields, map_versions, repo_state)
  2. A transitive impact query on a 3-hop dependency chain (A→B→C→D) returns all three intermediate services and detects cycles in a deliberately cyclic graph without infinite-looping
  3. FTS5 search on service name, endpoint path, or field name returns matching results; a keyword not present in those columns returns no results
  4. Running migrations on an existing database with prior schema version upgrades the schema without data loss
  5. Direct SQL queries to the query engine correctly classify a removed endpoint as CRITICAL, a changed field type as WARN, and an added field as INFO
**Plans**: 2 plans
Plans:
- [ ] 14-01-PLAN.md — SQLite database module: WAL mode, schema, FTS5 indexes, migration system
- [ ] 14-02-PLAN.md — Query engine: transitive recursive CTE traversal, cycle detection, breaking change classification

### Phase 15: Worker Lifecycle
**Goal**: The AllClear worker can be reliably started as a background daemon, detected as running or stale, and stopped cleanly, with shell utilities that all subsequent commands reuse
**Depends on**: Phase 14
**Requirements**: WRKR-01, WRKR-02, WRKR-03, WRKR-04, WRKR-05, WRKR-06, WRKR-07
**Success Criteria** (what must be TRUE):
  1. `scripts/worker-start.sh` starts the worker, writes a PID file to `~/.allclear/worker.pid`, writes the bound port to `~/.allclear/worker.port`, and exits without blocking
  2. Running `worker-start.sh` a second time while the worker is running prints "worker already running (PID N)" and exits without spawning a duplicate process
  3. A stale PID file (process no longer exists) is detected and cleared before a new worker is spawned
  4. `GET /api/readiness` returns 200 only after the worker is fully initialized; the readiness probe (`wait_for_worker()` in `lib/worker-client.sh`) polls until readiness or times out with a clear error
  5. `scripts/worker-stop.sh` sends SIGTERM, the worker flushes state and exits cleanly, and the PID file is removed
  6. Worker reads `ALLCLEAR_LOG_LEVEL` from `~/.allclear/settings.json` and writes structured logs to `~/.allclear/logs/`
**Plans**: 2 plans
Plans:
- [ ] 15-01-PLAN.md — Shell lifecycle scripts (worker-start.sh, worker-stop.sh, lib/worker-client.sh) with PID/port management and readiness probe
- [ ] 15-02-PLAN.md — Worker entry point (worker/index.js), package.json v2.0 dependencies, bats lifecycle test suite

### Phase 16: MCP Server
**Goal**: Claude Code agents can autonomously check impact via MCP tools without any running worker, querying SQLite directly through the stdio MCP server
**Depends on**: Phase 14
**Requirements**: MCPS-01, MCPS-02, MCPS-03, MCPS-04, MCPS-05, MCPS-06, MCPS-07, MCPS-08
**Success Criteria** (what must be TRUE):
  1. `.mcp.json` at the plugin root is auto-discovered by Claude Code and the `allclear-impact` MCP server appears in Claude Code's tool list without any manual settings.json editing
  2. `impact_query` tool called with a service name returns all consumers of that service, including transitive consumers when `transitive: true` is passed
  3. `impact_changed` tool called in a repo with uncommitted changes returns the services affected by those specific file changes
  4. All five MCP tools (`impact_query`, `impact_scan`, `impact_changed`, `impact_graph`, `impact_search`) return empty results (not errors) when the database does not yet exist
  5. No `console.log` call in `worker/mcp-server.js` — all logging goes to stderr — verified by a CI lint check; calling any tool returns a valid JSON-RPC response without stdout corruption
**Plans**: 3 plans
Plans:
- [ ] 16-01-PLAN.md — MCP server skeleton: package.json deps, worker/mcp-server.js foundation, .mcp.json registration
- [ ] 16-02-PLAN.md — All 5 MCP tools: impact_query, impact_changed, impact_graph, impact_search, impact_scan
- [ ] 16-03-PLAN.md — CI lint check (console.log guard), bats test suite, human verification checkpoint

### Phase 17: HTTP Server & Web UI
**Goal**: Users can open a browser and see their service dependency graph as an interactive force-directed visualization, and the REST API supports all graph query operations
**Depends on**: Phase 14
**Requirements**: HTTP-01, HTTP-02, HTTP-03, HTTP-04, HTTP-05, HTTP-06, WEBUI-01, WEBUI-02, WEBUI-03, WEBUI-04, WEBUI-05, WEBUI-06
**Success Criteria** (what must be TRUE):
  1. `GET /api/readiness` returns 200 immediately after worker starts — this is the first Fastify route registered, before any DB initialization
  2. `GET /graph` returns JSON with all services as nodes and all connections as edges; `GET /impact?change=<endpoint>` returns the services affected by that endpoint
  3. `GET /service/:name` returns service details and all upstream/downstream connections; `GET /versions` returns the map version history list
  4. Opening the web UI in a browser renders all services as Canvas nodes with labeled edges; clicking a node highlights all its direct connections in a distinct color
  5. The transitive blast radius for a selected service is visually highlighted across all hops; the protocol filter toggles hide/show connections by type; the search box filters the visible node set by name
  6. The web UI is a single `index.html` file that loads via ESM CDN imports with no build step — no bundler, no npm install required to view it
**Plans**: 2 plans
Plans:
- [ ] 17-01-PLAN.md — Fastify HTTP server with all REST API routes and npm dependency setup
- [ ] 17-02-PLAN.md — D3 Canvas web UI with force-directed graph, interactions, and visual verification

### Phase 18: Agent Scanning
**Goal**: The scan manager can dispatch Claude agents into linked repos, collect structured service dependency findings with confidence levels, and perform incremental scans based on git history
**Depends on**: Phase 14, Phase 17
**Requirements**: SCAN-01, SCAN-02, SCAN-03, SCAN-04, SCAN-05, SCAN-06, SCAN-07, SCAN-08
**Success Criteria** (what must be TRUE):
  1. `/allclear:map` (run from the command layer stub) triggers agent spawning into each confirmed repo path; agents run in the foreground (not background) and complete sequentially
  2. Agents return structured findings containing services, exposed/consumed endpoints, events produced/consumed, internal calls, and schemas with field-level detail — for a repo in any language without requiring language-specific tooling
  3. Each finding includes a confidence level (high or low); a service whose name appears ambiguously in source returns low confidence, while a service with explicit declaration returns high confidence
  4. Running a second scan on a repo that has not changed since the last scanned commit results in zero findings (no unchanged files are re-scanned); the `repo_state` table reflects the last scanned commit
  5. Running with `--full` flag rescans all files regardless of git state; first-time scan automatically performs a full scan even without the flag
**Plans**: 2 plans
Plans:
- [ ] 18-01-PLAN.md — Agent prompt template and findings schema/validator (SCAN-02, SCAN-03, SCAN-04, SCAN-08)
- [ ] 18-02-PLAN.md — Scan manager core: agent dispatch, incremental scan, repo_state tracking (SCAN-01, SCAN-05, SCAN-06, SCAN-07)

### Phase 19: Repo Discovery & User Confirmation
**Goal**: Users are shown all their linked repos (including newly discovered ones) and must confirm every agent finding before any data is written to SQLite
**Depends on**: Phase 18
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06, UCON-01, UCON-02, UCON-03, UCON-04
**Success Criteria** (what must be TRUE):
  1. When `allclear.config.json` exists, `/allclear:map` loads its `linked-repos` then checks memory and the parent directory for additional repos not yet in the config; newly found repos are visually distinguished in the presented list
  2. The user can edit the repo list (add or remove repos) before confirming; the confirmed list is saved to `allclear.config.json`
  3. High-confidence findings are presented as a single grouped batch summary — the user confirms or edits the entire batch in one step rather than one finding at a time
  4. Low-confidence findings trigger specific clarifying questions (service boundaries, ambiguous call targets, protocol identification); at most 10 low-confidence findings are presented per scan run
  5. The user can edit any finding (add, remove, or modify services and connections) before confirming; no findings are written to SQLite until the user explicitly confirms
  6. Running `/allclear:map --view` opens the graph UI directly without triggering repo discovery, scanning, or any confirmation flow
**Plans**: 2 plans
Plans:
- [ ] 19-01-PLAN.md — Repo discovery module (loadFromConfig, discoverNew, saveConfirmed, formatRepoList, isViewOnlyMode)
- [ ] 19-02-PLAN.md — User confirmation flow (groupByConfidence, formatHighConfidenceSummary, formatLowConfidenceQuestions, applyEdits, buildConfirmationPrompt)

### Phase 20: Command Layer
**Goal**: `/allclear:map` and `/allclear:cross-impact` are fully operational as user-facing commands that orchestrate the worker pipeline and degrade gracefully when no map exists
**Depends on**: Phase 15, Phase 16, Phase 17, Phase 18, Phase 19
**Requirements**: CMDL-01, CMDL-02, CMDL-03, CMDL-04, CMDL-05, CMDL-06
**Success Criteria** (what must be TRUE):
  1. `/allclear:map` executes the complete flow end-to-end: discover repos → present list → confirm → scan → confirm findings → persist to SQLite → open graph UI in browser
  2. `/allclear:cross-impact` with no arguments auto-detects changes from `git diff` (uncommitted and recent commits) and queries the impact map for affected services
  3. The impact report classifies affected services as CRITICAL (endpoint removed), WARN (field type changed), or INFO (additive change), and walks the graph transitively to show full blast radius
  4. When no impact map exists, `/allclear:cross-impact` falls back to grep-based symbol scanning and suggests running `/allclear:map`; when a map exists but may be stale after code changes, it offers a re-scan
  5. First successful map build prints MCP server registration instructions to help users enable impact checking in all their Claude Code agents
**Plans**: 2 plans
Plans:
- [ ] 20-01-PLAN.md — Create commands/map.md: full /allclear:map orchestration flow
- [ ] 20-02-PLAN.md — Rewrite commands/cross-impact.md: worker-aware graph queries with legacy grep fallback

### Phase 21: Integration & Config
**Goal**: The worker auto-starts transparently at session open when a map exists, ChromaDB enhances search without blocking any core path, and the full scan-to-query flow is covered by integration tests
**Depends on**: Phase 15, Phase 20
**Requirements**: INTG-01, INTG-02, INTG-03, INTG-04, INTG-05, INTG-06
**Success Criteria** (what must be TRUE):
  1. Opening a new Claude Code session in a project where `allclear.config.json` has an `impact-map` section automatically starts the worker in the background; the session-start hook exits immediately without blocking
  2. The `impact-map` section is absent from `allclear.config.json` before the first `/allclear:map` run and present afterward; removing it disables worker auto-start
  3. When ChromaDB is configured, vector sync runs asynchronously after SQLite writes complete; a ChromaDB outage does not prevent SQLite persistence and generates a warning, not an error
  4. A search query resolves via ChromaDB semantic search when available, falls back to FTS5 keyword search, then falls back to direct SQL filter — each fallback is reachable by taking its predecessor offline
  5. Integration tests cover the complete flow: full scan → user confirmation → SQLite persist → impact query returns correct transitive results; incremental scan → only changed-file findings returned
**Plans**: 4 plans
Plans:
- [ ] 21-01-PLAN.md — Modify session-start.sh: worker auto-start when impact-map section present (INTG-01, INTG-02)
- [ ] 21-02-PLAN.md — Create worker/chroma-sync.js and add 3-tier search fallback to query-engine.js (INTG-03, INTG-04)
- [ ] 21-03-PLAN.md — Add createSnapshot/isFirstScan to worker/db.js and first-run recommendations to SKILL.md (INTG-05, INTG-06)
- [ ] 21-04-PLAN.md — Integration test suite: E2E scan-to-query, incremental scan, ChromaDB fallback, session hook (all INTG-*)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-13 | v1.0 | 17/17 | Complete | 2026-03-15 |
| 14. Storage Foundation | v2.0 | 0/2 | In progress | - |
| 15. Worker Lifecycle | 1/2 | In Progress|  | - |
| 16. MCP Server | 1/3 | In Progress|  | - |
| 17. HTTP Server & Web UI | v2.0 | 0/2 | Planned | - |
| 18. Agent Scanning | v2.0 | 0/2 | Not started | - |
| 19. Repo Discovery & User Confirmation | v2.0 | 0/2 | Not started | - |
| 20. Command Layer | v2.0 | 0/2 | Planned | - |
| 21. Integration & Config | v2.0 | 0/4 | Planned | - |
