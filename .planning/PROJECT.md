# Arcanon

> Arcanon was previously developed under the name **Ligamen** (v1.0–v5.8.0), which
> itself was renamed from an earlier **allclear**. It was renamed to Arcanon and
> reset to v0.1.0 for public release. Pre-rename milestone archives below retain the
> historical names intentionally — they are accurate records of those eras.

## What This Is

An open-source Claude Code plugin that maps cross-repo service dependencies. It scans your linked repositories with Claude's agents to discover services, API endpoints, and the connections between them, stores the resulting graph in a local SQLite database, and visualizes it in an interactive graph UI. It also detects drift (dependency versions, shared types, OpenAPI contracts) across repos, runs automatic formatting/linting and sensitive-file guards on edit, and can optionally sync findings to Arcanon Hub. Supports TypeScript/JavaScript, Python, Go, Rust, Java, C#, and Ruby — with automatic project-type detection.

## Core Value

Understand and protect your architecture across repositories — see how services connect, catch breaking changes before they ship, and keep the map current automatically. Findings stay local and private by default; cloud sync is opt-in.

## Requirements

### Validated

- ✓ Universal quality gate command (`/ligamen:quality-gate`) with auto-detection of project type — v1.0
- ✓ Cross-repo impact scanning (`/ligamen:cross-impact`) — v1.0
- ✓ Cross-repo consistency checking (`/ligamen:drift`) — v1.0
- ✓ Auto-format hook on edit (PostToolUse) — v1.0
- ✓ Auto-lint hook on edit (PostToolUse) — v1.0
- ✓ Sensitive file guard hook (PreToolUse) — v1.0
- ✓ Session start context hook (SessionStart) — v1.0
- ✓ Git clone + symlink installation path — v1.0
- ✓ Bats test suite (150 tests) — v1.0
- ✓ Plugin commands use `(plugin:ligamen)` namespacing via commands/ directory — v1.0
- ✓ Quality gate skill for auto-invocation by agents — v1.0

- ✓ Service dependency map via `/ligamen:map` with two-phase agent scanning — v2.0
- ✓ Redesigned `/ligamen:cross-impact` with graph-based transitive impact analysis — v2.0
- ✓ Node.js worker daemon with auto-restart on version mismatch — v2.0
- ✓ MCP server with 5 impact tools for agent-autonomous checking — v2.0
- ✓ Interactive D3 Canvas graph UI with node coloring, mismatch indicators, detail panel — v2.0
- ✓ SQLite storage with WAL, FTS5, per-project isolation, migration system — v2.0
- ✓ Optional ChromaDB vector sync with 3-tier search fallback — v2.0
- ✓ Exposed endpoint cross-referencing for API mismatch detection — v2.0

- ✓ HiDPI/Retina canvas rendering with devicePixelRatio scaling — v2.1
- ✓ Smooth zoom/pan with trackpad pinch/scroll split (ctrlKey) — v2.1
- ✓ Fit-to-screen button to center all nodes — v2.1
- ✓ Shared structured logger with component tags across all worker modules — v2.1
- ✓ Collapsible log terminal with real-time streaming, component filter, keyword search — v2.1
- ✓ Persistent project switcher dropdown with full teardown and in-place reload — v2.1

- ✓ Idempotent scan upsert with UNIQUE(repo_id, name) and ON CONFLICT DO UPDATE — v2.2
- ✓ Scan version bracket (beginScan/endScan) with atomic stale-row cleanup — v2.2
- ✓ Agent prompt service naming convention (lowercase-hyphenated from manifest) — v2.2
- ✓ Cross-project MCP queries via repository name from any working directory — v2.2

- ✓ Type-conditional exposed data storage with `kind` column (endpoint/export/resource) — v2.3
- ✓ Library detail panel showing exported types/interfaces grouped by functions vs types, plus consumer services — v2.3
- ✓ Infra detail panel showing managed resources grouped by prefix, plus wired services — v2.3
- ✓ XSS-safe detail panel rendering with `escapeHtml()` on scan-derived strings — v2.3

- ✓ Deterministic layered layout replacing force simulation (services/libraries/infra rows with row wrapping) — v3.0
- ✓ Boundary grouping via `ligamen.config.json` with dashed rounded rectangle rendering — v3.0
- ✓ External actor detection from scan `crossing` field, hexagon nodes in right column — v3.0
- ✓ Node shapes per type: circles (services), outline diamonds (libraries), filled diamonds (infra), hexagons (actors) — v3.0
- ✓ Protocol-differentiated edge styles: solid (REST), dashed (gRPC), dotted (events), red (mismatch) — v3.0
- ✓ Minimal top bar with collapsible filter panel (protocol, layer, boundary, language, mismatch, isolated) — v3.0
- ✓ `node_metadata` table for future extensible view data (STRIDE, vulns) — v3.0
- ✓ ChromaDB embeddings enriched with boundary + actor context — v3.0
- ✓ MCP impact responses with type-aware summaries and actor relationship sentences — v3.0

- ✓ Full rebrand from allclear to ligamen across 91 files (package, manifests, env vars, paths, commands, MCP, source, tests, docs, UI) — v4.0
- ✓ All 20+ environment variables migrated from `ALLCLEAR_*` to `LIGAMEN_*` — v4.0
- ✓ All 6 slash commands renamed to `/ligamen:*` — v4.0
- ✓ MCP server and ChromaDB collection renamed to `ligamen-impact` — v4.0
- ✓ Full test suite (bats + JS) migrated with zero regressions — v4.0

- ✓ Removed Kubernetes-specific commands (`/ligamen:pulse`, `/ligamen:deploy-verify`) and `scripts/pulse-check.sh` — v4.1
- ✓ Swept all pulse/deploy-verify references from tests, docs, README, session-start — v4.1
- ✓ Added `drift_versions` MCP tool for dependency version mismatch detection — v4.1
- ✓ Added `drift_types` MCP tool for shared type/struct/interface mismatch detection — v4.1
- ✓ Added `drift_openapi` MCP tool for OpenAPI spec breaking change detection — v4.1
- ✓ MCP server expanded from 5 to 8 tools with 19 new drift tests — v4.1

- ✓ Repo restructured as Claude Code marketplace with plugin source under `plugins/ligamen/` — v5.0
- ✓ marketplace.json at repo root for `claude plugin marketplace add` discovery — v5.0
- ✓ All internal paths (shell, JS, hooks, Makefile) updated for new layout — v5.0
- ✓ 173/173 bats tests passing with restructured paths — v5.0

- ✓ Keyboard shortcuts (F=fit, Esc=deselect, /=search, I=isolate, 2/3=expand depth) — v5.1
- ✓ Clickable service names in detail panel connections list for graph navigation — v5.1
- ✓ Subgraph isolation with N-hop BFS neighborhood focus — v5.1
- ✓ scan_version_id exposed in /graph API for change detection — v5.1
- ✓ What-changed overlay with yellow glow ring on new/modified nodes and edges — v5.1
- ✓ Edge bundling collapsing parallel edges into weighted edges with count badge — v5.1
- ✓ PNG export via canvas.toDataURL for one-click architecture screenshots — v5.1

- ✓ SessionStart hook installs runtime deps into ${CLAUDE_PLUGIN_ROOT} with diff-based idempotency — v5.2.0
- ✓ Self-healing MCP wrapper installs deps if missing before server exec — v5.2.0
- ✓ MCP server starts from marketplace install without NODE_PATH (ESM-compatible) — v5.2.0
- ✓ All 5 manifest files version-synced to 5.2.0 — v5.2.0
- ✓ Plugin directory cleanup: README, LICENSE, .gitignore, source guards — v5.2.0

- ✓ POST /scan uses beginScan/endScan bracket for stale data cleanup (THE-930) — v5.2.1
- ✓ Legacy NULL scan_version_id rows garbage collected after full scan (THE-931) — v5.2.1
- ✓ Cross-repo service ID resolution scoped by repoId (THE-932) — v5.2.1
- ✓ Incremental scan bounded to changed files with no-op on empty diff (THE-933) — v5.2.1
- ✓ Confirmation flow accepts synonyms, re-prompts on ambiguous input (THE-934) — v5.2.1
- ✓ upsertService/upsertConnection sanitize undefined→null (THE-935) — v5.2.1
- ✓ CLI fallback scan passes explicit project root to openDb (THE-936) — v5.2.1

- ✓ Quality-gate spun out — command and skill removed from plugin (THE-937) — v5.3.0
- ✓ Schema/field data surfaced in detail panel with escapeHtml safety (THE-938) — v5.3.0
- ✓ Confidence/evidence persisted on connections via migration 009 (THE-939) — v5.3.0
- ✓ CODEOWNERS team ownership extracted via enrichment pass (THE-940) — v5.3.0
- ✓ Enrichment pass architecture with per-pass failure isolation (THE-941) — v5.3.0
- ✓ Agent prompt makes source_file required; validation warns on null (THE-942) — v5.3.0
- ✓ Auth mechanism and DB backend extracted via regex enrichment pass (THE-943) — v5.3.0
- ✓ Missing metadata shows "unknown" in detail panel (THE-944) — v5.3.0

- ✓ Known-service guard prevents phantom actor hexagons in graph for scanned services (THE-945) — v5.4.0
- ✓ detectRepoType docker-compose exemption + Go/Java/Poetry library heuristics (THE-955) — v5.4.0
- ✓ CODEOWNERS enricher uses absolute path for probing, relative for matching (THE-956) — v5.4.0
- ✓ Discovery agent (Phase 1) wired before deep scan with {{DISCOVERY_JSON}} injection (THE-953) — v5.4.0
- ✓ Multi-language prompt examples (Java, C#, Ruby, Kotlin) replacing Python/JS bias (THE-959) — v5.4.0
- ✓ Dead code removed: agent-prompt-deep.md deleted, promptDeep variable removed (THE-954) — v5.4.0
- ✓ findings.js warn-and-skip for invalid type enum, empty root_path/language (THE-957) — v5.4.0
- ✓ execFileSync with argument arrays replacing execSync string interpolation (THE-958) — v5.4.0
- ✓ Parallel scan fan-out with retry-once and skip-with-warning (THE-952) — v5.4.0
- ✓ Graph UI actor dedup filter as defense-in-depth layer (THE-948) — v5.4.0
- ✓ All manifests at version 5.4.0 — v5.4.0

- ✓ MCP resolveDb() path traversal protection with path.resolve + startsWith guard — v5.5.0
- ✓ Shannon entropy credential rejection (>=4.0 bits/char) in auth-db enricher — v5.5.0
- ✓ Concurrent scan lock with filesystem PID-based stale detection — v5.5.0
- ✓ endScan() schema FK cleanup for null-versioned connections — v5.5.0
- ✓ upsertRepo() correct row ID on ON CONFLICT UPDATE — v5.5.0
- ✓ node_metadata enrichment tests use canonical view names — v5.5.0
- ✓ session-start.sh version mismatch worker restart — v5.5.0
- ✓ Multi-strategy agent output parsing (fenced block, raw JSON, substring extraction) — v5.5.0
- ✓ Transitive impact depth limit (7 hops) with 30s query timeout — v5.5.0
- ✓ Auth-db extractor traversal guards (depth 8, 1MB cap, 8 excluded dirs) — v5.5.0
- ✓ FTS5 LRU prepared statement cache (capacity 50) — v5.5.0
- ✓ Journal mode pragma ordering contract tests — v5.5.0
- ✓ /ligamen:map asks for project name before first scan — v5.5.0

- ✓ Size-based log rotation (10MB max, keep 3 files) — v5.6.0
- ✓ Stderr daemon detection (skip stderr when no TTY) — v5.6.0
- ✓ Scan lifecycle logging (BEGIN/END + per-repo progress) — v5.6.0
- ✓ setExtractorLogger wired for auth-db entropy warnings — v5.6.0
- ✓ err.stack in all error log calls across worker modules — v5.6.0
- ✓ HTTP route errors logged to structured logger with stack traces — v5.6.0
- ✓ MCP tool errors logged to structured logger with stack traces — v5.6.0
- ✓ QueryEngine accepts injected logger (replaces console.warn) — v5.6.0

- ✓ Three-value crossing semantics (external/cross-service/internal) in agent prompts (THE-949) — v5.7.0
- ✓ Post-scan reconciliation downgrades external→cross-service for known services (THE-949) — v5.7.0
- ✓ Mono-repo detection via multi-manifest subdirectory scanning (THE-951) — v5.7.0
- ✓ client_files field in discovery schema for outbound HTTP call identification (THE-951) — v5.7.0

- ✓ Maven `pom.xml` parser with `<parent>` inheritance + `<dependencyManagement>` resolution (MF-01) — v5.8.0
- ✓ Gradle parsers for Groovy + Kotlin DSL + `libs.versions.toml` catalog (MF-02, MF-03) — v5.8.0
- ✓ NuGet parser with Central Package Management (`Directory.Packages.props`) (MF-04) — v5.8.0
- ✓ Bundler `Gemfile.lock` parser covering GEM/GIT/PATH sections (MF-05) — v5.8.0
- ✓ Java/.NET/Ruby language detection in `detect.sh` + `discovery.js` MANIFESTS (LANG-01..03) — v5.8.0
- ✓ Java/C#/Ruby type extractors in `drift-types.sh` with tmpdir pattern (TYPE-01..05) — v5.8.0
- ✓ Migration 010 `service_dependencies` table with `dep_kind` discriminant + 4-col UNIQUE + ON DELETE CASCADE (DEP-01..04) — v5.8.0
- ✓ `dep-collector.js` enrichment module covering 7 ecosystems (npm/pypi/go/cargo/maven/nuget/rubygems) production-deps-only (DEP-05..07) — v5.8.0
- ✓ QueryEngine `upsertDependency` + `getDependenciesForService` with row-id stability (DEP-08) — v5.8.0
- ✓ `manager.js` Phase B loop wired to dep-collector with cascade-based stale cleanup (DEP-09..11) — v5.8.0
- ✓ Auth/DB enrichment for Java (Spring Security 5+6, Spring Data), C# (ASP.NET Identity, EF Core minimal API), Ruby (Devise, ActiveRecord, `config/database.yml` adapter probe) (ENR-01..09) — v5.8.0
- ✓ Unified `scripts/drift.sh` dispatcher with reserved `licenses|security` slots (DSP-01..04, DSP-08) — v5.8.0
- ✓ `lib/worker-restart.sh` extracted from session-start + worker-start with PID-file mutex preserved (DSP-05..07) — v5.8.0
- ✓ Shell bug fixes: bc fork removed, declare -A leak fixed, global stderr suppression removed, Bash 4+ floor (DSP-09..12) — v5.8.0
- ✓ Dead code removed: `impact.sh classify_match()`, `lint.sh npm bin` fallback (DSP-13) — v5.8.0
- ✓ Hub Payload v1.1 with feature flag `hub.beta_features.library_deps` (default off, v1.0 fallback always works) (HUB-01..05) — v5.8.0

- ✓ `/arcanon:cross-impact` merged into `/arcanon:impact` (absorbed `--exclude`, `--changed`, 3-state degradation) (CLN-01, 02, 10..13) — v0.1.1
- ✓ `/arcanon:sync` absorbs `/arcanon:upload` semantics with `--drain`/`--repo`/`--dry-run`/`--force` (CLN-03, 04, 09) — v0.1.1
- ✓ `/arcanon:upload` deprecated stub forwarding to `/arcanon:sync` with stderr warning (CLN-05) — v0.1.1
- ✓ Plugin config rename `auto_upload` → `auto_sync` with two-read fallback + stderr deprecation warning (CLN-06..08) — v0.1.1
- ✓ `/arcanon:update` self-update command with `--check`/`--kill`/`--prune-cache`/`--verify` modes (UPD-01..13) — v0.1.1
- ✓ SessionStart banner enrichment: service count + load-bearing files + last scan + hub status with stale prefix (SSE-01..07) — v0.1.1
- ✓ PreToolUse impact hook: Tier 1 schema patterns + Tier 2 SQLite root_path prefix + worker HTTP fallback + self-exclusion + debug JSONL (HOK-01..13) — v0.1.1

- ✓ Zero `LIGAMEN_*` env var reads across worker, lib, scripts (ENV-01..10) — v0.1.2
- ✓ Zero `$HOME/.ligamen` / `ligamen.config.json` fallback branches (PATH-01..09) — v0.1.2
- ✓ `runtime-deps.json` renamed to `@arcanon/runtime-deps` (PKG-01..03) — v0.1.2
- ✓ ChromaDB `COLLECTION_NAME` renamed to `"arcanon-impact"` (ENV-10) — v0.1.2
- ✓ Source cosmetic sweep: zero `ligamen` mentions in worker JS, agent prompts, schema, scripts, libs (SRC-01..08) — v0.1.2
- ✓ Test suite rewrite: all bats + node tests exercise `ARCANON_*` / `arcanon.config.json` / `~/.arcanon/` (TST-01..07) — v0.1.2
- ✓ Docs + README purge: CHANGELOG BREAKING section, README legacy paragraphs removed, Related repos section deleted (DOC-01..03, README-01..03) — v0.1.2
- ✓ Final verification gate: zero ligamen refs in source/tests/docs (CHANGELOG BREAKING section exempt) (VER-01..03) — v0.1.2

- ✓ Install architecture rebuilt — single source of truth = package.json; `install-deps.sh` rewritten with sha256-of-deps sentinel + `require("better-sqlite3")` binding-load validation + npm rebuild fallback; `mcp-wrapper.sh` trimmed to 12 lines (INST-01..12) — v0.1.3
- ✓ `/arcanon:update --check` decoupled from 5s refresh timeout — file-existence is offline source of truth (UPD-01..06) — v0.1.3
- ✓ `/arcanon:upload` deprecated stub removed — README + skill + tests scrubbed (DEP-01..06) — v0.1.3
- ✓ New `/arcanon:verify` command — re-reads cited evidence; returns ok/moved/missing/method_mismatch verdicts (TRUST-01) — v0.1.3
- ✓ Evidence-at-ingest enforcement — `persistFindings` rejects prose-only evidence (TRUST-02) — v0.1.3
- ✓ Path canonicalization — template variants collapse via `{xxx}` → `{_}` with originals in `connections.path_template` (TRUST-03) — v0.1.3
- ✓ `services.base_path` migration + agent prompt + connection resolution stripping (TRUST-04) — v0.1.3
- ✓ Per-scan quality score — `scan_versions.quality_score` + `/api/scan-quality` endpoint + surface in /arcanon:map and /arcanon:status (TRUST-05) — v0.1.3
- ✓ Reconciliation audit trail — `enrichment_log` table + `impact_audit_log` MCP tool (9 tools total) (TRUST-06) — v0.1.3
- ✓ v0.1.3 release gate — bats 315/315, node 630/631 (1 pre-existing carry-forward), 4 manifests at 0.1.3 + lockfile, CHANGELOG `[0.1.3]` pinned (VER-01..07) — v0.1.3

- ✓ `/arcanon:list` (NAV-01) — 5-line project overview; silent in non-Arcanon dirs; `--json` — v0.1.4
- ✓ `/arcanon:view` (NAV-02) — top-level alias for `/arcanon:map view`; pure markdown command — v0.1.4
- ✓ `/arcanon:doctor` (NAV-03) — 8-check diagnostics with structured exit codes; `--json` — v0.1.4
- ✓ `/arcanon:diff <scanA> <scanB>` (NAV-04) — pool-agnostic diff engine; 4 input forms (int IDs, HEAD/HEAD~N, ISO, branch); `--json` — v0.1.4
- ✓ Universal `--help` system (HELP-01..04) — `lib/help.sh` extractor sourced by every `/arcanon:*` command — v0.1.4
- ✓ `/arcanon:status` per-repo freshness (FRESH-01..05) — `GET /api/scan-freshness` with per-repo `git rev-list --count` — v0.1.4
- ✓ `scan_overrides` persistence + apply hook (CORRECT-01..03) — migration 017 + `applyPendingOverrides` injected between `persistFindings` and `endScan` — v0.1.4
- ✓ `/arcanon:correct` + `/arcanon:rescan` (CORRECT-04..07) — stage + consume; `/rescan` markdown-orchestrated post-correction — v0.1.4
- ✓ Shadow-DB validate-before-commit workflow (SHADOW-01..04) — `/shadow-scan` + `/diff --shadow` + atomic `/promote-shadow` with WAL sidecars — v0.1.4
- ✓ Hub envelope v1.2 + offline + explicit-spec drift (INT-01..05) — byte-identity preserved for v1.1 callers via Test M11 — v0.1.4
- ✓ Externals catalog + user extension + `actors.label` surfacing (INT-06..10) — 20 entries, migration 018, `external_labels` user override — v0.1.4
- ✓ v0.1.4 release gate (VER-01..07) — bats 448/449, node 774/775, manifests at 0.1.4, lockfile regen, CHANGELOG `[0.1.4]` pinned — v0.1.4

- ✓ PII path-masking primitive (`worker/lib/path-mask.js` — `maskHome` + `maskHomeDeep` with cycle-safe WeakSet, idempotent on already-relative paths) wired at 4 egress seams (MCP, HTTP, logger, export) + parse-time absolute-`source_file` reject in `findings.parseAgentOutput` (PII-01..07) — v0.1.5
- ✓ Hub auth core / X-Org-Id contract — `uploadScan` sends `X-Org-Id`; missing-orgId throws `HubError(code='missing_org_id')` BEFORE network attempt; new `worker/hub-sync/whoami.js` returning `{user_id, key_id, scopes, grants}`; `resolveCredentials({orgIdRequired})` precedence chain (opts → env → home-config); `storeCredentials` spread-merge default_org_id mode 0600; per-repo `hub.org_id` threading via `manager.js _readHubConfig` (AUTH-01..05) — v0.1.5
- ✓ Whoami-driven `/arcanon:login` flow with full 4×2 branch table (auth/hub-5xx/network × `--org-id`/no-flag); auto-select-on-N=1 grant; multi-grant `AskUserQuestion` re-entry via exit-7 + `__ARCANON_GRANT_PROMPT__` stdout sentinel; verified-vs-mismatch differentiation (AUTH-06) — v0.1.5
- ✓ `/arcanon:status` Identity block (nested `identity:` object in `--json`, additive contract per D-125-03) + 7-code RFC 7807 error parser (frozen `HUB_ERROR_CODE_MESSAGES` map; `body.title` fallback for forward-compat) (AUTH-07, AUTH-08) — v0.1.5
- ✓ 4-file docs sweep — `commands/login.md`, `commands/status.md`, `arcanon.config.json.example`, `docs/{hub-integration,getting-started,configuration}.md` cover the credential triple, env vars, login flow, resolution precedence (AUTH-09) — v0.1.5
- ✓ Auth regression test suite — `client.test.js` 7-code table-driven test, new `whoami.test.js` (7 tests), `integration.test.js` round-trip via `withTempHome` async fixture; net 824 total / 823 pass / 1 baseline-flake fail (AUTH-10) — v0.1.5
- ✓ v0.1.5 release gate (VER-01..03) — 4 manifests pinned at 0.1.5 + lockfile regen, CHANGELOG `[0.1.5]` with explicit BREAKING/THE-1030 callout, bats 458/459 + node 823/824 green at v0.1.4 floors — v0.1.5

- ✓ Native SQLite migration — replaced `better-sqlite3` with Node's built-in `node:sqlite` (`DatabaseSync`) behind a thin adapter; eliminated the runtime native-module install that raced Claude Code's ~30s MCP connection timeout; Node floor raised to >=22.13 — v0.1.8 (PR #38)

- ✓ Shadow trio removed end-to-end — `/arcanon:shadow-scan`, `/arcanon:promote-shadow`, `/arcanon:diff --shadow` + worker machinery deleted; `diffScanVersions` scan-version engine preserved (RM-01..06) — v0.1.9
- ✓ `/arcanon:rescan` repaired — inline `node` repointed off removed `better-sqlite3` onto the `node:sqlite` adapter; regression test pins the resolve path (FIX-01, TST-01) — v0.1.9
- ✓ One canonical protocol vocabulary across scan→persist→getGraph→UI with fallback-not-reject — pub/sub, DB, GraphQL, SSE + unknown all render as toggleable edges, never dropped (PV-01..18, #42) — v0.1.9
- ✓ `detectMismatches()` no longer false-flags parameterized routes — two-sided `{param}`→`{_}` canonicalization + `rest`/`grpc` allowlist skips non-HTTP protocols (DM-01..03, #43) — v0.1.9
- ✓ Agent scanner detects network backing-service clients (datastore/broker/search/cache/vector DB) by reasoning, examples-not-allowlist — `arcanon→chromadb` now detectable (SC-01..07, #45) — v0.1.9
- ✓ `detectMismatches()` is method-aware — `(method, canonicalPath)`-keyed `exposedByMethod` Map, case-insensitive, null-method path-only fallback (MM-01..09, #46) — v0.1.9
- ✓ v0.1.9 release gate (VER-01..02) — 3 manifests pinned at 0.1.9 + lockfile regen, CHANGELOG `[0.1.9]` BREAKING, zero shadow references, worker 945/945 — v0.1.9

### Active

- (planning next milestone — run `/gsd-new-milestone`)

## Current State

**Shipped:** v0.1.9 Shadow Trio Removal, Rescan Repair & Scan/Mismatch Fixes (2026-06-29) — 6 phases (129-134), 13 plans, 32 tasks, 52/52 REQs, git range `ca5cb96..af8dfae` (PRs #41/#44/#47/#48). Audit `tech_debt` (no blockers). Preceded by v0.1.8 Native SQLite Migration (Phase 128, PR #38) and the out-of-roadmap v0.1.6/0.1.7 dependency-install hardening.

**Scan/graph accuracy today (post-v0.1.9):** One canonical protocol vocabulary (`rest·grpc·events·db·internal·sdk` + infra + `other`) shared scan→persist→getGraph→UI with fallback-not-reject — no protocol is silently dropped. `detectMismatches()` is canonicalized on both sides and method-aware, so parameterized routes and non-HTTP protocols no longer false-flag. The agent scanner detects network backing-service clients (datastore/broker/search/cache/vector DB) by reasoning, so edges like `arcanon→chromadb` surface. Storage runs on Node's built-in `node:sqlite` (no runtime native install). Command surface is lean — the shadow-scan trio is gone; `/arcanon:diff <scanA> <scanB>` is the documented scan-comparison path.

**Operator surface (carried from v0.1.5):** `/arcanon:login` whoami-driven flow, `/arcanon:status` Identity block, `/arcanon:sync` with `X-Org-Id`, credential triple in `~/.arcanon/config.json` (mode 0600), egress `$HOME` masking at MCP/HTTP/logger/export.

**Hub-side blocker (live):** arcanon-hub THE-1030 still not deployed — the hub-half of the product (login round-trip + sync upload) remains non-functional until the hub enforces `X-Org-Id` and serves `whoami`. All local features work standalone. Marketplace publication held back until hub is reachable.

**Deferred at v0.1.9 close:** Phase 131 live-graph human-verify (#42) — code + automated tests green, visual confirmation of db/other edge buckets + colors in a running `/arcanon:view` not yet done. Plus the v0.1.5 carry-forwards still pending on the THE-1030 hub deploy (3 operator e2e walkthroughs, Phase 114 UAT). Recorded in `STATE.md` / milestone audit.

## Next Milestone Goals

Open candidates for the next planning cycle (run `/gsd-new-milestone` to scope one):

- **Operator validation closeout** — once arcanon-hub THE-1030 deploys, run the bundled walkthroughs against the live hub, flip VER-04, publish to marketplace.
- **v0.2.0 Skills & Agents** — design the skills layer on top of shipped hooks, refactor inline `Explore` agent calls, add an MCP-tool-composing investigator agent. Deferred since v0.1.1.
- **Scan-accuracy follow-ons** — live `arcanon→chromadb` re-scan verification (#45), a dedicated `db`-bucket mismatch-exclusion test, and trailing-slash/case path-normalization (deferred from #46).
- **Status PII closeout** — mask `data_dir` + `config_file` in cmdStatus and add a bats grep gate (pre-existing v0.1.4 leak).
- Windows CI hardening (support works by design but is unverified — no Windows CI).

## (archived) Milestone: v0.1.3 Trust & Foundations

**Goal:** Land both High-priority backlog items (THE-1022 scan trust, THE-1028 install architecture) plus a tightly-scoped fix (THE-1027 update-check timeout) and remove the deprecated `/arcanon:upload` stub. v0.1.3 ships with a trustworthy install path, a trustworthy scan layer, and a tighter command surface.

**Target work (4 categories):**

1. **THE-1028 — Install + worker startup architecture cleanup** (High)
   - Delete `runtime-deps.json`; single source of truth = `package.json`
   - Rewrite `install-deps.sh` with sha256 sentinel + `require()` validation + rebuild fallback
   - Reduce `mcp-wrapper.sh` to plain `exec node server.js`

2. **THE-1022 — Scan quality & trust hardening** (High, 6 sub-items)
   - New `/arcanon:verify` command (re-read source, confirm cited evidence)
   - Evidence schema enforcement at `persistFindings`
   - Path canonicalization (template variable normalization)
   - `services.base_path` migration + scan prompt update
   - Per-scan quality score (`scan_versions.quality_score`)
   - Reconciliation audit trail (`enrichment_log` table)

3. **THE-1027 — `/arcanon:update --check` 5s timeout false-offline** (Medium)
   - Decouple offline-decision from refresh-outcome

4. **DEP — Deprecated command removal** (no Linear ticket, scope addition)
   - Delete `commands/upload.md` and its 5 bats tests
   - Add regression test asserting `/arcanon:upload` is absent
   - Scrub README + skill + doc references
   - Brings forward the originally-planned v0.2.0 removal

**Breaking changes:** `/arcanon:upload` removed (CI scripts hardcoded to it must update). `runtime-deps.json` deletion forces install-deps.sh sentinel mismatch on first session post-upgrade → one-time reinstall. Both documented in CHANGELOG `### BREAKING`.

**Scope discipline:** No new commands beyond `/arcanon:verify`. Not adding `/arcanon:list`, `/arcanon:doctor`, `/arcanon:diff` — those are v0.1.4. Not adding `--help` system — that's v0.1.4. Not touching scan ops or integrations — those are v0.1.5.

## Next Milestone Goals

After v0.1.3 ships:

- **v0.1.4 Read-only & UX** — THE-1023 (`/list`, `/view`, `/doctor`, `/diff` commands), THE-1025 (status freshness completion + `--help` on every command)
- **v0.1.5 Scan Ops & Integration** — THE-1024 (`/rescan`, `/correct`, `/shadow-scan` + `scan_overrides` table + shadow DB), THE-1026 (offline mode, explicit OpenAPI specs, known-externals catalog)
- **v0.2.0 Skills & Agents** — Design the skills layer on top of shipped hooks, refactor inline `Explore` agent calls, add MCP-tool-composing investigator agent. Intentionally deferred since v0.1.1.

### Out of Scope

- Linear issue enrichment — other plugins cover this; no external service dependencies
- GitHub Issues integration — same reasoning
- Any issue tracker integration — keep Ligamen focused on code and infrastructure
- RamaEdge-specific logic — plugin must remain generic and framework-agnostic
- Auto-fix for test/typecheck failures — unsafe, may silently alter code semantics
- xterm.js interactive terminal — log viewer uses styled div, not a full terminal emulator
- Backwards compatibility with `~/.allclear/` or `ALLCLEAR_*` — clean break, no migration path

## Context

Shipped v0.1.1 (Arcanon) — 100 phases across 20 milestones, 184 plans. Command surface is clean: `/arcanon:cross-impact` merged into `/arcanon:impact` (with `--exclude`, `--changed`, 3-state degradation preserved), `/arcanon:upload` deprecated (stub forwards to `/arcanon:sync`), new `/arcanon:update` flow handles self-update with version check / scan-lock guard / kill / prune / verify. Ambient cross-repo awareness wired via SessionStart banner enrichment (`N services mapped. K load-bearing files. Last scan: date. Hub: status.`) and PreToolUse impact hook (Tier 1 schema patterns + Tier 2 SQLite root_path prefix match + worker HTTP fallback, p99 <50ms Linux target, 130ms macOS). Config key `auto_upload` renamed to `auto_sync` with two-read fallback.

Prior foundations carried forward from v5.8.0: library-level drift end-to-end (Maven/Gradle/NuGet/Bundler/Ruby parsers, Java/C#/Ruby type parity, service_dependencies persistence), marketplace structure with plugin source under `plugins/arcanon/`, MCP server with 8 tools (5 impact + 3 drift), auto-deps install via SessionStart hook + self-healing MCP wrapper, post-scan enrichment extracting CODEOWNERS ownership, auth mechanisms, and database backends, confidence/evidence on connections, schema/field data in detail panel.

Architecture: commands/ for user-invoked features, skills/ for auto-invoked knowledge, hooks/ for formatting/linting/guarding, worker/ for Node.js daemon (db/, server/, scan/, mcp/, ui/ subdirectories), lib/ for shared bash/JS libraries. Two-phase scan pipeline: discovery agent (Phase 1) detects languages/frameworks/entry-points, then deep scan agent (Phase 2) receives discovery context via {{DISCOVERY_JSON}} for language-aware analysis. Agent prompts modularized into type-specific variants (service, library, infra) with shared common component and multi-language examples. Parallel scan fan-out with retry-once error handling. Three-value crossing semantics (external/cross-service/internal) with post-scan reconciliation that downgrades false externals. Graph UI uses deterministic layered layout with boundary grouping, actor dedup filter, and protocol-differentiated edges. Filter panel provides protocol, layer, boundary, language, mismatch, and isolated-node toggles. Production-grade logging with size-based rotation, structured error logging with stack traces across all modules, and scan lifecycle observability.

Known tech debt: db/database.js has console.log in script-mode guard, getQueryEngineByHash inline migration workaround, renderLibraryConnections() unused `outgoing` parameter, node_metadata table unused (forward-looking for STRIDE/vuln views), impact-flow.bats imports stale module paths (pre-existing from v3.0 restructure), package.json bin entry references non-existent ligamen-init.js, graph-fit-to-screen.test.js has 2 stale assertions for inlined fitToScreen() (Phase 26 regression).

---
*Last updated: 2026-06-29 — after v0.1.9 milestone close (Shadow Trio Removal, Rescan Repair & Scan/Mismatch Fixes shipped)*

## Constraints

- **Plugin format**: Must follow Claude Code plugin conventions (commands/, skills/, hooks.json)
- **Framework-agnostic**: Detect project type from files, never assume a specific framework
- **No external service deps**: Every command must work with only local files and git
- **License**: AGPL-3.0-only
- **Testing**: Bats-core for hook shell scripts, node:test for worker JS
- **Detect, don't configure**: Infer everything from project files; zero-config by default with optional overrides via ligamen.config.json
- **Non-blocking hooks**: Format/lint hooks must not block edits on failure — warn and continue
- **Cross-repo discovery**: Auto-detect linked repos from parent directory, override with config file

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dedicated repo (not part of claude-code) | Clean separation between private orchestration and open-source plugin | ✓ Good |
| Drop /allclear scope (renamed to /ligamen) | Other plugins handle issue enrichment; keeps Ligamen zero external deps | ✓ Good |
| Apache 2.0 license | Permissive with patent protection, standard for dev tools | ✓ Good |
| Auto-detect + config override for linked repos | Parent dir scan works for flat layouts, config.json for custom setups | ✓ Good |
| Canvas not SVG for graph UI | SVG degrades at 30+ nodes, Canvas scales to 100+ | ✓ Good |
| Web Worker for D3 force simulation | Keeps main thread free for smooth 60fps interaction | ✓ Good |
| Cross-impact v2 as separate milestone | Service dependency intelligence is a major new capability | ✓ Good |
| CSS pixel space as single coordinate truth | DPR is render-time only; no mouse/transform values multiplied by DPR | ✓ Good |
| Polling over SSE for log terminal | No zombie connection risk, 2s latency imperceptible for log viewer | ✓ Good |
| Named handlers for teardown | Module-scope named functions enable removeEventListener for project switching | ✓ Good |
| Shared logger factory with component tags | Enables log filtering without coupling modules to each other | ✓ Good |
| Graph dedup via MAX(id) GROUP BY name | Workaround for scan duplication — replaced by UNIQUE constraint in v2.2 | ✓ Good (resolved) |
| ON CONFLICT DO UPDATE over INSERT OR REPLACE | INSERT OR REPLACE cascade-deletes FK child rows; ON CONFLICT preserves row ID | ✓ Good |
| Scan version bracket (beginScan/endScan) | Atomic stale-row cleanup; failed scans leave old data intact | ✓ Good |
| Per-call resolveDb in MCP server | Module-level DB resolution was wrong for cross-project queries | ✓ Good |
| kind column on exposed_endpoints | Single table with discriminant vs separate tables per type — simpler queries, mismatch detection unchanged | ✓ Good |
| Embed exposes in /graph response | Single-load pattern avoids per-click API calls and async rendering complexity | ✓ Good |
| escapeHtml on scan-derived strings | Function signatures contain angle brackets that would be interpreted as HTML | ✓ Good |
| Infra guard first in getNodeType() | Before name heuristics — node named 'k8s-infra-lib' correctly returns 'infra' | ✓ Good |
| Custom grid layout over Dagre/ELK | Simple row-based layout per type layer; no external dependency needed for <100 nodes | ✓ Good |
| Separate actors table over extending services | Actors don't have repos, languages, or exposes — half the columns would be NULL | ✓ Good |
| node_metadata table for extensibility | Avoids migration bloat when future views (STRIDE, vulns, deployment) add data | ✓ Good |
| Outbound external actors from scan only | No config-based or inferred inbound actors — reduces hallucination risk | ✓ Good |
| Synthetic negative IDs for actor nodes | Avoids collision with service IDs in shared nodes array | ✓ Good |
| Services top, libraries middle, infra bottom | Infra is the foundation services run on — matches mental model | ✓ Good |
| Minimal top bar with collapsible filter panel | Keeps UI clean; all power behind one button | ✓ Good |
| Layered scanning approach | Core scan unchanged; future views get their own optional scan passes | ✓ Good |
| Boundary config in ligamen.config.json | User-defined grouping avoids hallucination from auto-inference | ✓ Good |
| Clean break rename (no backwards compat) | No dual-name confusion; simpler codebase; user chose no migration path | ✓ Good |
| Parallel phase execution for rename | All 7 phases independent for string replacement; 2-day turnaround | ✓ Good |
| Remove K8s commands (pulse, deploy-verify) | Kubernetes-specific, doesn't fit core focus on code quality and cross-repo intelligence | ✓ Good |
| Port drift logic to JS for MCP (not shell out) | Clean testability, matches existing queryChanged pattern, no env var conflicts | ✓ Good |
| Filesystem queries at call time (no new DB tables) | Drift data changes too frequently to persist; repos table has paths as anchors | ✓ Good |
| Marketplace structure with plugins/ligamen/ | Matches official Claude Code marketplace format; enables `claude plugin marketplace add` | ✓ Good |
| marketplace.json at repo root | Required for marketplace discovery; points to ./plugins/ligamen as plugin source | ✓ Good |
| Install into CLAUDE_PLUGIN_ROOT not CLAUDE_PLUGIN_DATA | ESM ignores NODE_PATH; directory-walk finds node_modules next to server.js | ✓ Good |
| Diff sentinel in CLAUDE_PLUGIN_DATA | Persists across plugin updates; double-check with node_modules existence | ✓ Good |
| Self-healing MCP wrapper over hook-only approach | Covers first-session race where MCP starts before SessionStart hook completes | ✓ Good |
| Separate install-deps.sh script (not inline in session-start.sh) | Clean separation; different timeout requirements (120s vs 10s) | ✓ Good |
| .mcp.json points to wrapper script not node directly | Enables self-healing path; wrapper handles dep check before exec | ✓ Good |
| Size-based log rotation over external logrotate | No external dependency; 10MB/3-file cap fits plugin use case | ✓ Good |
| TTY-aware stderr suppression | Daemon mode writes to file only; interactive mode keeps stderr for debugging | ✓ Good |
| Logger injection pattern for QueryEngine | Backwards-compatible optional arg; falls back to console.warn | ✓ Good |
| Three-value crossing semantics | external/cross-service/internal captures nuance that binary external/internal missed | ✓ Good |
| Post-scan reconciliation over prompt-only fix | Agents can't know what other repos contain; post-scan has full context | ✓ Good |
| Mono-repo detection via subdirectory manifests | Simple heuristic (one level deep) catches common layouts without recursive scan | ✓ Good |
| Merge cross-impact INTO impact (not just delete) — v0.1.1 | External review flagged `--exclude` and `--changed` as load-bearing features that would regress on hard delete; serialization guard runs merge before delete in same wave | ✓ Good |
| Deprecated stub for `/arcanon:upload` — v0.1.1 | Hard-remove would break hard-coded CI pipelines; one-release stub with stderr warning buys migration time | ✓ Good |
| Two-read config fallback (`auto-sync ?? auto-upload`) — v0.1.1 | Users with legacy `auto_upload: true` would silently lose auto-sync on upgrade; fallback + stderr warning prevents quiet breakage | ✓ Good |
| Pure-bash PreToolUse hook (no Node cold-start) — v0.1.1 | Node cold-start is 80-150ms alone; pure bash + curl + sqlite3 CLI keeps p99 <50ms on Linux | ⚠️ Revisit (macOS 130ms p99 — BSD fork overhead) |
| SessionStart banner enrichment (not /arcanon:status) — v0.1.1 | Claude needs ambient awareness; users forget to run status; banner is the always-on context channel | ✓ Good |
| Defer skills and agents to v0.2.0 — v0.1.1 | Ship hooks first; observe real firing behavior for a release; only then design skills that layer on top | ✓ Good |
| Zero-tolerance on Ligamen refs — v0.1.2 | No back-compat, no two-read fallbacks, no deprecation warnings. Back-compat stubs permanently encode the legacy name; just remove. Breaking change for v5.x users accepted. | ✓ Good |
| Rename ChromaDB `COLLECTION_NAME` — v0.1.2 | Existing collections orphaned on upgrade; users rebuild via `/arcanon:map`. Acceptable since ChromaDB is optional and rebuildable, and policy demands zero ligamen refs. | ✓ Good |
| Combined plan+execute for phases 102–105 — v0.1.2 | Scope well-understood after Phase 101 discovery; separate planner spawns would have been ceremony. Saved ~4 agent round-trips. | ✓ Good |
| Single credential triple in `~/.arcanon/config.json` — v0.1.5 | THE-1030 personal-credential model: one key serves all authorized orgs. Multi-cred map adds complexity for no value at single-machine/single-user scope. | ✓ Good (shipped — pending hub deploy validation) |
| Auto-default-org via `whoami` at login — v0.1.5 | Forcing user to type a UUID at `/arcanon:login` is hostile. Hub already knows which orgs the key is authorized for; plugin asks. | ✓ Good (shipped — pending hub deploy validation) |
| Mask `$HOME` at egress seams, not in DB — v0.1.5 | DB needs absolute paths for git operations; masking-at-egress preserves runtime correctness while closing the third-party leak (MCP → Anthropic). | ✓ Good |
| Single-seam logger masking (PII-04) — v0.1.5 | Single edit at `worker/lib/logger.js:66` between `Object.assign` and `JSON.stringify` covers all ~30 logger call sites. Stack frames inside `extra.stack` get masked because we mask all string values, not just keyed paths (M1 mitigation). | ✓ Good |
| CLI exit-code-7 + `__ARCANON_GRANT_PROMPT__` stdout sentinel — v0.1.5 | Markdown-layer ↔ Node-CLI re-entry pattern for multi-grant `AskUserQuestion`. cmdLogin can't call `AskUserQuestion` directly (process boundary); exit code + sentinel is a clean handshake. Reusable for any future CLI flow needing human-in-the-loop choice. | ✓ Good (pattern reusable) |
| Centralized 7-code RFC 7807 error map (AUTH-08) — v0.1.5 | `HUB_ERROR_CODE_MESSAGES` frozen in `client.js`; UI surfaces just print the message. New error codes added in one place. `body.title` fallback preserved for forward-compat with codes the plugin doesn't yet recognize. | ✓ Good |
| Nested `identity:` object in `--json` mode (D-125-03) — v0.1.5 | Additive contract: existing top-level keys (plugin_version, data_dir, config_file, etc.) unchanged; new structured data nests under one new key. Insulates existing JSON consumers from field-set churn. | ✓ Good |
| Hold marketplace publication until THE-1030 deploys — v0.1.5 | Codebase ships, but hub-half of product is non-functional until server enforces X-Org-Id + serves whoami. Shipping broken hub UX on first impression signals "don't trust this." Local-only features still work standalone — codebase tag is fine; public marketplace listing should wait. | Pending (deploy timing) |
| Migrate to `node:sqlite` behind an adapter — v0.1.8 | The runtime native-module install (`better-sqlite3`) raced Claude Code's ~30s MCP connection timeout on fresh installs. Node's built-in `DatabaseSync` removes the native compile/download entirely; a thin adapter isolates the swap. Node floor raised to >=22.13. | ✓ Good |
| Reasoning-based agent detection, not static allowlists — v0.1.9 | A hardcoded list of client libraries silently misses the next one (the #42/#45 anti-pattern). The LLM scanner reasons over open input; only the render/canonical vocabulary stays a closed set. Static lists remain correct for the Rust pattern engine, not the agent scanner. | ✓ Good |
| Canonical protocol vocabulary as single source of truth — v0.1.9 | One `worker/ui/modules/protocol.js` (`canonicalProtocol`) shared scan→persist→getGraph→UI, with persist+read-time normalization and fallback-not-reject. A divergent UI literal or reject-on-unknown was dropping real edges (NATS actor edge, pub/sub, DB). Unknown → `other`, never dropped. | ✓ Good |
| Structural Map key over string-join for method-aware matching — v0.1.9 | A `${method}${SEP}${path}` composite key is forgeable (a method literally containing the delimiter collides). The shipped `exposedByMethod` `Map<method,Set<path>>` is collision-free by construction. Caught by cross-AI (codex) round-2 review. | ✓ Good |
| Cross-AI (codex) review as a verification seam — v0.1.9 | A same-model plan-checker missed the #42 actor-edge gap, the #45 chromadb-incremental gap, and the #46 forgeable-key issue; an independent model caught all three. Findings captured per-phase in `*-REVIEWS.md`. | ✓ Good (pattern reusable) |
| Pre-push hook mirrors CI — v0.1.9 | PRs kept failing CI on bats then getting fixed reactively. `scripts/pre-push.sh` + `make hooks-install` runs the CI-equivalent suite before push, with OS-conditional HOK-06 latency headroom on Darwin. Root-cause prevention over reactive fixing. | ✓ Good |

---
*Last updated: 2026-06-29 — after v0.1.9 milestone close (Shadow Trio Removal, Rescan Repair & Scan/Mismatch Fixes shipped)*
