# Roadmap: Arcanon

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
- ✅ **v5.2.0 Plugin Distribution Fix** — Phases 59-62 (shipped 2026-03-21)
- ✅ **v5.2.1 Scan Data Integrity** — Phases 63-66 (shipped 2026-03-21)
- ✅ **v5.3.0 Scan Intelligence & Enrichment** — Phases 67-73 (shipped 2026-03-22)
- ✅ **v5.4.0 Scan Pipeline Hardening** — Phases 74-79 (shipped 2026-03-22)
- ✅ **v5.5.0 Security & Data Integrity Hardening** — Phases 80-83 (shipped 2026-03-22)
- ✅ **v5.6.0 Logging & Observability** — Phases 84-88 (shipped 2026-03-23)
- ✅ **v5.7.0 Scan Accuracy** — Phases 89-91 (shipped 2026-03-23)
- ✅ **v5.8.0 Library Drift & Language Parity** — Phases 92-96 (shipped 2026-04-19)
- ✅ **v0.1.1 Command Cleanup + Update + Ambient Hooks** — Phases 97-100 (shipped 2026-04-21)
- ✅ **v0.1.2 Ligamen Residue Purge** — Phases 101-105 (shipped 2026-04-23)
- ✅ **v0.1.3 Trust & Foundations** — Phases 107-113 (shipped 2026-04-25)
- ✅ **v0.1.4 Operator Surface** — Phases 114-122 (shipped 2026-04-27)
- ✅ **v0.1.5 Identity & Privacy** — Phases 123-127 (shipped 2026-04-30)
- ✅ **v0.1.6 / v0.1.7 Resilient Dependency Install** — install-deps + MCP launcher hardening (shipped 2026-06-16, outside roadmap)
- ✅ **v0.1.8 Native SQLite Migration** — Phase 128 (shipped 2026-06-20, PR #38)
- ✅ **v0.1.9 Shadow Trio Removal, Rescan Repair & Scan/Mismatch Fixes** — Phases 129-134 (shipped 2026-06-29)
- 🔄 **v0.2.0 Scan Persistence, Pipeline & Security Hardening** — Phases 135-143 (active)

## Phases

### v0.2.0 Scan Persistence, Pipeline & Security Hardening (Phases 135-143) — ACTIVE

- [ ] **Phase 135: Shell-Exec Hardening** - Replace string-interpolated git/oasdiff calls in MCP server with execFileSync/argv; validate git revision inputs; suppress evidence from logs
- [ ] **Phase 136: Hub Queue Tenant-Binding** - Bind Hub queue rows to immutable org/URL at enqueue time; dead-on-non-retriable 4xx; safe legacy row migration
- [ ] **Phase 137: DB Isolation & Pool** - Replace global openDb() singleton with factory/pool keyed by canonical project identity; real per-project integration tests
- [ ] **Phase 138: Transactional Scan Unit-of-Work** - Full scan as one atomic transaction; repo-scoped-only cleanup; failure recovery for abandoned scans
- [ ] **Phase 139: History Model, Run Identifier & Child Reconciliation** - Explicit history/version model (design decision); project run ID; full child-state reconciliation on successful scan
- [ ] **Phase 140: Canonical Contract** - Single executable contract for all finding shapes; every persistence entry point validates; schema findings attach to exactly one connection
- [ ] **Phase 141: ScanService Unification** - One ScanService behind commands, MCP, HTTP; fix MCP false-success, rescan override throw, incremental delete; end-to-end transport tests
- [ ] **Phase 142: Integration Correctness** - Fix drift-graph SQL; Chroma sync in transactional completion path with project namespacing; fix UI dangling-edge rendering
- [ ] **Phase 143: Scaling & Runtime Hardening** - Response pagination, batched N+1 queries, index tests, bounded concurrency, pool lifecycle, async Fastify routes

<details>
<summary>✅ v0.1.9 Shadow Trio Removal, Rescan Repair & Scan/Mismatch Fixes (Phases 129-134) — SHIPPED 2026-06-29</summary>

- [x] Phase 129: Shadow Trio Removal, Rescan Repair & Docs (3/3 plans) — shadow trio + worker machinery removed, `/arcanon:rescan` repointed to node:sqlite, docs scrubbed (PR #41)
- [x] Phase 130: Regression Tests & Release Gate (2/2 plans) — rescan inline-node + reintroduction guard tests, manifests pinned to 0.1.9
- [x] Phase 131: Protocol vocabulary canonicalization, #42 (3/3 plans) — single canonical vocabulary scan→persist→getGraph→UI, fallback-not-reject (PR #44)
- [x] Phase 132: detectMismatches parameterized-route fix, #43 (1/1 plan) — two-sided `{param}`→`{_}` canonicalization + rest/grpc allowlist (PR #47)
- [x] Phase 133: Scanner backing-service client detection, #45 (2/2 plans) — reasoning-based network-DB/broker client detection, two-stage `backing_service_deps` handoff (PR #48)
- [x] Phase 134: detectMismatches method-aware matching, #46 (2/2 plans) — `(method, canonicalPath)`-keyed `exposedByMethod` Map (PR #48)

Full details: `.planning/milestones/v0.1.9-ROADMAP.md` · Audit: `.planning/milestones/v0.1.9-MILESTONE-AUDIT.md`

</details>

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

<details>
<summary>✅ v5.2.0 Plugin Distribution Fix (Phases 59-62) — SHIPPED 2026-03-21</summary>

- [x] Phase 59-62: 4 phases — runtime dep install, MCP launch verification, version sync, plugin cleanup

Full details: see Phase Details below (archived)

</details>

<details>
<summary>✅ v5.2.1 Scan Data Integrity (Phases 63-66) — SHIPPED 2026-03-21</summary>

- [x] Phase 63-66: 4 phases — scan bracket integrity, undefined value crash chain, service ID scoping, agent interaction fixes

Full details: see Phase Details below (archived)

</details>

<details>
<summary>✅ v5.3.0 Scan Intelligence & Enrichment (Phases 67-73) — SHIPPED 2026-03-22</summary>

- [x] Phase 67-73: 7 phases, 12 plans — enrichment architecture, CODEOWNERS, auth/DB extraction, confidence/evidence pipeline, schema storage, detail panel UI, agent prompts, quality-gate spinout

Full details: see Phase Details below (archived)

</details>

<details>
<summary>✅ v5.4.0 Scan Pipeline Hardening (Phases 74-79) — SHIPPED 2026-03-22</summary>

- [x] Phase 74-79: 6 phases, 9 plans — phantom actor guard, repo type fixes, CODEOWNERS path fix, findings validation, discovery phase wiring, prompt debiasing, parallel scan fan-out, actor dedup, version bump

Full details: see Phase Details below (archived)

</details>

<details>
<summary>✅ v5.5.0 Security & Data Integrity Hardening (Phases 80-83) — SHIPPED 2026-03-22</summary>

- [x] Phase 80-83: 4 phases, 9 plans — path traversal hardening, credential entropy rejection, concurrent scan lock, data integrity ports, agent output parsing, transitive depth limits, FTS5 caching, journal mode tests, map project name UX

Full details: see Phase Details below (archived)

</details>

<details>
<summary>✅ v5.6.0 Logging & Observability (Phases 84-88) — SHIPPED 2026-03-23</summary>

- [x] Phase 84-88: 5 phases, 6 plans — size-based log rotation, TTY-aware stderr suppression, structured error logging with stack traces in HTTP/MCP handlers, scan lifecycle logging, extractor logger wiring, QueryEngine logger injection

Full details: `.planning/milestones/v5.6.0-ROADMAP.md`

</details>

<details>
<summary>✅ v5.7.0 Scan Accuracy (Phases 89-91) — SHIPPED 2026-03-23</summary>

- [x] Phase 89-91: 3 phases, 3 plans — three-value crossing semantics, post-scan reconciliation, mono-repo detection, client_files discovery schema, version bump

Full details: `.planning/milestones/v5.7.0-ROADMAP.md`

</details>

<details>
<summary>✅ v5.8.0 Library Drift & Language Parity (Phases 92-96) — SHIPPED 2026-04-19</summary>

- [x] Phase 92-96: 5 phases, 16 plans — Maven/Gradle/NuGet/Bundler parsers, Java/C#/Ruby language parity, service_dependencies persistence, drift dispatcher unification, hub payload v1.1 with feature flag

Full details: `.planning/milestones/v5.8.0-ROADMAP.md`

</details>

<details>
<summary>✅ v0.1.1 Command Cleanup + Update + Ambient Hooks (Phases 97-100) — SHIPPED 2026-04-21</summary>

- [x] Phase 97-100: 4 phases, 12 plans — merged `/arcanon:cross-impact` → `/arcanon:impact` with `--exclude`/`--changed`/3-state degradation, deprecated `/arcanon:upload` stub, `auto_upload` → `auto_sync` rename with fallback, new `/arcanon:update` self-update flow (check/kill/prune/verify), SessionStart banner enrichment (N services + K load-bearing files + hub status), PreToolUse impact hook (Tier 1 schema patterns + Tier 2 SQLite + worker HTTP fallback, p99 <50ms Linux target)

Full details: `.planning/milestones/v0.1.1-ROADMAP.md`

</details>

<details>
<summary>✅ v0.1.2 Ligamen Residue Purge (Phases 101-105) — SHIPPED 2026-04-23</summary>

- [x] Phase 101-105: 5 phases, 9 plans — hard-removed all `LIGAMEN_*` env var reads, `$HOME/.ligamen` fallback, `ligamen.config.json` reader; renamed ChromaDB collection `ligamen-impact` → `arcanon-impact`; renamed runtime-deps package `@ligamen` → `@arcanon`; rewrote 17 test files to exercise `ARCANON_*`; CHANGELOG BREAKING section added; README legacy paragraphs + Related repos section deleted

Full details: `.planning/milestones/v0.1.2-ROADMAP.md`

</details>

<details>
<summary>✅ v0.1.3 Trust & Foundations (Phases 107-113) — SHIPPED 2026-04-25</summary>

- [x] Phase 107-113: 7 phases, 14 plans — install architecture cleanup (drop runtime-deps.json, sha256 sentinel + binding-load validation, simplified mcp-wrapper.sh), `/arcanon:update --check` timeout decoupled, `/arcanon:upload` deprecated stub removed, scan trust hardening (path canonicalization, evidence-at-ingest, services.base_path, scan_versions.quality_score, enrichment_log + impact_audit_log MCP tool, new `/arcanon:verify` command)

Full details: `.planning/milestones/v0.1.3-ROADMAP.md`

</details>

<details>
<summary>✅ v0.1.4 Operator Surface (Phases 114-122) — SHIPPED 2026-04-27</summary>

- [x] Phase 114-122: 9 phases, 21 plans — 9 new operator slash commands (`/list`, `/view`, `/doctor`, `/diff`, `/correct`, `/rescan`, `/shadow-scan`, `/promote-shadow`, `/diff --shadow`); universal `--help` system via `lib/help.sh`; per-repo git-commits-since-scan freshness via new `GET /api/scan-freshness`; scan-corrections workflow (`scan_overrides` table mig 017, `applyPendingOverrides` apply-hook); validate-before-commit shadow-DB pattern (atomic POSIX rename with WAL sidecars); hub payload v1.2 envelope (byte-identical for v1.1 callers via Test M11); offline + explicit-spec drift; `known-externals.yaml` curated catalog with user `external_labels` extension and `actors.label` migration 018. Architectural correction at release prep: `/arcanon:rescan` and `/arcanon:shadow-scan` re-shaped from worker-HTTP to markdown-orchestrated (cloning `/arcanon:map`'s pattern), eliminating production agent-runner gap. Zero deferred items at ship.

Full details: `.planning/milestones/v0.1.4-ROADMAP.md`

</details>

<details>
<summary>✅ v0.1.5 Identity & Privacy (Phases 123-127) — SHIPPED 2026-04-30</summary>

- [x] Phase 123-127: 5 phases, 5 plans — `worker/lib/path-mask.js` + 4 egress seams (MCP / HTTP / logger / export) + parse-time PII-06 reject (PII-01..07); `uploadScan` `X-Org-Id` header + new `whoami.js` client + `resolveCredentials` precedence chain (opts → env → home-config) + `default_org_id` config field + per-repo `hub.org_id` override (AUTH-01..05); `/arcanon:login` whoami-driven 4×2 branch table with multi-grant `AskUserQuestion` re-entry (exit-7 + stdout sentinel) + `/arcanon:status` Identity block (nested in `--json`) + 7-code RFC 7807 error parser + 4-file docs sweep (AUTH-06..09); regression test suite (+3 net tests on top of 824 baseline; AUTH-10); manifests pinned at 0.1.5, CHANGELOG `[0.1.5]` with BREAKING/THE-1030 callout, bats 458/459 + node 823/824 green at v0.1.4 floors (VER-01..03). Operator e2e walkthrough (VER-04) deferred — 3 bundled checkpoints pending arcanon-hub THE-1030 deploy.

Full details: `.planning/milestones/v0.1.5-ROADMAP.md`

</details>

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

<details>
<summary>✅ v5.2.0 Plugin Distribution Fix (Phases 59-62) — SHIPPED 2026-03-21</summary>

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

- [x] 59-01-PLAN.md — install-deps.sh with diff-based idempotency + hooks.json wiring + bats tests
- [x] 59-02-PLAN.md — Self-healing mcp-wrapper.sh extension + .mcp.json wiring + bats tests

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

- [x] 61-01-PLAN.md — Bump all 5 manifests to 5.2.0 and verify root .mcp.json

### Phase 62: Plugin Cleanup

**Goal**: Plugin directory passes marketplace validation: metadata files present, vestigial hook config removed, all lib scripts consistently guarded against direct execution.
**Depends on**: Phase 61
**Requirements**: none (cleanup — no requirement IDs)
**Plans**: 1 plan
Plans:

- [x] 62-01-PLAN.md — Add README.md, LICENSE, .gitignore to plugins/ligamen/; delete hooks/lint.json; add source guard to lib/worker-client.sh

</details>

<details>
<summary>✅ v5.2.1 Scan Data Integrity (Phases 63-66) — SHIPPED 2026-03-21</summary>

### Phase 63: Scan Bracket Integrity

**Goal**: POST /scan endpoint applies the beginScan/endScan version bracket for atomic stale-row cleanup, and a one-time garbage collection removes legacy NULL scan_version_id rows left by pre-bracket scans
**Depends on**: Phase 62 (v5.2.0 complete)
**Requirements**: SCAN-01, SCAN-02
**Success Criteria** (what must be TRUE):

  1. After a full scan completes, services and connections from prior scans that were not touched in the new scan are absent from the /graph response
  2. If a scan is interrupted or fails partway through, the prior scan's data remains intact — no partial updates visible in the graph
  3. Running a full scan on a repo with pre-existing NULL scan_version_id rows leaves no NULL scan_version_id rows in services or connections for that repo
  4. The /graph response returns only rows belonging to the latest scan bracket — no ghost rows from previous runs

**Plans**: 2 plans
Plans:

- [x] 63-01-PLAN.md — POST /scan: wrap persistFindings in beginScan/endScan bracket (THE-930)
- [x] 63-02-PLAN.md — endScan(): add NULL scan_version_id GC after successful bracket close (THE-931)

### Phase 64: Undefined Value Crash Chain

**Goal**: upsertService and upsertConnection sanitize JavaScript undefined values to null before SQLite binding, and the CLI fallback scan resolves the project database by explicit root path rather than process.cwd()
**Depends on**: Phase 63
**Requirements**: SREL-02, SREL-03
**Success Criteria** (what must be TRUE):

  1. Scanning a service whose manifest produces undefined optional fields (description, version, language) completes without a SQLite binding error
  2. When the worker crashes and the CLI fallback scan runs, it writes scan results to the correct project database rather than a cwd-relative fallback path
  3. After a crash-recovery fallback scan, the /graph response reflects the correct project's data — not a phantom database created at the wrong path
  4. Re-running `/ligamen:map` after a previous crash-recovery produces a clean scan with no orphaned database files

**Plans**: 2 plans
Plans:

- [x] 64-01-PLAN.md — Add sanitizeBindings() helper to QueryEngine; patch upsertService and upsertConnection to call it before .run()
- [x] 64-02-PLAN.md — Capture PROJECT_ROOT in map.md Step 1; pass explicit root to openDb() in Step 4 node snippet

### Phase 65: Service ID Scoping

**Goal**: Cross-repo service ID resolution is scoped per project so that a service named identically in two different repos resolves to the correct ID in each context
**Depends on**: Phase 63
**Requirements**: SVCR-01
**Success Criteria** (what must be TRUE):

  1. Two repos each containing a service named "api-gateway" produce distinct service IDs that do not collide in the database
  2. MCP impact queries for "api-gateway" scoped to project A return only connections involving project A's service, not project B's
  3. After scanning both repos, the /graph endpoint for each project shows only that project's "api-gateway" node with its correct connections

**Plans**: 1 plan
Plans:

- [x] 65-01-PLAN.md — Scope _resolveServiceId by repoId and add ambiguity warning + tests

### Phase 66: Agent Interaction Fixes

**Goal**: The confirmation flow accepts common affirmative synonyms and re-prompts on ambiguous input; the incremental scan agent prompt explicitly constrains the scan to changed files only
**Depends on**: Phase 63
**Requirements**: CONF-01, SREL-01
**Success Criteria** (what must be TRUE):

  1. Responding "sure", "yep", "looks good", or "sounds good" to a confirmation prompt is accepted as affirmative — no re-prompt or silent ignore
  2. Responding with an ambiguous or unrecognized string to a confirmation prompt triggers a clear re-prompt asking for yes/no explicitly
  3. When the incremental scan agent prompt runs, the agent's scan is bounded to the set of changed files passed in the prompt — the agent does not re-scan unchanged files
  4. An incremental scan invoked with no changed files produces a no-op result rather than a full re-scan

**Plans**: 2 plans
Plans:

- [x] 66-01-PLAN.md — applyEdits synonym normalization + NEEDS_REPROMPT sentinel in confirmation.js
- [x] 66-02-PLAN.md — Incremental scan changed-files constraint injected into agent prompt in manager.js

</details>

<details>
<summary>✅ v5.3.0 Scan Intelligence & Enrichment (Phases 67-73) — SHIPPED 2026-03-22</summary>

### Phase 67: DB Foundation

**Goal**: The database has all columns and tables required for enrichment — confidence/evidence on connections, owner/auth_mechanism/db_backend on services, schemas and schema_fields tables — and query-engine exposes upsertNodeMetadata()
**Depends on**: Phase 66 (v5.2.1 complete)
**Requirements**: CONF-01, CONF-02
**Success Criteria** (what must be TRUE):

  1. After migration 009 runs, `PRAGMA table_info(connections)` shows `confidence TEXT` and `evidence TEXT` columns
  2. After migration 009 runs, `PRAGMA table_info(services)` shows `owner TEXT`, `auth_mechanism TEXT`, and `db_backend TEXT` columns
  3. The `schemas` and `schema_fields` tables exist with indexes and the migration is idempotent — running it twice does not error
  4. `upsertNodeMetadata(serviceId, view, key, value)` is callable from a scan context and writes a row to the `node_metadata` table without triggering a scan bracket

**Plans**: 1 plan
Plans:

- [x] 67-01-PLAN.md — Migration 009: add confidence/evidence/enrichment columns + upsertNodeMetadata() method

### Phase 68: Enrichment Architecture & CODEOWNERS

**Goal**: A post-scan enrichment pass framework runs after core agent output is parsed, each enricher is isolated and gracefully silenced on failure, and the CODEOWNERS enricher correctly stores team ownership for each service
**Depends on**: Phase 67
**Requirements**: ENRICH-01, ENRICH-02, ENRICH-03, OWN-01
**Success Criteria** (what must be TRUE):

  1. After scanning a repo that has a CODEOWNERS file, the `services.owner` column is populated with the correct GitHub team handle for each service whose source path matches a CODEOWNERS pattern
  2. A service with no matching CODEOWNERS pattern has `owner` as NULL — not an empty string or placeholder
  3. If the CODEOWNERS enricher throws an unhandled error, the scan still completes and all primary service/connection data is persisted (the error is logged, not re-thrown)
  4. Each enricher writes metadata with a distinct `view` key in `node_metadata` — no two enrichers collide on the same key
  5. The enrichment pass does not trigger beginScan/endScan — `SELECT COUNT(*) FROM services` is unchanged after enrichment runs

**Plans**: 2 plans
Plans:

- [x] 68-01-PLAN.md — enrichment.js registry + codeowners.js parser and enricher factory
- [x] 68-02-PLAN.md — Wire runEnrichmentPass into manager.js success path

### Phase 69: Auth & DB Extraction

**Goal**: Auth mechanism and database backend are extracted from each service's source files via regex signal tables and written to the database, with credential value exclusion preventing secret leakage
**Depends on**: Phase 68
**Requirements**: AUTHDB-01, AUTHDB-02
**Success Criteria** (what must be TRUE):

  1. After scanning a Node.js service that uses JWT authentication, `services.auth_mechanism` is set to a recognized mechanism string (e.g., "jwt") — not a raw credential value
  2. After scanning a service whose `schema.prisma` references PostgreSQL, `services.db_backend` is set to "postgresql"
  3. A service with no detectable auth pattern has `auth_mechanism` as NULL — not a false-positive or guessed value
  4. Extracted values never contain strings longer than 40 characters or matching credential patterns (Bearer tokens, connection strings with passwords) — the extractor rejects them before DB write

**Plans**: 1 plan
Plans:

- [x] 69-01-PLAN.md — auth-db-extractor.js with regex signal tables + enricher registry registration

### Phase 70: Confidence & Evidence Pipeline

**Goal**: Confidence levels and evidence snippets emitted by the agent during scanning are persisted through the upsert layer and returned on every connection object in the /graph response
**Depends on**: Phase 67
**Requirements**: CONF-03
**Success Criteria** (what must be TRUE):

  1. After a scan where the agent emits confidence and evidence fields, `SELECT confidence FROM connections WHERE confidence IS NOT NULL LIMIT 5` returns real rows — not zero results
  2. Each connection object in the /graph API response includes `confidence` and `evidence` fields (null if not emitted by the agent)
  3. Re-scanning without confidence/evidence in agent output leaves existing confidence/evidence values in place rather than overwriting with null (ON CONFLICT DO UPDATE preserves existing non-null values)

**Plans**: 1 plan
Plans:

- [x] 70-01-PLAN.md — Extend upsertConnection + getGraph() to write and return confidence/evidence with migration-009-aware fallback

### Phase 71: Schema Storage & API Extension

**Goal**: Schema and field data collected during scans is persisted in the schemas/schema_fields tables and the /graph response includes schemas_by_connection plus all enrichment fields pivoted from node_metadata
**Depends on**: Phase 70, Phase 69
**Requirements**: SCHEMA-02, OWN-02, OWN-03, AUTHDB-03
**Success Criteria** (what must be TRUE):

  1. After scanning a service that emits schema data, the `schemas` table contains the schema and `schema_fields` contains its fields, linked by connection_id
  2. The /graph API response includes a top-level `schemas_by_connection` map keyed by connection_id — schema data is not embedded inside per-node objects
  3. MCP `impact_query` and `impact_changed` responses include the owner field for each affected service
  4. MCP impact responses include `auth_mechanism` and `db_backend` for each affected service
  5. Re-scanning a service removes stale schema fields from prior scans — deleted fields do not accumulate across re-scans

**Plans**: 2 plans
Plans:

- [x] 71-01-PLAN.md — Extend getGraph(): schemas_by_connection, confidence/evidence on connections, owner/auth_mechanism/db_backend on services, stale schema cleanup in endScan()
- [x] 71-02-PLAN.md — Extend enrichImpactResult and add enrichAffectedResult; wire into impact_changed MCP handler

### Phase 72: Detail Panel UI

**Goal**: The detail panel renders schema/field data, confidence badges, owner/auth/db rows, and "unknown" placeholders for all missing metadata fields — with XSS-safe rendering throughout
**Depends on**: Phase 71
**Requirements**: SCHEMA-01, OWN-02, CONF-03, UNK-01
**Success Criteria** (what must be TRUE):

  1. Selecting a connection in the detail panel shows a schema section with a field table (name, type, required) when schema data exists for that connection
  2. Each connection row in the detail panel displays a confidence badge (green for high, amber for low, gray for absent)
  3. The owner row in a service's detail panel shows the GitHub team handle, or "unknown" if no owner was extracted
  4. The auth mechanism and database backend rows show their values, or "unknown" when not detected — these rows are always visible, never hidden
  5. TypeScript generic type strings (e.g., `Array<Record<string, unknown>>`) render as literal characters in the panel, not as invisible HTML

**Plans**: 2 plans
Plans:

- [x] 72-01-PLAN.md — Wire enrichment fields into state + service metadata rows + confidence badges
- [x] 72-02-PLAN.md — Schema field table in connection detail panel + tests

### Phase 73: Agent Prompts & Quality-Gate Spinout

**Goal**: Agent scan prompts explicitly require source_file on connections to reduce null paths; quality-gate command and skill are removed from this plugin in preparation for a standalone plugin
**Depends on**: Phase 67 (independent of enrichment phases; can run in parallel but placed here for sequential execution)
**Requirements**: AGENT-01, AGENT-02, AGENT-03, QGATE-01
**Success Criteria** (what must be TRUE):

  1. After the prompt update, a scan of a repo with traceable connections produces connection rows where `source_file` is non-null for internally-connected services — the prompt guidance is specific enough to drive this behavior
  2. When the agent emits a connection without `source_file`, a validation warning is logged to the worker's structured logger — the scan still completes
  3. The detail panel connection list shows the source_file path next to each connection when the field is present
  4. The `/ligamen:quality-gate` command no longer exists in this plugin — invoking it produces "command not found" or a redirect message pointing to the standalone plugin

**Plans**: 3 plans
Plans:

- [x] 73-01-PLAN.md — agent-prompt-service/library: source_file REQUIRED section + findings.js null warning
- [x] 73-02-PLAN.md — detail-panel.js: verify source_file/target_file display in service connections + tests
- [x] 73-03-PLAN.md — delete quality-gate command/skill + clean manifests, session-start, bats tests

</details>

<details>
<summary>✅ v5.4.0 Scan Pipeline Hardening (Phases 74-79) — SHIPPED 2026-03-22</summary>

### Phase 74: Scan Bug Fixes

**Goal**: Known scan correctness bugs are eliminated — phantom actor hexagons no longer appear for services, repos with docker-compose are correctly typed, and CODEOWNERS ownership patterns match correctly
**Depends on**: Phase 73 (v5.3.0 complete)
**Requirements**: SBUG-01, SBUG-02, SBUG-03
**Success Criteria** (what must be TRUE):

  1. After scanning a repo where a service is also referenced as an external actor target, no hexagon node appears in the graph for that service — the existing service node receives the connection instead
  2. A Node.js or Python service repo that includes docker-compose.yml for local development is classified as its correct type (service/library), not misclassified as infra
  3. A Go or Java project containing only library-type files is classified as a library, not misidentified as a service
  4. After scanning a repo with a CODEOWNERS file, team ownership is populated correctly for services whose paths use relative (not absolute) patterns

**Plans**: 2 plans
Plans:

- [x] 74-01-PLAN.md — SBUG-01 phantom actor guard + SBUG-03 CODEOWNERS absolute-path fix
- [x] 74-02-PLAN.md — SBUG-02 detectRepoType docker-compose exemption + Go/Java/Poetry library heuristics

### Phase 75: Validation Hardening

**Goal**: findings.js rejects agent output with invalid service types or missing required fields before it reaches the database, and file-based shell operations use argument arrays eliminating the shell injection surface
**Depends on**: Phase 73 (v5.3.0 complete — independent of Phase 74, can run in parallel)
**Requirements**: SVAL-01, SVAL-02
**Success Criteria** (what must be TRUE):

  1. When the agent emits a service with `type: "microservice"` (not a valid enum), findings.js logs a validation warning and skips that service rather than persisting it
  2. When the agent emits a service with a missing or empty `root_path`, findings.js logs a validation warning and skips that service
  3. When the agent emits a service with a missing or empty `language`, findings.js logs a validation warning and skips that service
  4. `getChangedFiles()` and `getCurrentHead()` use execFileSync with argument arrays — no user-controlled string is ever interpolated into a shell command string

**Plans**: 2 plans
Plans:

- [x] 75-01-PLAN.md — SVAL-01 warn-and-skip validation for service type/root_path/language in findings.js
- [x] 75-02-PLAN.md — SVAL-02 replace execSync with execFileSync argument arrays in manager.js

### Phase 76: Discovery Phase Wiring

**Goal**: A discovery agent runs before the deep scan agent for each repo, producing structured language/framework/entry-point context that is injected into the deep scan prompt as {{DISCOVERY_JSON}}
**Depends on**: Phase 74 (bug fixes should be stable before wiring new scan phases — discovery output affects scan flow)
**Requirements**: SARC-01
**Success Criteria** (what must be TRUE):

  1. Running `/ligamen:map` on a repo produces a discovery pass log entry showing detected languages, frameworks, and candidate entry-point files before the deep scan begins
  2. The deep scan agent prompt received by the agent contains a populated {{DISCOVERY_JSON}} block with at least one detected language when scanning a non-empty repo
  3. If the discovery agent fails or times out, the deep scan still runs using a fallback empty discovery context — the scan is not aborted
  4. Discovery output is not persisted to the database — it is ephemeral prompt context only

**Plans**: 1 plan
Plans:

- [x] 76-01-PLAN.md — Wire runDiscoveryPass into scanRepos loop + discovery wiring tests

### Phase 77: Prompt Debiasing & Dead Code Removal

**Goal**: Active agent prompts use discovery context for language-specific guidance instead of hardcoded Python/JS examples; the unused agent-prompt-deep.md file and promptDeep variable are deleted after any unique content is migrated
**Depends on**: Phase 76 (SARC-02 requires discovery context to be wired before removing Python/JS bias; SARC-03 should happen after SARC-01 since agent-prompt-deep.md may be repurposed)
**Requirements**: SARC-02, SARC-03
**Success Criteria** (what must be TRUE):

  1. The active agent prompts (service, library, infra) contain entry-point examples for Java, C#, Ruby, and Kotlin in addition to the existing Python/JS examples — or use {{DISCOVERY_JSON}} placeholders instead of any hardcoded language examples
  2. Scanning a Java repo produces scan output where the agent correctly identifies Java entry points (e.g., @RestController, Application.java) — not Python or JS patterns
  3. The file `plugins/ligamen/worker/scan/agent-prompt-deep.md` does not exist in the repository
  4. The variable `promptDeep` does not appear in `plugins/ligamen/worker/scan/manager.js`

**Plans**: 1 plan
Plans:

- [x] 77-01-PLAN.md — Debias prompts with multi-language examples, add DISCOVERY_JSON, delete dead code

### Phase 78: Scan Reliability

**Goal**: Discovery and deep-scan agents run in parallel across repos where possible, failed agents retry once before being skipped with a user-visible warning, and the graph UI filters stale actor data as a defense-in-depth layer
**Depends on**: Phase 76 (SREL-01 depends on SARC-01 since discovery changes the scan flow; SREL-02 is independent but grouped here as reliability work)
**Requirements**: SREL-01, SREL-02
**Success Criteria** (what must be TRUE):

  1. Scanning a workspace with 3 repos produces discovery agent invocations that run concurrently — the total scan time is closer to the slowest single-repo scan than the sum of all repo scans
  2. When a deep scan agent call fails on first attempt, a single retry is automatically issued before the repo is skipped — the user sees a warning identifying the skipped repo by name
  3. A skipped repo (after retry failure) does not cause the entire `/ligamen:map` command to error out — remaining repos complete normally
  4. When the /graph endpoint returns an actor whose name exactly matches a known service name, the actor node is absent from the rendered graph and its connections point to the service node instead

**Plans**: 2 plans
Plans:

- [x] 78-01-PLAN.md — Parallel scan fan-out with retry-once error handling
- [x] 78-02-PLAN.md — Graph UI actor dedup filter (defense in depth)

### Phase 79: Version Bump

**Goal**: All manifest files reflect version 5.4.0 so the marketplace and plugin install surfaces present the correct version
**Depends on**: Phase 78 (must be last — version bump is the release gate)
**Requirements**: REL-01
**Success Criteria** (what must be TRUE):

  1. `plugins/ligamen/package.json`, `plugins/ligamen/.claude-plugin/marketplace.json`, and `plugins/ligamen/.claude-plugin/plugin.json` all contain `"version": "5.4.0"`
  2. Running `make check` (version sync check) passes with all three files at 5.4.0
  3. `claude plugin marketplace add` offers version 5.4.0 of the ligamen plugin

**Plans**: 1 plan
Plans:

- [x] 79-01-PLAN.md — Bump all manifest version fields to 5.4.0

</details>

<details>
<summary>✅ v5.5.0 Security & Data Integrity Hardening (Phases 80-83) — SHIPPED 2026-03-22</summary>

### Phase 80: Security Hardening

**Goal**: The MCP server, scan manager, and auth extractor are protected against path traversal attacks, credential leakage, and concurrent scan corruption
**Depends on**: Phase 79 (v5.4.0 complete)
**Requirements**: SEC-01, SEC-02, SEC-03
**Success Criteria** (what must be TRUE):

  1. Passing `../../../etc/passwd` as a project hash to an MCP tool call returns an error and does not open any file outside the configured database directory
  2. After an auth-db enrichment pass, no extracted value in `services.auth_mechanism` or `services.db_backend` contains a high-entropy string resembling a secret token or connection string password
  3. Launching `/ligamen:map` on a project while a scan is already in progress for that project returns a clear error message — the second invocation does not corrupt scan bracket state
  4. Near-threshold strings (entropy close to the rejection cutoff) are logged at warn level so the threshold can be tuned without silent data loss

**Plans**: 3 plans
Plans:

- [x] 80-01-PLAN.md — Path traversal hardening for resolveDb and DB pool (SEC-01)
- [x] 80-02-PLAN.md — Shannon entropy credential rejection in auth-db extractor (SEC-02)
- [x] 80-03-PLAN.md — Concurrent scan lock with stale detection in manager (SEC-03)

### Phase 81: Data Integrity Port

**Goal**: Four fixes already validated in the plugin cache are ported to `plugins/ligamen/` so the source repo matches the deployed behavior
**Depends on**: Phase 80 (security fixes ship first; these are self-contained ports that can follow immediately)
**Requirements**: DINT-01, DINT-02, DINT-03, DINT-04
**Success Criteria** (what must be TRUE):

  1. After endScan() runs, no orphaned schema rows exist for connections that were deleted during stale cleanup — FK constraint violations do not occur when cascades are not present
  2. Calling upsertRepo() for an existing repo returns the correct existing row ID, not zero — callers that chain the returned ID for further inserts do not create orphaned rows
  3. node_metadata enrichment tests reference the view names `ownership`, `security`, and `infra` matching the production query — no test failures from mismatched view key strings
  4. When session-start.sh runs and the worker is already running with an older version, the worker is restarted before the session proceeds — stale compiled code does not serve the new session

**Plans**: 2 plans
Plans:

- [x] 81-01-PLAN.md — Port DINT-01 endScan FK fix + DINT-02 upsertRepo ID fix
- [x] 81-02-PLAN.md — Port DINT-03 test view names + DINT-04 worker version restart

### Phase 82: Reliability Hardening

**Goal**: Agent output parsing survives malformed responses, transitive impact queries cannot run unbounded, and the auth-db extractor cannot be driven into deep or large-file traversal
**Depends on**: Phase 80 (SEC-03 concurrent scan lock should be in place before adding parsing complexity)
**Requirements**: REL-01, REL-02, REL-03
**Success Criteria** (what must be TRUE):

  1. When an agent returns output with JSON embedded inside a fenced code block (```json ... ```), the scan correctly extracts and parses the JSON rather than treating the entire response as plain text
  2. When an agent returns malformed JSON that cannot be parsed by any strategy, the error is logged with a truncated preview of the raw output and the repo is skipped — no unhandled exception reaches the caller
  3. A transitive impact query that would traverse more than 7 hops is terminated at the depth limit and returns results found so far with a truncation notice
  4. A transitive impact query running longer than 30 seconds is cancelled and returns a timeout error rather than hanging indefinitely
  5. The auth-db extractor skips directories in its exclusion list (node_modules, .git, vendor, etc.) without descending into them, and stops reading any single file after 1MB

**Plans**: 2 plans
Plans:

- [x] 82-01-PLAN.md — Multi-strategy agent output parsing + auth-db traversal guards
- [x] 82-02-PLAN.md — Transitive impact depth limit and timeout

### Phase 83: Performance & Quality

**Goal**: FTS5 search uses cached prepared statements for lower per-query overhead, journal mode pragma ordering is explicitly tested, and `/ligamen:map` captures the project name before saving the first scan
**Depends on**: Phase 81 (data integrity fixes should be in place before adding caching complexity on top of query engine)
**Requirements**: REL-04, QUAL-01, QUAL-02
**Success Criteria** (what must be TRUE):

  1. Running 100 consecutive FTS5 searches does not produce 100 statement compilations — the prepared statement cache is hit for repeat queries and evicted correctly under LRU pressure
  2. A unit test explicitly verifies that the `journal_mode=WAL` pragma is applied before any read-write operations on a new connection, and that readonly connections use `journal_mode=DELETE`
  3. Running `/ligamen:map` on a project with no existing `ligamen.config.json` prompts the user for a project name before the scan begins
  4. The project name entered during `/ligamen:map` is written to `ligamen.config.json` and reused on subsequent invocations without prompting again

**Plans**: 2 plans
Plans:

- [x] 83-01-PLAN.md — FTS5 prepared statement LRU cache + journal mode pragma tests
- [x] 83-02-PLAN.md — Map command project name prompt and config persistence

</details>

---

<!-- v0.1.1 phase details archived to .planning/milestones/v0.1.1-ROADMAP.md -->

<!-- v0.1.2 phase details archived to .planning/milestones/v0.1.2-ROADMAP.md -->

---

<!-- v0.1.3 phase details archived to .planning/milestones/v0.1.3-ROADMAP.md -->

---

<!-- v0.1.5 phase details archived to .planning/milestones/v0.1.5-ROADMAP.md -->

<details>
<summary>archived: full Phase 123-127 details (see .planning/milestones/v0.1.5-ROADMAP.md)</summary>

### Phase 123: PII Path Masking

**Goal**: `$HOME` paths no longer leak from the worker process — every egress seam (MCP responses, HTTP responses, log lines, export outputs) emits `~`-prefixed paths, and the agent contract is hardened against future regressions
**Depends on**: Phase 122 (v0.1.4 complete) — INDEPENDENT of hub-side THE-1030; ships first to give the milestone shippable scope
**Requirements**: PII-01, PII-02, PII-03, PII-04, PII-05, PII-06, PII-07
**Success Criteria** (what must be TRUE):

  1. After a clean scan, an MCP tool call (`impact_query`, `impact_changed`, `impact_graph`, `impact_search`, `impact_scan`) returns a response containing zero `/Users/` or `/home/` strings — `repo_path`, `root_path`, `source_file`, and `target_file` are all `~`-prefixed
  2. After a clean scan, the worker log file at `~/.arcanon/logs/worker.log` contains zero absolute `$HOME` paths — stack traces and `extra` fields are masked
  3. Default-mode `/arcanon:export` outputs (mermaid, dot, html) contain zero `/Users/` or `/home/` strings
  4. The `GET /graph`, `GET /api/scan-freshness`, and `GET /projects` HTTP responses contain zero absolute `$HOME` paths in any nested `repos[].path` array or per-service `repo_path` field
  5. When the scanning agent emits a connection with an absolute `source_file`, the field is dropped with a WARN log and the connection still persists with the rest of its fields intact (the scan does not fail)

**Plans**: TBD (estimate 3 plans — Wave-1 helper module + tests, Wave-2 four egress seams in parallel, Wave-3 agent contract assertion + integration tests)

**Plan-phase pre-flight requirement (from predecessor audit):**

- *(S1, PII-02)*: Plan must verify `maskHome` is idempotent on already-relative paths emitted by the agent (`agent-prompt-service.md:104` shows `root_path` as `src/`). The agent contract is documented to emit relative paths; PII-06 hardens this. Add a unit test under PII-07 confirming an already-relative path round-trips through `maskHome` unchanged. Verify a Claude-tool-call's downstream consumer (the `Explore` agent prompts in `agent-prompt-*.md`) still works with `~`-prefixed paths.

- *(S2, PII-03)*: Plan must spec a single bats grep-assertion against `cmdStatus` JSON output (hub.js:196) confirming no `/Users/` or `/home/` strings escape after a clean scan. `session-start.sh` is confirmed not to render `repos[].path` today (grep returns 0 hits) so no script edit is needed; pin this as a structural regression guard in `commands-surface.bats`. **REQUIREMENTS.md note:** PII-03's REQ wording references `/api/repos`, but that route does not exist on the worker. The actual surface is `GET /projects` (project-list) plus the `repos[]` array nested inside `/api/scan-freshness` and `/graph` response bodies — target those routes.

- *(M1, PII-04)*: Plan must add masking as a **single seam** in `worker/lib/logger.js` between lines 59 and 60 (after `Object.assign(lineObj, extra)`, before `JSON.stringify`). Do NOT add masking calls at the ~30 logger call sites scattered across `worker/`. Stack-trace masking: `extra.stack` is a string; `maskHomeDeep` must mask string values, not just keyed paths. Add a unit test asserting log line contains `~/path/to/repo` not `/Users/me/path/to/repo` after `logger.info('x', {stack: '/Users/me/foo.js:42'})`.

- *(X2, PII-06)*: No composition risk with `applyPendingOverrides` (PII-06 fires at `parseAgentOutput`, well before `persistFindings`). Plan must spec: rejection logs WARN with the masked offending value, drops just the `source_file` field (not the whole connection), does not fail the scan. Belt-and-suspenders only — agent contract already mandates relative paths per `agent-prompt-service.md:89`.

### Phase 124: Hub Auth Core

**Goal**: Every scan upload carries `X-Org-Id` derived from a deterministic precedence chain (per-repo override → env → machine default), backed by a `whoami`-aware client and a config-file extension that preserves existing keys
**Depends on**: Phase 123 (sequential — auth changes follow PII to keep diffs small) — HARD-DEPENDENT on hub-side arcanon-hub THE-1030 deploy
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success Criteria** (what must be TRUE):

  1. Calling `uploadScan(payload, {apiKey, hubUrl, orgId})` sends an `X-Org-Id: <orgId>` header on the POST to `${hubUrl}/api/v1/scans/upload`; calling without `orgId` throws `HubError(status=400, code='missing_org_id')` **before** the network attempt
  2. Calling `getKeyInfo(apiKey, hubUrl)` against a hub honoring THE-1030 returns a populated `{ user_id, key_id, scopes, grants }` object; auth failures throw `AuthError`; transport failures throw `HubError`
  3. `resolveCredentials(opts)` returns `{ apiKey, hubUrl, orgId, source }` honoring the precedence `opts.orgId` → `ARCANON_ORG_ID` → `~/.arcanon/config.json#default_org_id`; missing org id throws an `AuthError` whose message names all three sources and recommends `/arcanon:login --org-id <uuid>`
  4. Re-running `storeCredentials(apiKey, {hubUrl, defaultOrgId})` on an existing config preserves any unrelated keys via spread-merge; mode-0600 file permission preserved
  5. Setting `hub.org_id` in a per-repo `arcanon.config.json` causes that repo's scan upload to send the override even when `ARCANON_ORG_ID` is set globally — per-repo beats env beats machine default

**Plans**: 1 plan

- [ ] 124-PLAN.md — AUTH-03 → AUTH-01 → AUTH-04 → AUTH-02 → AUTH-05 → integration test (consolidated single-wave coupled block; per-plan file-ownership conflict on auth.js / client.js / index.js made splitting Plan A/B unsafe — single plan with 6 sequential atomic-commit tasks instead)

**Plan-phase pre-flight requirement (from predecessor audit):**

- *(C1, AUTH-01)*: Plan must sequence AUTH-03 before AUTH-01: AUTH-03 expands `resolveCredentials` return shape with `orgId`; AUTH-01 then reads `creds.orgId` at the 2 `worker/hub-sync/index.js` call sites (lines 71, 146). Confirm zero callers destructure with `Object.keys` or otherwise depend on field-set parity. AUTH-01, AUTH-03, AUTH-05 are a coupled signature/contract block — none is buildable alone; they must land together in this phase.

- *(C2, AUTH-03)*: Plan must spec how `hasCredentials()` (auth.js:120) handles missing-org-id. Two options: **(a)** keep `hasCredentials()` returning true when `api_key` resolves but `org_id` doesn't — defer the throw to upload time; **(b)** tighten `hasCredentials()` to require `org_id`, with a `manager.js:941` WARN when auto-sync gates off. Pick (a) or (b) explicitly and document the choice. The HUB-01 auto-sync gate (manager.js:941, 949) MUST surface why uploads are silently skipped — silent gating is a regression.

- *(C3, AUTH-04)*: Plan must verify `storeCredentials`' existing spread-merge (`{...existing, api_key}` at auth.js:137) preserves `default_org_id` when only `api_key` is being rewritten. Add a unit test pinning: writing `api_key` on top of `{api_key, hub_url, default_org_id}` keeps all three. CHANGELOG `### BREAKING` entry must call out the upgrade path: existing v0.1.4 users will fail on next `/arcanon:sync` until they re-run `/arcanon:login` (or `/arcanon:login --org-id <uuid>`).

- *(X1, AUTH-05)*: Plan must thread `orgId` through `manager.js:937` destructure and `manager.js:962` `syncFindings` call. Confirm the `_readHubConfig` return shape extension doesn't break `manager.test.js` fixtures. Phase ordering: AUTH-03 + AUTH-01 + AUTH-05 land together in this single phase; landing AUTH-05 alone won't compile.

### Phase 125: Login & Status UX

**Goal**: Users get a guided `/arcanon:login` flow that auto-resolves org id from `whoami`, see their resolved identity in `/arcanon:status`, and receive actionable error messages on every server-side auth failure
**Depends on**: Phase 124 (`whoami` client + `resolveCredentials` shape required)
**Requirements**: AUTH-06, AUTH-07, AUTH-08, AUTH-09
**Success Criteria** (what must be TRUE):

  1. Running `/arcanon:login arc_xxx` against a hub where the key has exactly one grant auto-selects that org, persists the triple, and announces the chosen org id; running it where the key has multiple grants prompts the user via AskUserQuestion; running it where the key has zero grants fails with an admin-action message
  2. Running `/arcanon:login arc_xxx --org-id <uuid>` calls `whoami` for verification, warns-but-allows if the key isn't authorized for that org, and persists the triple either way
  3. Running `/arcanon:status` displays an Identity block with: resolved org id + resolution source (env / repo config / machine default), a key preview (`arc_xxxx…1234`), the key's scopes, and the list of orgs the key is authorized for; shows `(missing)` when no org id resolves
  4. When `uploadScan` receives a server response with code `missing_x_org_id` / `invalid_x_org_id` / `insufficient_scope` / `key_not_authorized_for_org` / `not_a_member` / `forbidden_scan` / `invalid_key`, the user sees a code-specific actionable message — never the opaque `401 Unauthorized` fallback
  5. `commands/login.md`, `arcanon.config.json.example`, `docs/hub-integration.md`, `docs/getting-started.md`, and `docs/configuration.md` document the new `default_org_id` config field, the `ARCANON_ORG_ID` env var, the login-flow grant-resolution behavior, and the resolution precedence

**Plans**: TBD (estimate 2 plans — Plan A: AUTH-06 login flow + AUTH-08 error-code parser, Plan B: AUTH-07 status block + AUTH-09 docs)

**Plan-phase pre-flight requirement (from predecessor audit):**

- *(C4, AUTH-08)*: Plan must coordinate with arcanon-hub THE-1030 to lock the error response JSON shape — likely `{type, title, status, detail, code}` per RFC 7807 with a custom `code` field. Test M-AUTH-08 must enumerate all 7 codes (`missing_x_org_id`, `invalid_x_org_id`, `insufficient_scope`, `key_not_authorized_for_org`, `not_a_member`, `forbidden_scan`, `invalid_key`). Existing `body.title` fallback (client.js:164) MUST remain for forward-compat with codes the plugin doesn't recognize. The `HubError` object should gain `.code` (string|null) without breaking existing `.status`, `.retriable`, `.body`, `.attempts` fields.

- *(C5, AUTH-06)*: Plan must spec offline / hub-unreachable login behavior. Recommended: when `whoami` fails network or returns 5xx, store the credential anyway (with the user-supplied `--org-id` if given, else fail), emit a WARN that grants couldn't be verified. NEVER silently store an unvalidated credential without an org id. THE-1030 hard dependency means this phase ships AFTER the hub deploy.

- *(L1, AUTH-07)*: Plan should emit Identity as a nested `identity: {…}` object in `--json` mode (not flat top-level fields), to insulate existing JSON consumers from field-set churn. Human mode adds new lines; JSON mode adds one new key.

### Phase 126: Auth Test Suite

**Goal**: The cross-module auth contract — header landing, missing-orgId fail-fast, error-code-to-message mapping, login flow branches, and resolution-order precedence — is pinned by an executable test suite that fails closed on any regression
**Depends on**: Phase 125 (all auth surfaces in place; tests exercise them end-to-end)
**Requirements**: AUTH-10
**Success Criteria** (what must be TRUE):

  1. `worker/hub-sync/client.test.js` asserts: `X-Org-Id` header lands on the upload request; missing `orgId` throws before any `fetch` is issued; each of the 7 server error codes produces its own user-message-bearing `HubError`; success returns `scan_upload_id`
  2. `worker/hub-sync/whoami.test.js` (new file) asserts: `getKeyInfo` returns parsed `{ user_id, key_id, scopes, grants }`; auth-class HTTP errors throw `AuthError`; transport errors throw `HubError`
  3. `worker/hub-sync/integration.test.js` asserts: `/arcanon:login --org-id <uuid>` round-trips through `storeCredentials` → `resolveCredentials`; `/arcanon:login` without `--org-id` calls `whoami`; precedence test: per-repo `hub.org_id` beats `ARCANON_ORG_ID` beats `default_org_id`
  4. `npm test` exits 0 on a clean tree with the new tests included; no pre-existing-mock carryforwards introduced

**Plans**: 1 plan

- [ ] 126-01-PLAN.md — Pin AUTH-01..09 contract via test suite (client.test extended, whoami.test new, integration.test extended)

### Phase 127: Verification & Release Gate

**Goal**: v0.1.5 is shippable: all manifests pinned at `0.1.5`, CHANGELOG entry written, full test suite green, and an end-to-end verification confirms the auth + PII paths against a real hub honoring THE-1030
**Depends on**: Phase 126 (all REQ phases verified individually before release gate)
**Requirements**: VER-01, VER-02, VER-03, VER-04
**Success Criteria** (what must be TRUE):

  1. `package.json`, `plugins/arcanon/package.json`, `plugins/arcanon/.claude-plugin/plugin.json`, and the repo-root `.claude-plugin/marketplace.json` all contain `"version": "0.1.5"`; `package-lock.json` is regenerated and committed
  2. `CHANGELOG.md` has a pinned `[0.1.5]` section with categorized entries (Added / Changed / Fixed / BREAKING as applicable) and explicitly notes the hub-side dependency on THE-1030 under BREAKING
  3. The full bats suite is green and the full node test suite is green; no new pre-existing-mock carryforwards relative to the v0.1.4 baseline
  4. End-to-end manual verification confirms: `/arcanon:login` round-trips against a real hub honoring THE-1030; `/arcanon:status` shows the expected Identity block; an MCP tool call's response is inspected and asserted to contain zero `/Users/` strings; a real `/arcanon:sync` upload succeeds with the `X-Org-Id` header landing server-side

**Plans**: TBD (estimate 1 plan — manifest bumps + CHANGELOG + e2e verification)

</details>

---

### Phase 128: Native SQLite Migration (better-sqlite3 → node:sqlite)

**Milestone**: v0.1.8
**Goal**: The Arcanon MCP server starts reliably on a fresh install, a remove-and-reinstall, and an update — because the plugin no longer compiles or downloads a native module at runtime. Replace `better-sqlite3` with Node's built-in `node:sqlite` (`DatabaseSync`) behind a thin database adapter, eliminating the runtime native install that races Claude Code's ~30s MCP connection timeout.
**Depends on**: Phases 59-60 (the v0.1.7 install-deps + MCP launcher this supersedes)
**Requirements**: SQLITE-01, SQLITE-02, SQLITE-03, SQLITE-04, SQLITE-05, SQLITE-06
**Why now**: The v0.1.7 fix hardened the install *script* but left the root cause — deps (incl. the `better-sqlite3` native binding) are installed at runtime by a SessionStart hook that does not block MCP spawn, and stdio MCP servers never reconnect after a startup crash. Investigation in `.planning/codebase/DEPS-INSTALL-PIPELINE.md` and `DEPS-NATIVE-SURFACE.md` confirms `better-sqlite3` is the **only** native dependency and that `node:sqlite` supports the full feature set in use (FTS5 `MATCH`, WAL pragma, prepared-statement params; zero custom SQL functions/aggregates = no hard blocker).
**Success Criteria** (what must be TRUE):

  1. `plugins/arcanon/package.json` no longer lists `better-sqlite3`; no remaining runtime dependency requires `node-gyp`/`prebuild-install` at install time (optional `@chroma-core/default-embed` stays optional and prebuilt).
  2. All database access routes through a single adapter (over `node:sqlite` `DatabaseSync`) that preserves the API the worker uses: `prepare/run/get/all/exec`, `pragma`, `transaction()`, and `pluck()`. The ~13 `import ... from "better-sqlite3"` sites import the adapter instead.
  3. FTS5 (`USING fts5` + `MATCH`) search, WAL + `foreign_keys` + `busy_timeout` pragmas, and the 54 transaction sites behave identically to before (verified by the existing query-engine and migration test suites passing).
  4. `engines.node` is `>=22.13.0` across `plugins/arcanon/package.json` (and root where applicable); docs/getting-started prerequisites updated to state the Node ≥22.13 requirement.
  5. `install-deps.sh` and `worker/mcp/launch.js` are simplified — the `better-sqlite3` ABI-rebuild branch and native-binding health probe are removed; a fresh install starts the MCP server without any runtime `npm rebuild`.
  6. Full `node --test` worker suite and the full bats suite are green; CHANGELOG has a `[0.1.8]` entry. Zero-Node standalone-binary distribution is explicitly **out of scope** (deferred, like Windows).

**Plans**: 3 plans

- [ ] 128-01-PLAN.md — Build the node:sqlite adapter (drop-in `Database` over `DatabaseSync`) + parity/property unit tests (pragma, transaction commit+rollback, pluck round-trip, readonly, FTS5 MATCH) — no call-site changes yet (wave 1)
- [ ] 128-02-PLAN.md — Migrate all worker better-sqlite3 import sites to the adapter, remove better-sqlite3 from package.json, confirm query-engine + migration + pragma suites pass unchanged (wave 2)
- [ ] 128-03-PLAN.md — Simplify install-deps.sh + launch.js (drop native rebuild/probe), suppress ExperimentalWarning, bump engines >=22.13.0 + docs/CI, version 0.1.8 across manifests (lockfile via npm) + CHANGELOG, full suites green + fresh-install bats assertion (wave 3)

---

### Phase 129: Shadow Trio Removal, Rescan Repair & Docs

**Milestone**: v0.1.9
**Goal**: The shadow workflow is gone end-to-end — no commands, no worker machinery, no shell dispatch, no dangling references — while live scan-version diffing and the `/arcanon:correct` → `/arcanon:rescan` workflow keep working, and all user-facing docs reflect the reduced command set.
**Depends on**: Phase 128 (the `node:sqlite` adapter FIX-01 repoints `/arcanon:rescan` onto)
**Requirements**: RM-01, RM-02, RM-03, RM-04, RM-05, RM-06, FIX-01, DOC-01, DOC-02, DOC-03
**Why now**: The shadow trio duplicates capability already provided by `/arcanon:map`'s confirm gate (preview-before-persist) and `/arcanon:diff`'s scan-version comparison. It has been broken since the v0.1.8 `node:sqlite` migration (stale `better-sqlite3` import) with no user reports — evidence it is unused. Removal must surgically delete ONLY the shadow branch of the shared diff engine: `diffScanVersions` / scan-version diffing (used by `/arcanon:diff <scanA> <scanB>`) is load-bearing and stays.
**Success Criteria** (what must be TRUE):

  1. `/arcanon:shadow-scan` and `/arcanon:promote-shadow` are absent from the command surface (`commands/shadow-scan.md` and `commands/promote-shadow.md` deleted), and `/arcanon:diff` no longer accepts or documents `--shadow` (`cmdDiff` no longer branches on `--shadow`).
  2. `/arcanon:diff <scanA> <scanB>` still compares two scan versions correctly — the shared `diffScanVersions` / scan-version engine is preserved; only the live-vs-shadow resolution branch is removed.
  3. `/arcanon:rescan <repo>` runs Step-1 end-to-end without `ERR_MODULE_NOT_FOUND` — its inline `node` imports `worker/db/sqlite-adapter.js` instead of the removed `better-sqlite3`, and resolves the target repo.
  4. Worker + shell machinery is gone — `getShadowQueryEngine` (`worker/db/pool.js`), `cmdPromoteShadow` + the `"promote-shadow"` HANDLERS entry (`worker/cli/hub.js`), and `scripts/hub.sh`'s `promote-shadow` dispatch are all removed; searching plugin source, scripts, skills, and tests for `shadow-scan`, `promote-shadow`, `--shadow`, `impact-map-shadow.db`, and `getShadowQueryEngine` returns nothing (CSS `box-shadow` excluded).
  5. Root + plugin READMEs, `docs/commands.md`, and a `CHANGELOG [0.1.9] ### BREAKING` block all reflect the removal, name the three removed commands, and document the migration path (`/arcanon:map` confirm gate to preview, `/arcanon:diff <scanA> <scanB>` to compare); the `/arcanon:correct` → `/arcanon:rescan` workflow remains documented and accurate.

**Plans**: 3/3 plans complete

- [x] 129-01-PLAN.md
- [x] 129-02-PLAN.md
- [x] 129-03-PLAN.md

---

### Phase 130: Regression Tests & Release Gate

**Milestone**: v0.1.9
**Goal**: The codebase proves — via automated tests — that the removals are clean and cannot silently regress, then ships as a pinned, gate-passing 0.1.9 release.
**Depends on**: Phase 129
**Requirements**: TST-01, TST-02, TST-03, VER-01, VER-02
**Why now**: TST-01 closes the root cause behind both the `deep.md` and `better-sqlite3` silent breakages — inline-`node` command blocks had no test coverage, so a dependency rename broke `/arcanon:rescan` with zero CI signal. The guard test (TST-02) prevents reintroduction of the removed commands. VER-01/02 are the release gate and naturally land last.
**Success Criteria** (what must be TRUE):

  1. A regression test executes the `/arcanon:rescan` Step-1 inline-`node` path against a fixture DB, so a future dependency rename fails CI instead of breaking silently.
  2. A guard test fails if `commands/shadow-scan.md` or `commands/promote-shadow.md` reappear, or if `diff.md` mentions `--shadow` again.
  3. The full bats suite and worker test suite pass with all removals applied — no orphaned tests, no broken assertions.
  4. All manifests (`plugins/arcanon/package.json`, `plugins/arcanon/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) are pinned to `0.1.9` with the lockfile regenerated via npm.
  5. The release gate passes: bats + node suites green, zero shadow references remain (RM-06), and the `CHANGELOG [0.1.9]` section is pinned.

**Plans**: 2/2 plans complete

Plans:

- [x] 130-01-PLAN.md — Test cleanup + TST-01 rescan-resolve regression + TST-02 reintroduction guard + TST-03 full-suite-green
- [x] 130-02-PLAN.md — VER-01 manifest bump to 0.1.9 + lockfile regen + VER-02 release gate

### Phase 131: Fix protocol vocabulary mismatch — render all edge protocols (pub/sub, DB, GraphQL, SSE) via canonical buckets with fallback-not-reject (#42)

**Goal:** ONE canonical protocol vocabulary (rest · grpc · events · db · internal · sdk) shared across scan → persist → getGraph → UI, with fallback-not-reject so pub/sub, database, GraphQL, SSE, and unknown protocols all render as toggleable edges (unknown greyed under "other", never dropped).
**Requirements**: PV-01..PV-10 (local IDs — issue #42 ad-hoc phase, no REQUIREMENTS.md REQ-IDs)
**Depends on:** Phase 130
**Plans:** 3/3 plans complete

Plans:

- [x] 131-01-PLAN.md — Shared canonical-protocol module (single source of truth) + findings.js fallback-not-reject + schema enum + persist-time/read-time normalization + protocol_raw migration 019 + worker tests
- [x] 131-02-PLAN.md — UI alignment (activeProtocols seeded from shared set, db + other buckets/colors/checkboxes, edge normalization seam, protocol_raw in detail panel) + agent-prompt canonical vocabulary + consistency/drift test + human-verify
- [x] 131-03-PLAN.md — Cross-AI review gap-closure: actor-edge protocol_raw end-to-end (migration 020 + writer/read/detail) + k8s/tf/helm/import renderable (no silent drop) + full-CANONICAL_PROTOCOLS drift test + checkbox-coverage + diff casing + explicit-other warning + narrowed catches

### Phase 132: Fix detectMismatches() false endpoint_not_exposed on parameterized routes — canonicalize {...}→{_} on both sides + skip non-HTTP protocols (#43)

**Goal:** detectMismatches() stops reporting false `endpoint_not_exposed` for parameterized routes (consumed `{_}` paths compared against exposed named-param paths) and skips non-HTTP protocols — by canonicalizing exposed + consumed paths through the existing `canonicalizePath()` on both sides (literal + base_path-stripped) and restricting the candidate set to `c.protocol IN ('rest','grpc')`, with no persist-layer or helper changes.
**Requirements**: DM-01 (canonicalize exposed + consumed paths on both compare paths), DM-02 (restrict endpoint-exposure check to rest/grpc at both candidate sites), DM-03 (regression: genuine mismatches still flagged, existing tests + full worker/bats suites green)
**Depends on:** Phase 131
**Plans:** 1 plan

Plans:

- [x] 132-01-PLAN.md — Canonicalize exposed+consumed paths (reuse canonicalizePath, preserve stripBasePath retry) + rest/grpc protocol allowlist in detectMismatches(); new node:test suite (param match, name drift, events skip, grpc checked, genuine mismatch, base_path+param) + full worker/bats regression gate

### Phase 133: Teach the agent scanner to detect network-datastore/broker client connections by reasoning — chromadb/pg/mongodb/redis/etc., examples-not-allowlist (#45)

**Goal:** Teach the `/arcanon:map` discovery and service agent prompts to detect, by reasoning, files importing any network backing-service client (datastore/broker/search/cache/vector DB) and emit an `external` connection per client into the existing canonical protocol buckets — so silently-missed edges like `arcanon → chromadb` appear in the impact map.
**Requirements**: SC-01, SC-02, SC-03, SC-04, SC-05, SC-06, SC-07
**Depends on:** Phase 132
**Plans:** 2/2 plans complete

Plans:

- [x] 133-01-PLAN.md — Generalize discovery item 8 to reasoning-based backing-service-client detection; instruct service prompt to emit external connections; prompt-content test + regression gate
- [x] 133-02-PLAN.md — Gap-closure (cross-AI review): two-stage candidate handoff (`backing_service_deps`) so non-entry-point/non-name-matched importers like chroma.js are reachable (HIGH-1); call-site-conditioned emission not MUST-on-import (HIGH-2); ambiguous→other not closest-bucket (HIGH-3); section-coherent + reachability-contract tests

### Phase 134: detectMismatches method-aware endpoint matching — path-only comparison currently ignores HTTP method (#46)

**Goal:** Make `detectMismatches()` method-aware — compare the HTTP method alongside the canonical path so a wrong verb (e.g. consumed `POST /users/{id}` vs exposed only `GET /users/{id}`) is flagged, with a path-only fallback for null-method edges to avoid new false positives (#46).
**Requirements**: MM-01, MM-02, MM-03, MM-04, MM-05
**Depends on:** Phase 133
**Plans:** 2 plans (2 complete)

Plans:

- [x] 134-01-PLAN.md — Method-aware exposed-endpoint matching in detectMismatches() with null-method path-only fallbacks + TDD suite (#46)
- [x] 134-02-PLAN.md — Hardening from cross-AI review: collision-safe composite key + empty/whitespace-method→null + reworded null-semantics comment + 4 edge tests (#46)

---

## v0.2.0 — Scan Persistence, Pipeline & Security Hardening

### Phase 135: Shell-Exec Hardening

**Milestone**: v0.2.0
**Goal**: The MCP server cannot be exploited via shell injection or log-based secret extraction — all git and oasdiff invocations pass arguments as argv arrays, revision inputs are validated, and evidence fragments are stripped from logs.
**Depends on**: Phase 134 (v0.1.9 complete) — INDEPENDENT of persistence work; sequences first
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-08
**Success Criteria** (what must be TRUE):

  1. `queryChanged()` calls `execFileSync` with the commit range as an argv element — passing a commit range containing shell metacharacters (`;`, `|`, `$(...)`) returns a git error, not command execution.
  2. Both `oasdiff breaking` and `oasdiff diff` invocations pass spec paths as argv values — a path containing spaces, quotes, or shell metacharacters does not execute any additional commands or access unintended files.
  3. Git revision/range inputs containing `--option-like-strings` or shell metacharacters are validated and either rejected with a clear error or passed literally as data — no input can be interpreted as a git flag.
  4. Response bodies and payload fragments that may contain source-file evidence are absent from worker log output after a scan or sync operation.

**Plans**: 1/1 plans complete

- [x] 135-01-PLAN.md — git + oasdiff calls to execFileSync argv; commit_range validation (reject option-injection, `--` separator); redactExecError so logs carry no command lines/bodies (SEC-01, SEC-02, SEC-03, SEC-08)

---

### Phase 136: Hub Queue Tenant-Binding

**Milestone**: v0.2.0
**Goal**: Hub queue rows are permanently bound to their enqueue-time org and URL so an org switch cannot misroute a queued upload, and non-retriable failures close the row in a single drain attempt.
**Depends on**: Phase 135 (sequential within security track; no persistence dependency)
**Requirements**: SEC-04, SEC-05, SEC-06, SEC-07
**Success Criteria** (what must be TRUE):

  1. After enqueueing a scan upload to org A and switching the active org to org B, `drainQueue()` sends the enqueued row to org A's stored hub URL — the current active org has no effect on already-queued rows.
  2. A queue row created before this fix (without a bound destination) is never silently retargeted — it is migrated to a safe state or held in a distinct status for explicit user action, not drained to the current org.
  3. A drain attempt that receives a non-retriable 4xx response (401, 403, 404, 410) transitions the row to `dead` in a single attempt — no retry loop is entered, and the row state is visible in queue status output.
  4. Queue status counters (pending / uploading / dead / complete) match the actual persisted row states — no discrepancy between in-memory tracking and database state.

**Plans**: 2/2 plans complete

- [x] 136-01-PLAN.md — Bind queue rows to immutable (hub_url, org_id) at enqueue; hold legacy rows (SEC-04, SEC-06)
- [x] 136-02-PLAN.md — Drain to per-row destination; dead-on-non-retriable 4xx in one attempt (SEC-05, SEC-07)

---

### Phase 137: DB Isolation & Pool

**Milestone**: v0.2.0
**Goal**: Each project's database is served by an isolated, correctly cached handle — the global `openDb()` singleton is replaced with a factory/pool keyed by canonical project identity.
**Depends on**: Phase 136 (security track complete; ISO is the foundation for PIPE and INTG)
**Requirements**: ISO-01, ISO-02, ISO-11
**Success Criteria** (what must be TRUE):

  1. Opening two different project roots in the same worker process yields two distinct, non-overlapping database handles — writes to project A's database are not visible when querying project B's database.
  2. Calling the DB factory/pool with the same canonical project path twice returns the same cached handle (cache hit) — not a newly opened connection on every call.
  3. Integration tests exercise real pool resolution against real per-project databases (no mocked resolvers or in-memory stubs) and confirm that a cross-project query returns zero results from the wrong project.

**Plans**: 1/1 plans complete

- [x] 137-01-PLAN.md — openDb() factory + pool keyed by resolved dbPath + ISO-11 isolation tests (ISO-01, ISO-02, ISO-11)

---

### Phase 138: Transactional Scan Unit-of-Work

**Milestone**: v0.2.0
**Goal**: A complete scan is one atomic operation — failure at any intermediate step rolls back cleanly, completed brackets close only after all cleanup finishes, and cleanup is scoped strictly to the repo being scanned.
**Depends on**: Phase 137 (DB pool must be in place before transactional scan logic is built on top)
**Requirements**: ISO-03, ISO-04, ISO-05, ISO-10
**Success Criteria** (what must be TRUE):

  1. If a scan fails between the persist-findings step and the end-scan step, the prior scan's data remains fully intact — no partial write is visible in the graph or via MCP queries.
  2. A scan version row is marked completed only after all stale-data cleanup and reconciliation have finished — a query for completed scan versions never returns a version with uncommitted cleanup work.
  3. Running a full scan for repo A never deletes or modifies endpoints, actors, service-dependencies, or node-metadata owned by repo B — cross-repo contamination is structurally impossible.
  4. An abandoned scan (process killed mid-scan) leaves the database in a recoverable state — the next scan for that project completes successfully without manual intervention.

**Plans**: 1/2 plans executed

- [x] 138-01-PLAN.md — Transaction-ready DB primitives: applyPendingOverridesSync; endScan completed_at-last (ISO-04) + repo-scoped cleanup (ISO-05); beginScan startedAt + abandoned-scan recovery (ISO-10); query-engine-txn.test.js proving ISO-03/04/05/10
- [ ] 138-02-PLAN.md — Wire manager.js Phase B write path into one db.transaction (ISO-03), beginScan inside tx + per-repo rollback isolation (ISO-10); manager-txn.test.js end-to-end proof

---

### Phase 139: History Model, Run Identifier & Child Reconciliation

**Milestone**: v0.2.0
**Goal**: Two completed scans retain enough data for an accurate diff, all child state disappears after a successful full scan, and all repo scans from one map operation are grouped by a shared project run identifier. The history model design decision (append-only versioned rows vs immutable snapshot databases) is settled before this phase executes.
**Depends on**: Phase 138 (transactional scan must be solid before adding versioned history on top)
**Requirements**: ISO-06, ISO-07, ISO-08, ISO-09
**Success Criteria** (what must be TRUE):

  1. An explicit, documented history model is implemented — `/arcanon:diff HEAD~1 HEAD` produces correct added/removed/modified results referencing two real retained scan versions without SQL errors.
  2. After a successful full scan, endpoints, actors, service-dependencies, and node-metadata rows that existed in the prior scan but are no longer detected are absent from the graph and from diff output — removed state does not accumulate.
  3. A project-level run/map identifier groups all per-repo scan records created during one `/arcanon:map` invocation — the identifier is visible in scan metadata and usable for project-level version comparisons.
  4. Graph drift output references the correct column names (`scan_versions.started_at`, `scan_versions.completed_at`, `target_service_id`) and produces correct change sets between two retained versions.

**Plans**: 2 plans

- [ ] 139-01-PLAN.md — Wire snapshot history into scan completion: migration 021 (map_versions kind + repos_json), extend createSnapshot(db, label, kind, repos), once-per-run post-commit snapshot in manager.js, remove dead duplicate map-version path, ISO-07 roundtrip test (ISO-06, ISO-07, ISO-09)
- [ ] 139-02-PLAN.md — Reconcile the four child tables on successful scan: in-transaction pre-wipes for exposed_endpoints + actor_connections, post-bracket node_metadata pre-wipe + service_dependencies stale sweep, two-repo isolation test (ISO-08)

---

### Phase 140: Canonical Contract

**Milestone**: v0.2.0
**Goal**: One executable contract defines all finding shapes — crossing values, protocols, source locations, schemas, and evidence — and every persistence entry point validates against it before writing.
**Depends on**: Phase 139 (ISO foundation complete; CTR contract is built before the unified pipeline in Phase 141)
**Requirements**: CTR-01, CTR-02, CTR-03, CTR-04
**Success Criteria** (what must be TRUE):

  1. A schema finding submitted without an explicit connection identity is rejected before any database write — no finding silently attaches to every connection as a catch-all.
  2. `source_file` and optional symbol/line information are distinct, separately named fields in both the contract schema and the persistence layer — a scan emitting both can be stored and round-tripped without data loss or field collisions.
  3. Submitting a finding with an invalid crossing value, unrecognized protocol, or missing required field is caught at the contract validation layer — the error is logged and the finding is skipped, not written with corrupt or default-filled data.
  4. All existing persistence entry points (scanning manager, MCP handler, HTTP route) pass findings through the single canonical validator before any write — no direct call to `persistFindings()` with unvalidated input exists.

**Plans**: 3 plans

- [ ] 140-01-PLAN.md — Canonical contract.js module (cross-service crossing, connection_index, source_file/source_symbol split) + findings.js shim + agent-schema/prompts sync [CTR-01, CTR-02, CTR-03]
- [ ] 140-02-PLAN.md — Migration 022 (source_symbol/target_symbol) + persistFindings schema-attach-by-connection_index fix + symbol writes [CTR-02, CTR-03]
- [ ] 140-03-PLAN.md — POST /scan validateFindings gate (validate before any DB write) [CTR-04]

---

### Phase 141: ScanService Unification

**Milestone**: v0.2.0
**Goal**: One `ScanService` pipeline serves all entry points — `/arcanon:map`, `/arcanon:rescan`, MCP `impact_scan`, and HTTP scan — with no duplicated persistence logic, correct error propagation, and working incremental behavior.
**Depends on**: Phase 140 (canonical contract must be in place before the unified pipeline routes through it)
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, CTR-05
**Success Criteria** (what must be TRUE):

  1. Triggering a scan via `/arcanon:map`, via the MCP `impact_scan` tool, and via the HTTP scan endpoint all invoke the same `ScanService` code path — no duplicate `beginScan`/`endScan` calls, reconciliation logic, or override-application exist outside the service.
  2. MCP `impact_scan` returns a meaningful error response (not `{ triggered: true }`) when the underlying pipeline call fails — a failed scan is observable and actionable from the MCP response.
  3. Running `/arcanon:rescan` after pending corrections have been staged applies those corrections exactly once on the next successful scan and completes without throwing — no "pending overrides" exception surfaces to the user.
  4. An incremental scan preserves unchanged findings and removes only the findings owned by deleted or renamed files — a changed-files-only report does not wipe the full project snapshot.
  5. End-to-end tests confirm that scan initiation via the command, MCP, and HTTP transports all produce consistent, correct graph state.

**Plans**: 3 plans

Plans:

- [ ] 141-01-PLAN.md — scan-service.js: persistScanResult write pipeline + PIPE-04 incremental preserve/remove + real-DB E2E suite [PIPE-01, PIPE-03, PIPE-04, CTR-05]
- [ ] 141-02-PLAN.md — command + worker adapters: map.md/rescan.md Step 5 + manager.js Phase B route through persistScanResult [PIPE-01, PIPE-03, PIPE-04, CTR-05]
- [ ] 141-03-PLAN.md — HTTP /scan adapter + queryScan response.ok fix (PIPE-02 false-success) + transport tests [PIPE-01, PIPE-02, CTR-05]

---

### Phase 142: Integration Correctness

**Milestone**: v0.2.0
**Goal**: Drift, semantic search, and UI filtering all produce correct results against the fixed persistence layer — drift SQL is repaired, Chroma sync lives in the transactional completion path with project-namespaced IDs, and UI edges never dangle.
**Depends on**: Phase 141 (ISO + PIPE complete; correctness fixes build on the unified, transactional foundation)
**Requirements**: INTG-01, INTG-02, INTG-03, INTG-04
**Success Criteria** (what must be TRUE):

  1. `/arcanon:drift graph` runs successfully against two real retained scan versions — no SQL errors from missing or renamed columns; output correctly identifies added, removed, and changed services and connections.
  2. After a successful scan, the Chroma semantic search index reflects the current graph state — services or endpoints removed in the scan are absent from Chroma; sync occurs inside the scan-completion path, not in a disconnected `writeScan()` caller.
  3. A semantic search query scoped to project A returns zero results from project B's services — Chroma records are namespaced by project identity so identical service names across projects do not overwrite each other.
  4. The graph UI never renders an edge whose required source or target node is excluded by the active filter — invisible nodes produce no dangling half-drawn edges in the canvas.

**Plans**: 2 plans

- [ ] 142-01-PLAN.md — Wave 1: INTG-04 dangling-edge/invisible-node renderer fix + INTG-01 drift SQL-column fix (no cross-phase deps)
- [ ] 142-02-PLAN.md — Wave 2: INTG-01 snapshot routing via diffScanVersions + INTG-02 Chroma sync in Phase B + INTG-03 project-namespaced Chroma (depends on 139, 141)

**UI hint**: yes

---

### Phase 143: Scaling & Runtime Hardening

**Milestone**: v0.2.0
**Goal**: The system handles large maps and concurrent workloads without unbounded memory, latency, or file-handle leakage — response pagination, batched queries, bounded concurrency, pool eviction, and async Fastify routes are all in place.
**Depends on**: Phase 142 (integrations must return correct data before optimizing for scale)
**Requirements**: PERF-01, PERF-02, PERF-03, PERF-04, PERF-05, PERF-06
**Success Criteria** (what must be TRUE):

  1. `getGraph()` enforces a documented response size limit or pagination mechanism — a project exceeding the node limit returns a bounded payload with a clear indication that pagination or a summary view is available, rather than an unbounded serialization.
  2. `detectMismatches()`, actor-connection lookups, and evidence-file validation are batched within a scan run — no per-connection or per-actor N+1 query pattern produces measurable overhead under profiling with a realistic dataset.
  3. Query-plan tests confirm that indexes exist for upstream-impact traversal and scan-version access patterns, including target-side connection lookups — `EXPLAIN QUERY PLAN` output shows index scans, not full-table scans, for the hot paths.
  4. Multi-repo agent scanning uses a bounded, configurable concurrency limit — scanning 10 repos with a limit of 3 produces no more than 3 concurrent agent invocations at any point, and the bound is covered by a test.
  5. The DB pool evicts idle handles after a configurable timeout and closes all open handles on worker shutdown — no project database file descriptor remains open after the worker process exits.
  6. Fastify routes that perform synchronous SQLite reads or filesystem operations complete without blocking the Node.js event loop beyond the documented interactive-latency budget.

**Plans**: 5 plans (2 waves)

- [ ] 143-01-PLAN.md — PERF-03: perf-indexes migration (next-free >=023) + EXPLAIN QUERY PLAN tests [Wave 1]
- [ ] 143-02-PLAN.md — PERF-04 bounded scan concurrency + PERF-02 dep-collector rootPath dedup [Wave 1]
- [ ] 143-03-PLAN.md — PERF-05 pool idle eviction + closeAll + shutdown wiring [Wave 1]
- [ ] 143-04-PLAN.md — PERF-02 detectMismatches/actor batching + evidence file cache [Wave 1]
- [ ] 143-05-PLAN.md — PERF-01 getGraph pagination/summary + PERF-06 route observability/TTL caches + benchmark [Wave 2]

---

## Progress

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
| 59-62 | v5.2.0 | 5/5 | Complete | 2026-03-21 |
| 63-66 | v5.2.1 | 7/7 | Complete | 2026-03-21 |
| 67-73 | v5.3.0 | 12/12 | Complete | 2026-03-22 |
| 74-79 | v5.4.0 | 9/9 | Complete | 2026-03-22 |
| 80-83 | v5.5.0 | 9/9 | Complete | 2026-03-22 |
| 84-88 | v5.6.0 | 6/6 | Complete | 2026-03-23 |
| 89-91 | v5.7.0 | 3/3 | Complete | 2026-03-23 |
| 92-96 | v5.8.0 | 16/16 | Complete | 2026-04-19 |
| 97-100 | v0.1.1 | 12/12 | Complete | 2026-04-21 |
| 101-105 | v0.1.2 | 9/9 | Complete | 2026-04-23 |
| 107-113 | v0.1.3 | 14/14 | Complete | 2026-04-25 |
| 114-122 | v0.1.4 | 21/21 | Complete | 2026-04-27 |
| 123-127 | v0.1.5 | 5/5 | Complete | 2026-04-30 |
| 128 | v0.1.8 | 3/3 | Complete | 2026-06-20 |
| 129-134 | v0.1.9 | 13/13 | Complete | 2026-06-29 |
| 135 | v0.2.0 | 1/1 | Complete   | 2026-06-30 |
| 136 | v0.2.0 | 2/2 | Complete   | 2026-06-30 |
| 137 | v0.2.0 | 1/1 | Complete   | 2026-07-01 |
| 138 | v0.2.0 | 1/2 | In Progress|  |
| 139 | v0.2.0 | 0/? | Not started | - |
| 140 | v0.2.0 | 0/? | Not started | - |
| 141 | v0.2.0 | 0/? | Not started | - |
| 142 | v0.2.0 | 0/? | Not started | - |
| 143 | v0.2.0 | 0/? | Not started | - |
