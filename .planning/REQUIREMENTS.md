# Requirements: AllClear v2.0

**Defined:** 2026-03-15
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v2.0 Requirements

### Storage Foundation

- [ ] **STOR-01**: SQLite database created at `~/.allclear/projects/<hash>/impact-map.db` with WAL mode and FTS5 indexes
- [ ] **STOR-02**: Schema supports repos, services, connections, schemas, fields, map_versions, repo_state tables
- [ ] **STOR-03**: Query engine supports transitive impact queries via recursive CTEs with cycle detection and depth limit
- [ ] **STOR-04**: FTS5 indexes on service names, endpoint paths, and field names for keyword search
- [ ] **STOR-05**: Database migrations system for schema evolution across versions

### Worker Process

- [ ] **WRKR-01**: Node.js worker runs as background daemon with PID file at `~/.allclear/worker.pid`
- [ ] **WRKR-02**: Worker writes actual bound port to `~/.allclear/worker.port` for shell command discovery
- [ ] **WRKR-03**: Worker supports graceful shutdown on SIGTERM/SIGINT
- [ ] **WRKR-04**: Worker health check endpoint at `/api/readiness` confirms startup complete
- [ ] **WRKR-05**: Duplicate worker prevention via PID file check before spawn
- [ ] **WRKR-06**: Worker reads settings from `~/.allclear/settings.json`
- [ ] **WRKR-07**: Worker logs to `~/.allclear/logs/` with configurable log level

### MCP Server

- [ ] **MCPS-01**: stdio MCP server registered via `.mcp.json` at plugin root, auto-discovered by Claude Code
- [ ] **MCPS-02**: `impact_query` tool finds consumers/producers of an endpoint or service with transitive option
- [ ] **MCPS-03**: `impact_scan` tool triggers repo scan (incremental or full)
- [ ] **MCPS-04**: `impact_changed` tool reports what's affected by current git diff
- [ ] **MCPS-05**: `impact_graph` tool returns dependency subgraph for a service with configurable depth and direction
- [ ] **MCPS-06**: `impact_search` tool provides semantic search across the map (ChromaDB) or keyword search (FTS5 fallback)
- [ ] **MCPS-07**: MCP server is a separate Node.js stdio process (spawned by Claude Code via `.mcp.json`), reads SQLite directly — no dependency on worker being running for queries
- [ ] **MCPS-08**: MCP server implemented with @modelcontextprotocol/sdk using `McpServer` + `StdioServerTransport`

### HTTP Server & Web UI

- [ ] **HTTP-01**: Fastify HTTP server on configurable localhost port serving REST API and web UI
- [ ] **HTTP-02**: `GET /graph` returns full service dependency graph as JSON
- [ ] **HTTP-03**: `GET /impact?change=<endpoint>` returns affected services for a change
- [ ] **HTTP-04**: `GET /service/:name` returns service details and all connections
- [ ] **HTTP-05**: `POST /scan` triggers repo scan via API
- [ ] **HTTP-06**: `GET /versions` returns map version history
- [ ] **WEBUI-01**: Interactive D3 Canvas graph renders services as nodes and connections as edges
- [ ] **WEBUI-02**: Clicking a node highlights all its connections (upstream and downstream)
- [ ] **WEBUI-03**: Impact path highlighting shows transitive blast radius for a selected service
- [ ] **WEBUI-04**: Protocol filter toggles visibility by connection type (REST, gRPC, events, internal)
- [ ] **WEBUI-05**: Search box filters services by name
- [ ] **WEBUI-06**: Web UI is a single `index.html` with ESM CDN imports — zero build step

### Agent Scanning

- [ ] **SCAN-01**: `/allclear:map` spawns Claude agents into each confirmed repo path
- [ ] **SCAN-02**: Agents extract services, endpoints exposed/consumed, events produced/consumed, internal calls
- [ ] **SCAN-03**: Agents extract schemas with field-level detail (name, type, required)
- [ ] **SCAN-04**: Agents return findings with confidence levels (high/low)
- [ ] **SCAN-05**: Incremental scan detects changed files via git diff since last scanned commit
- [ ] **SCAN-06**: First scan forces full repo scan automatically
- [ ] **SCAN-07**: `--full` flag forces full scan on subsequent runs
- [ ] **SCAN-08**: Agents work on any language/framework with no external parser dependencies

### User Confirmation

- [ ] **UCON-01**: All findings require user confirmation before persistence, regardless of confidence level
- [ ] **UCON-02**: High-confidence findings presented as a batch summary for single confirm/edit
- [ ] **UCON-03**: Low-confidence findings prompt specific clarification questions (service boundaries, ambiguous targets, protocol)
- [ ] **UCON-04**: User can edit findings before confirmation (add, remove, modify services/connections)

### Repo Discovery

- [ ] **DISC-01**: `/allclear:map` checks `allclear.config.json` for existing `linked-repos`
- [ ] **DISC-02**: Even with config, checks memory + parent dir for repos NOT yet in config
- [ ] **DISC-03**: Presents combined repo list to user with newly discovered repos highlighted
- [ ] **DISC-04**: User confirms/edits repo list before scanning
- [ ] **DISC-05**: Confirmed list saved to `allclear.config.json`
- [ ] **DISC-06**: `--view` flag opens graph UI without scanning or repo confirmation

### Command Layer

- [ ] **CMDL-01**: `/allclear:map` orchestrates full flow: discover repos → confirm → scan → validate → persist → open UI
- [ ] **CMDL-02**: `/allclear:cross-impact` queries impact map for services affected by current changes
- [ ] **CMDL-03**: `/allclear:cross-impact` auto-detects changes from git diff when no args provided
- [ ] **CMDL-04**: `/allclear:cross-impact` walks graph transitively and classifies impact as CRITICAL/WARN/INFO
- [ ] **CMDL-05**: `/allclear:cross-impact` falls back to grep-based symbol scan when no map exists
- [ ] **CMDL-06**: After impact report, suggests full re-scan if map may be stale

### Integration & Config

- [ ] **INTG-01**: `session-start.sh` auto-starts worker when `impact-map` section exists in `allclear.config.json`
- [ ] **INTG-02**: `impact-map` section created automatically after first `/allclear:map` run
- [ ] **INTG-03**: ChromaDB sync runs asynchronously after SQLite writes when configured
- [ ] **INTG-04**: Search fallback chain: ChromaDB semantic → FTS5 keyword → direct SQL filter
- [ ] **INTG-05**: First map build recommends configuring ChromaDB and adding MCP server
- [ ] **INTG-06**: Map versioning creates SQLite snapshot before overwriting on re-scan (if user opts in)

## v3.0 Requirements

### Distribution

- **DIST-01**: `npx @allclear/cli init` installer copies plugin files and sets up symlinks
- **DIST-02**: Plugin published to Claude plugin registry / marketplace
- **DIST-03**: @allclear npm org reserved

### Enhanced Features

- **ENHN-01**: Rust MCP server rewrite for faster startup if latency becomes a problem
- **ENHN-02**: Multi-cluster kubectl context support for pulse/deploy commands
- **ENHN-03**: D3 layout toggle (force-directed vs hierarchical) for large graphs

## Out of Scope

| Feature | Reason |
|---------|--------|
| External parser dependencies (tree-sitter, stack-graphs) | Agents read code directly; no tooling setup required |
| Auto-persist findings without user confirmation | Silent graph corruption propagates to all impact queries |
| OpenAPI-only schema detection | Must discover schemas from code regardless of spec existence |
| Real-time file watching for map updates | On-demand scanning via `/allclear:map` is sufficient |
| Multi-user concurrent map editing | Single-developer local tool; SQLite WAL handles read concurrency |
| Cloud-hosted impact map service | Local-first; ChromaDB remote is optional enhancement, not a requirement |
| SVG renderer for D3 graph | Performance cliff at 30+ nodes; Canvas only |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STOR-01 | Phase 14 | Pending |
| STOR-02 | Phase 14 | Pending |
| STOR-03 | Phase 14 | Pending |
| STOR-04 | Phase 14 | Pending |
| STOR-05 | Phase 14 | Pending |
| WRKR-01 | Phase 15 | Pending |
| WRKR-02 | Phase 15 | Pending |
| WRKR-03 | Phase 15 | Pending |
| WRKR-04 | Phase 15 | Pending |
| WRKR-05 | Phase 15 | Pending |
| WRKR-06 | Phase 15 | Pending |
| WRKR-07 | Phase 15 | Pending |
| MCPS-01 | Phase 16 | Pending |
| MCPS-02 | Phase 16 | Pending |
| MCPS-03 | Phase 16 | Pending |
| MCPS-04 | Phase 16 | Pending |
| MCPS-05 | Phase 16 | Pending |
| MCPS-06 | Phase 16 | Pending |
| MCPS-07 | Phase 16 | Pending |
| MCPS-08 | Phase 16 | Pending |
| HTTP-01 | Phase 17 | Pending |
| HTTP-02 | Phase 17 | Pending |
| HTTP-03 | Phase 17 | Pending |
| HTTP-04 | Phase 17 | Pending |
| HTTP-05 | Phase 17 | Pending |
| HTTP-06 | Phase 17 | Pending |
| WEBUI-01 | Phase 17 | Pending |
| WEBUI-02 | Phase 17 | Pending |
| WEBUI-03 | Phase 17 | Pending |
| WEBUI-04 | Phase 17 | Pending |
| WEBUI-05 | Phase 17 | Pending |
| WEBUI-06 | Phase 17 | Pending |
| SCAN-01 | Phase 18 | Pending |
| SCAN-02 | Phase 18 | Pending |
| SCAN-03 | Phase 18 | Pending |
| SCAN-04 | Phase 18 | Pending |
| SCAN-05 | Phase 18 | Pending |
| SCAN-06 | Phase 18 | Pending |
| SCAN-07 | Phase 18 | Pending |
| SCAN-08 | Phase 18 | Pending |
| UCON-01 | Phase 19 | Pending |
| UCON-02 | Phase 19 | Pending |
| UCON-03 | Phase 19 | Pending |
| UCON-04 | Phase 19 | Pending |
| DISC-01 | Phase 19 | Pending |
| DISC-02 | Phase 19 | Pending |
| DISC-03 | Phase 19 | Pending |
| DISC-04 | Phase 19 | Pending |
| DISC-05 | Phase 19 | Pending |
| DISC-06 | Phase 19 | Pending |
| CMDL-01 | Phase 20 | Pending |
| CMDL-02 | Phase 20 | Pending |
| CMDL-03 | Phase 20 | Pending |
| CMDL-04 | Phase 20 | Pending |
| CMDL-05 | Phase 20 | Pending |
| CMDL-06 | Phase 20 | Pending |
| INTG-01 | Phase 21 | Pending |
| INTG-02 | Phase 21 | Pending |
| INTG-03 | Phase 21 | Pending |
| INTG-04 | Phase 21 | Pending |
| INTG-05 | Phase 21 | Pending |
| INTG-06 | Phase 21 | Pending |

**Coverage:**
- v2.0 requirements: 62 total (STOR: 5, WRKR: 7, MCPS: 8, HTTP: 6, WEBUI: 6, SCAN: 8, UCON: 4, DISC: 6, CMDL: 6, INTG: 6)
- Mapped to phases: 62
- Unmapped: 0

Note: The original header stated 58 requirements; actual count from requirement IDs is 62. All 62 are mapped.

---
*Requirements defined: 2026-03-15*
*Last updated: 2026-03-15 after roadmap creation — all requirements mapped to phases 14-21*
