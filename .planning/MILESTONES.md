# Milestones

## v0.1.2 Ligamen Residue Purge (Shipped: 2026-04-23)

**Phases completed:** 5 phases (101-105), 9 plans
**Requirements:** 46/46 complete (ENV-01..10, PATH-01..09, PKG-01..03, SRC-01..08, TST-01..07, DOC-01..03, README-01..03, VER-01..03)
**Timeline:** 2026-04-23 (single-day refactor milestone)

**Key accomplishments:**

- **Hard-removed all `LIGAMEN_*` env var reads** across worker, MCP server, libs, and scripts — no back-compat layer, no two-read fallback, no stderr deprecation warning
- **Removed `$HOME/.ligamen` data-dir fallback and `ligamen.config.json` reader** — only `$HOME/.arcanon` and `arcanon.config.json` honored
- **Renamed ChromaDB `COLLECTION_NAME`** from `"ligamen-impact"` to `"arcanon-impact"` — existing collections orphaned; users rebuild via `/arcanon:map`
- **Renamed `runtime-deps.json` package identity** from `@ligamen/runtime-deps` to `@arcanon/runtime-deps`
- **Source cosmetic sweep across 18 files** — comments, docstrings, log messages, Zod schema descriptions, agent prompts renamed or deleted where meaning became stale
- **Test suite rewrite across 17 files** — 110 renames; 1 obsolete test deleted (the `resolveCredentials ~/.ligamen/config.json` test whose functionality was removed in Phase 101)
- **README cleanup** — deleted "legacy honored for now" paragraphs, removed the entire `## Related repos` section (4 speculative outbound links)
- **CHANGELOG `### BREAKING` section** added with comprehensive migration instructions

**Breaking changes for v5.x upgraders:**
- Rename `ligamen.config.json` → `arcanon.config.json`
- Rename `$HOME/.ligamen/` → `$HOME/.arcanon/`
- Rename shell `LIGAMEN_*` env vars → `ARCANON_*`
- Rebuild ChromaDB collection via `/arcanon:map` (if using semantic search)

**Known non-regressions (documented):**
- bats 309/310 (1 macOS-only HOK-06 p99 latency caveat, pre-existing since v0.1.1, CI passes with `IMPACT_HOOK_LATENCY_THRESHOLD=100`)
- node 524/526 (2 pre-existing test failures unrelated to the rename, confirmed via git diff against pre-Phase-101 base)

---

## v0.1.1 Command Cleanup + Update + Ambient Hooks (Shipped: 2026-04-21)

**Phases completed:** 4 phases (97-100), 12 plans
**Requirements:** 46/46 complete
**Git range:** `d351150` → `ea081be` (49 commits, +1484/-380 LOC across 18 files)
**Timeline:** 2026-04-21 (single-day milestone)

**Key accomplishments:**

- Merged `/arcanon:cross-impact` into `/arcanon:impact` — absorbed `--exclude`, `--changed`, and the 3-state degradation model (no worker → grep fallback / worker up no map → prompt + partial / map has data → graph query) with a serialization guard so the delete only runs after the merge lands
- Shipped `/arcanon:update` self-update flow with four modes (`--check`, `--kill`, `--prune-cache`, `--verify`) — semver-correct, offline-safe, scan-lock guarded, SIGTERM→5s→SIGKILL shutdown, 10s health poll
- SessionStart banner now carries ambient cross-repo context: `"N services mapped. K load-bearing files. Last scan: date. Hub: status."` with stale prefix at 48h–7d (53ms warm-cache overhead measured)
- PreToolUse impact hook (`scripts/impact-hook.sh`) — Tier 1 bash pattern match for schema files (*.proto, openapi.*, swagger.*), Tier 2 SQLite root_path prefix match with trailing-slash guard, worker HTTP primary + SQLite fallback, self-exclusion inside `$CLAUDE_PLUGIN_ROOT`, `ARCANON_DISABLE_HOOK` + `ARCANON_IMPACT_DEBUG` env guards
- `auto_upload` → `auto_sync` rename across plugin.json userConfig, `worker/cli/hub.js`, `worker/scan/manager.js` with two-read fallback (`cfg?.hub?.["auto-sync"] ?? cfg?.hub?.["auto-upload"]`) + stderr deprecation warning on legacy key reads
- Deprecated `/arcanon:upload` stub preserved for one release (forwards to `/arcanon:sync` with stderr warning) so hardcoded CI pipelines don't break

**Deferred to Linear:**
- THE-1022 (High — scan quality), THE-1023 (read-only command polish), THE-1024 (scan ops), THE-1025 (UX polish), THE-1026 (integration improvements) — 18 of 20 external review points filed; 2 folded into this milestone

**Known tech debt:**
- `session-start.sh` duplicates `lib/db-path.sh` hash logic inline (consolidation opportunity, not a bug)
- `commands/update.md` has a stale "Phase 1 status" planning-era paragraph (cosmetic)

---

## v5.8.0 Library Drift & Language Parity (Shipped: 2026-04-19)

**Phases completed:** 0 phases, 0 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.7.0 Scan Accuracy (Shipped: 2026-03-23)

**Phases completed:** 3 phases, 3 plans, 5 tasks

**Key accomplishments:**

- Three-value crossing enum (internal/cross-service/external) added to agent-prompt-common.md with corrected examples across all type-specific scan prompts
- Post-scan reconciliation step added to map.md that auto-downgrades false external crossings to cross-service using the knownServices set built from all scan findings
- Mono-repo heuristic (subdirectory manifest detection) and client_files schema field added to discovery agent prompt for THE-951

---

## v5.6.0 Logging & Observability (Shipped: 2026-03-23)

**Phases completed:** 5 phases, 6 plans

**Key accomplishments:**

- Size-based log rotation (10MB max, 3 rotated files) with TTY-aware stderr suppression for daemon mode
- Structured error logging with full stack traces in all HTTP route and MCP tool handler catch blocks
- Scan lifecycle logging (BEGIN/END with repo count/mode, per-repo discovery/deep-scan/enrichment progress)
- Auth-db extractor entropy warnings wired to structured logger via setExtractorLogger
- QueryEngine accepts injected logger for cross-repo name collision warnings (replaces console.warn)

---

## v5.5.0 Security & Data Integrity Hardening (Shipped: 2026-03-22)

**Phases completed:** 4 phases, 9 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.4.0 Scan Pipeline Hardening (Shipped: 2026-03-22)

**Phases completed:** 6 phases, 9 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.3.0 Scan Intelligence & Enrichment (Shipped: 2026-03-22)

**Phases completed:** 7 phases, 12 plans, 2 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.2.1 Scan Data Integrity (Shipped: 2026-03-21)

**Phases completed:** 4 phases, 7 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.2.0 Plugin Distribution Fix (Shipped: 2026-03-21)

**Phases completed:** 4 phases, 5 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v5.1 Graph Interactivity (Shipped: 2026-03-21)

**Phases completed:** 7 phases, 11 plans, 2 tasks

**Key accomplishments:**

- Keyboard shortcuts module (F=fit, Esc=deselect, /=search, I=isolate, 2/3=expand depth) with input guard for typing contexts
- Clickable service names in detail panel — click-to-navigate with pan-to-center and panel replacement
- Subgraph isolation via N-hop BFS — press I to focus on neighborhood, 2/3 to expand, Esc to exit
- scan_version_id exposed in /graph API with latest_scan_version_id MAX computation for change detection
- What-changed overlay with yellow glow ring on new/modified nodes and edges, toggleable via toolbar button
- Edge bundling collapsing parallel edges into weighted edges with count badge, click-to-expand in detail panel
- PNG export via canvas.toDataURL — one-click download of current graph view
- 798 insertions across 14 files, 173/173 bats tests passing, zero regressions

---

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
