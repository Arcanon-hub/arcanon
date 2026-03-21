# Milestones

## v5.0 Marketplace Restructure (Shipped: 2026-03-21)

**Phases completed:** 3 phases, 5 plans, 0 tasks

**Key accomplishments:**

- Restructured repo as Claude Code marketplace — plugin source moved to `plugins/ligamen/` via history-preserving `git mv`
- Created `marketplace.json` at repo root for marketplace discovery (`"source": "./plugins/ligamen"`)
- Fixed drift-common.sh path traversal, Makefile targets, README MCP server path for new layout
- Fixed 3 test root causes (test_helper PLUGIN_ROOT, drift-common exit→return, worker-start version check)
- 173/173 bats tests passing, `claude plugin marketplace add` + `install` verified end-to-end

---

## v4.1 Command Cleanup (Shipped: 2026-03-20)

**Phases completed:** 3 phases, 6 plans, 0 tasks

**Key accomplishments:**

- Removed Kubernetes-specific commands (`/ligamen:pulse`, `/ligamen:deploy-verify`) and supporting `scripts/pulse-check.sh` — plugin now focused on code quality and cross-repo intelligence
- Swept all pulse/deploy-verify references from tests, docs, README, PROJECT.md, session-start context
- Added `drift_versions` MCP tool — query dependency version mismatches (CRITICAL/WARN/INFO severity) across scanned repos
- Added `drift_types` MCP tool — language-grouped shared type/struct/interface mismatch detection with 50-type cap
- Added `drift_openapi` MCP tool — OpenAPI spec breaking change detection with oasdiff graceful degradation
- MCP server now exposes 8 tools (5 impact + 3 drift), all with 19 new tests passing

---

## v4.0 Ligamen Rebrand (Shipped: 2026-03-20)

**Phases completed:** 7 phases, 14 plans, 0 tasks

**Key accomplishments:**

- Renamed npm package, plugin manifests, Makefile, and config file from allclear to ligamen (91 files, +605/-589 lines)
- Migrated 20+ environment variables from `ALLCLEAR_*` to `LIGAMEN_*` and all data/temp paths to `~/.ligamen/`
- Renamed all 6 slash commands to `/ligamen:*`, MCP server to `ligamen-impact`, and ChromaDB collection
- Updated all shell script and JavaScript source code headers, output messages, and agent prompts
- Migrated full test suite (bats + JS) with renamed env vars, paths, assertions, and fixtures
- Updated all documentation (README, docs/, planning) and graph UI branding to Ligamen

---

## v3.0 Layered Graph & Intelligence (Shipped: 2026-03-18)

**Phases completed:** 6 phases, 11 plans, 0 tasks

**Key accomplishments:**

- Migration 008 adds `actors`, `actor_connections`, and `node_metadata` tables for external system tracking and extensible metadata
- Deterministic layered layout engine replaces D3 force simulation — services/libraries/infra in stable rows with row wrapping
- Boundary grouping via `ligamen.config.json` — dashed rounded rectangles with labels around service clusters
- External actor detection from scan `crossing` field — hexagon nodes in dedicated right column with detail panel
- Protocol-differentiated edge styles: solid (REST), dashed (gRPC), dotted (events), arrowed (SDK), red (mismatch)
- Minimal top bar with collapsible filter panel — protocol, layer, boundary, language, mismatch-only, hide-isolated filters
- ChromaDB embeddings enriched with boundary context and actor relationships
- MCP `impact_query` and `impact_search` responses carry type-aware summaries and actor relationship sentences

---

## v2.3 Type-Specific Detail Panels (Shipped: 2026-03-18)

**Phases completed:** 3 phases, 5 plans, 0 tasks

**Key accomplishments:**

- Migration 007 adds `kind` column to `exposed_endpoints` with COALESCE unique index for NULL-safe dedup
- `persistFindings()` type-conditional dispatch: services split METHOD/PATH, libraries store raw signatures, infra stores raw resource refs
- `getGraph()` attaches per-node `exposes` arrays with graceful pre-migration degradation
- Three-way detail panel routing: library panel (Exports + Used by), infra panel (Manages + Wires), service panel unchanged
- XSS-safe rendering with `escapeHtml()` on all scan-derived string insertions

---

## v2.2 Scan Data Integrity (Shipped: 2026-03-16)

**Phases completed:** 3 phases, 5 plans, 0 tasks

**Key accomplishments:**

- UNIQUE(repo_id, name) constraint with in-place dedup + ON CONFLICT DO UPDATE upsert preserving row IDs across re-scans
- Scan version bracket (beginScan/endScan) with atomic stale-row cleanup — failed scans leave prior data intact
- Agent prompt service naming convention enforcing manifest-derived, lowercase-hyphenated names
- Cross-project MCP queries via per-call resolveDb dispatching by path/hash/repo name

---

## v2.1 UI Polish & Observability (Shipped: 2026-03-16)

**Phases completed:** 5 phases, 11 plans, 0 tasks

**Key accomplishments:**

- HiDPI/Retina-crisp canvas rendering with devicePixelRatio scaling and smooth exponential zoom/pan
- Shared structured logger with component tags across all worker modules (zero console.log in production code)
- Collapsible log terminal with 2s polling, ring buffer, component filter, keyword search, and auto-scroll
- Persistent project switcher with full event listener teardown and force worker termination between projects

---

## v2.0 Service Dependency Intelligence (Shipped: 2026-03-15)

**Phases completed:** 8 phases, 19 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v1.0 Plugin Foundation (Shipped: 2026-03-15)

**Phases completed:** 13 phases, 17 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---
