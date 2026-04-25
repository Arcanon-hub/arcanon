# Codebase Structure

**Analysis Date:** 2026-04-24

## Directory Layout

```
ligamen/                                       # Repo root (ships as the plugin marketplace)
├── .claude-plugin/
│   └── marketplace.json                       # Marketplace manifest — enumerates plugins[]
├── plugins/
│   └── arcanon/                               # The plugin itself (a directory = an installable unit)
│       ├── .claude-plugin/
│       │   ├── plugin.json                    # Plugin manifest (name, version, userConfig)
│       │   ├── marketplace.json               # Mirrored marketplace entry
│       │   └── plugin.json                    # (alongside manifest)
│       ├── commands/                          # Slash commands — one .md per /arcanon:<name>
│       │   ├── map.md                         # /arcanon:map
│       │   ├── drift.md                       # /arcanon:drift
│       │   ├── impact.md                      # /arcanon:impact
│       │   ├── login.md                       # /arcanon:login
│       │   ├── upload.md                      # /arcanon:upload
│       │   ├── sync.md                        # /arcanon:sync
│       │   ├── status.md                      # /arcanon:status
│       │   ├── export.md                      # /arcanon:export
│       │   └── update.md                      # /arcanon:update
│       ├── skills/                            # Auto-invoked Claude skills
│       │   └── impact/
│       │       └── SKILL.md                   # Skill spec — YAML front-matter + guidance
│       ├── hooks/
│       │   └── hooks.json                     # Event → command registration
│       ├── scripts/                           # Bash implementations of hooks + orchestration
│       │   ├── session-start.sh               # SessionStart / UserPromptSubmit
│       │   ├── install-deps.sh                # SessionStart deps installer
│       │   ├── file-guard.sh                  # PreToolUse — block sensitive writes
│       │   ├── impact-hook.sh                 # PreToolUse — cross-repo consumer warning
│       │   ├── format.sh                      # PostToolUse — format files
│       │   ├── lint.sh                        # PostToolUse — lint files
│       │   ├── worker-start.sh                # Spawn worker daemon (nohup)
│       │   ├── worker-stop.sh                 # Stop worker (graceful + scan-lock guarded)
│       │   ├── mcp-wrapper.sh                 # MCP entry (self-heals deps, execs server.js)
│       │   ├── update.sh                      # /arcanon:update — check/kill/prune-cache/verify
│       │   ├── hub.sh                         # /arcanon:login/upload/sync/status dispatcher
│       │   ├── impact.sh                      # /arcanon:impact entry
│       │   ├── drift.sh                       # /arcanon:drift dispatcher
│       │   ├── drift-common.sh                # Shared drift helpers
│       │   ├── drift-openapi.sh               # OpenAPI drift subcommand
│       │   ├── drift-types.sh                 # Shared-types drift subcommand
│       │   └── drift-versions.sh              # Dependency-version drift subcommand
│       ├── lib/                               # Shared Bash libraries (sourced, never executed)
│       │   ├── db-path.sh                     # sha256 per-project hash (mirrors pool.js)
│       │   ├── data-dir.sh                    # resolve_arcanon_data_dir → $HOME/.arcanon
│       │   ├── config-path.sh                 # Locate arcanon.config.json
│       │   ├── config.sh                      # Config reader helpers
│       │   ├── detect.sh                      # Detect project types for session banner
│       │   ├── linked-repos.sh                # Parse linked-repos from arcanon.config.json
│       │   ├── worker-client.sh               # worker_call HTTP, worker_running, PID mgmt
│       │   └── worker-restart.sh              # Stale-PID + version-mismatch restart logic
│       ├── worker/                            # Node.js daemon + MCP + CLI + UI
│       │   ├── index.js                       # Daemon entrypoint (Fastify + SIGTERM handling)
│       │   ├── cli/                           # One-shot CLI entry points (non-daemon)
│       │   │   ├── hub.js                     # login / upload / sync / status / version
│       │   │   ├── export.js                  # Scan export
│       │   │   ├── drift-local.js             # Local drift runner
│       │   │   └── hub.test.js
│       │   ├── db/                            # SQLite pool + query engine + migrations
│       │   │   ├── database.js                # openDb() + runMigrations + pragmas
│       │   │   ├── pool.js                    # getQueryEngine(projectRoot) cache
│       │   │   ├── query-engine.js            # Upsert/query/search/bracket/traverse
│       │   │   ├── migrations/
│       │   │   │   ├── 001_initial_schema.js
│       │   │   │   ├── 002_service_type.js
│       │   │   │   ├── 003_exposed_endpoints.js
│       │   │   │   ├── 004_dedup_constraints.js
│       │   │   │   ├── 005_scan_versions.js
│       │   │   │   ├── 006_dedup_repos.js
│       │   │   │   ├── 007_expose_kind.js
│       │   │   │   ├── 008_actors_metadata.js
│       │   │   │   ├── 009_confidence_enrichment.js
│       │   │   │   ├── 010_service_dependencies.js
│       │   │   │   └── 011_services_boundary_entry.js
│       │   │   ├── database.test.js
│       │   │   ├── migrations.test.js
│       │   │   ├── migration-004.test.js      # Per-migration spot tests
│       │   │   ├── migration-008.test.js
│       │   │   ├── migration-010.test.js
│       │   │   ├── pool-repo.test.js
│       │   │   ├── pragma.test.js
│       │   │   ├── query-engine.dependencies.test.js
│       │   │   ├── query-engine-actors.test.js
│       │   │   ├── query-engine-bugfixes.test.js
│       │   │   ├── query-engine-confidence.test.js
│       │   │   ├── query-engine-enrich.test.js
│       │   │   ├── query-engine-graph.test.js
│       │   │   ├── query-engine-logger.test.js
│       │   │   ├── query-engine-mcp-enrichment.test.js
│       │   │   ├── query-engine-sanitize.test.js
│       │   │   ├── query-engine-search.test.js
│       │   │   ├── query-engine-upsert.test.js
│       │   │   └── snapshot.test.js
│       │   ├── hub-sync/                      # Arcanon Hub upload queue
│       │   │   ├── index.js                   # syncFindings, drainQueue (public API)
│       │   │   ├── payload.js                 # Payload v1.1 + library_deps flag
│       │   │   ├── client.js                  # HubError retriable classification
│       │   │   ├── auth.js                    # Credential resolution
│       │   │   ├── queue.js                   # SQLite-backed offline queue
│       │   │   └── *.test.js
│       │   ├── lib/                           # Shared worker utilities (Node)
│       │   │   ├── config-path.js             # Mirror of lib/config-path.sh
│       │   │   ├── data-dir.js                # Mirror of lib/data-dir.sh
│       │   │   └── logger.js                  # Structured JSONL logger factory
│       │   ├── mcp/                           # MCP stdio server
│       │   │   ├── server.js                  # 8 Zod-validated tools
│       │   │   └── server*.test.js
│       │   ├── scan/                          # Scan pipeline
│       │   │   ├── manager.js                 # Orchestrator — parallel fan-out + enrichment
│       │   │   ├── discovery.js               # Phase 1 — language/framework/entry-point
│       │   │   ├── findings.js                # Validator + fenced-JSON extractor
│       │   │   ├── enrichment.js              # Enricher registry + run harness
│       │   │   ├── codeowners.js              # CODEOWNERS enricher
│       │   │   ├── confirmation.js            # Scan-summary generator for /arcanon:map
│       │   │   ├── agent-prompt-common.md     # Shared agent-prompt header
│       │   │   ├── agent-prompt-discovery.md  # Phase 1 prompt template
│       │   │   ├── agent-prompt-service.md    # Phase 2 prompt (service repos)
│       │   │   ├── agent-prompt-library.md    # Phase 2 prompt (library repos)
│       │   │   ├── agent-prompt-infra.md      # Phase 2 prompt (infra repos)
│       │   │   ├── agent-schema.json          # JSON schema of expected agent output
│       │   │   ├── enrichment/
│       │   │   │   ├── auth-db-extractor.js   # Java/C#/Ruby/Python auth+DB heuristics
│       │   │   │   ├── dep-collector.js       # 7-ecosystem dep harvester
│       │   │   │   ├── fixtures/              # Language-specific test fixtures
│       │   │   │   │   ├── csharp*/
│       │   │   │   │   ├── java*/
│       │   │   │   │   └── ruby*/
│       │   │   │   └── *.test.js
│       │   │   └── *.test.js
│       │   ├── server/                        # Fastify + ChromaDB tier
│       │   │   ├── http.js                    # REST routes (/graph, /impact, /scan, ...)
│       │   │   ├── chroma.js                  # ChromaDB init + async sync + search
│       │   │   └── *.test.js
│       │   └── ui/                            # Static SPA served from /
│       │       ├── index.html
│       │       ├── graph.js                   # Graph bootstrap
│       │       ├── force-worker.js            # D3 force simulation Web Worker
│       │       ├── modules/
│       │       │   ├── renderer.js
│       │       │   ├── interactions.js
│       │       │   ├── layout.js
│       │       │   ├── detail-panel.js
│       │       │   ├── filter-panel.js
│       │       │   ├── graph-states.js
│       │       │   ├── project-picker.js
│       │       │   ├── project-switcher.js
│       │       │   ├── log-terminal.js
│       │       │   ├── state.js
│       │       │   ├── a11y.js
│       │       │   ├── keyboard.js
│       │       │   ├── export.js
│       │       │   ├── utils.js
│       │       │   └── *.test.js
│       │       ├── styles/
│       │       │   ├── tokens.css             # Design tokens (light/dark)
│       │       │   └── theme.js               # Theme initializer
│       │       └── assets/
│       │           └── icon.svg               # Arcanon hexagon logo
│       ├── package.json                       # Worker deps (better-sqlite3, fastify, chromadb, ...)
│       ├── runtime-deps.json                  # Narrower runtime-only manifest (install-deps.sh)
│       ├── package-lock.json
│       ├── arcanon.config.json.example        # Sample user config
│       ├── CHANGELOG.md                       # Plugin changelog (semver)
│       ├── LICENSE                            # AGPL-3.0-only
│       ├── README.md
│       └── tests/                             # (plugin-local legacy tests — most live at repo root)
├── tests/                                     # bats + integration + storage + UI tests
│   ├── *.bats                                 # Top-level bats cases (named by subsystem)
│   ├── bats/                                  # Vendored bats-core test runner
│   ├── test_helper/                           # bats-support + bats-assert
│   ├── helpers/                               # Shared bats helpers
│   ├── fixtures/                              # Config + drift + impact-hook fixtures
│   ├── integration/
│   │   └── impact-flow.bats                   # End-to-end scan → edit → warning
│   ├── storage/                               # Node --test for QueryEngine / migrations
│   │   └── *.test.js
│   ├── ui/                                    # Node --test for UI graph behavior
│   │   └── *.test.js
│   └── worker/                                # Node --test for worker lifecycle
│       ├── logger.test.js
│       └── scan-bracket.test.js
├── docs/                                      # User-facing documentation
│   ├── architecture-diagram.mermaid
│   ├── architecture.md
│   ├── commands.md
│   ├── configuration.md
│   ├── development.md
│   ├── getting-started.md
│   ├── hooks.md
│   └── hub-integration.md
├── .planning/                                 # GSD workflow artifacts (planning, retros, codebase maps)
│   ├── PROJECT.md
│   ├── ROADMAP.md
│   ├── STATE.md
│   ├── MILESTONES.md
│   ├── RETROSPECTIVE.md
│   ├── codebase/                              # This document lives here
│   ├── designs/
│   ├── milestones/
│   ├── phases/
│   ├── research/
│   └── config.json
├── assets/                                    # Marketing assets for README / hub
├── arcanon.config.json                        # Self-hosting config (ligamen indexes itself)
├── Makefile                                   # install/uninstall/test/lint/dev targets
├── README.md
├── LICENSE
├── CLAUDE.md                                  # Repo-specific Claude instructions
└── AGENTS.md                                  # Agent overview
```

## Directory Purposes

**`.claude-plugin/` (repo root):**
- Purpose: Registers this repository as a plugin marketplace. Claude Code loads `marketplace.json` when the user runs `claude plugin marketplace add <path>`.
- Contains: `marketplace.json` — `{ name, owner, plugins: [{ name, version, source, description }] }` where `source` points to `./plugins/arcanon`.
- Key files: `.claude-plugin/marketplace.json`.

**`plugins/arcanon/`:**
- Purpose: The actual plugin distribution. Claude Code copies this tree into its plugin cache when installed.
- Contains: plugin manifest, commands, skills, hooks, scripts, libraries, worker Node app, runtime dep manifests.
- Key files: `plugins/arcanon/.claude-plugin/plugin.json`, `plugins/arcanon/package.json`, `plugins/arcanon/runtime-deps.json`.

**`plugins/arcanon/.claude-plugin/`:**
- Purpose: Claude Code plugin manifest (required file at this exact path).
- Contains: `plugin.json` with `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, and `userConfig` (per-user settings exposed in Claude UI).
- `userConfig` keys: `api_token` (sensitive), `hub_url`, `auto_sync`, `project_slug`.

**`plugins/arcanon/commands/`:**
- Purpose: Slash command definitions. Each file maps to `/arcanon:<basename>`.
- Contains: Markdown files with YAML front-matter (`description`, `allowed-tools`, `argument-hint`) followed by instructions Claude executes.
- Pattern: Markdown body orchestrates via `bash ${CLAUDE_PLUGIN_ROOT}/scripts/*.sh` or `node ${CLAUDE_PLUGIN_ROOT}/worker/cli/*.js`. No business logic inlined.

**`plugins/arcanon/skills/`:**
- Purpose: Auto-invoked knowledge surfaces. Claude loads these when front-matter triggers match the user prompt.
- Contains: One subdirectory per skill, each with a `SKILL.md` file (and optional supporting docs).
- Example: `plugins/arcanon/skills/impact/SKILL.md`.

**`plugins/arcanon/hooks/`:**
- Purpose: Event registrations.
- Contains: `hooks.json` mapping `SessionStart`, `UserPromptSubmit`, `PreToolUse` (matcher=`Write|Edit|MultiEdit`), `PostToolUse` (same matcher) to `${CLAUDE_PLUGIN_ROOT}/scripts/*.sh` commands with per-hook timeouts.
- Key file: `plugins/arcanon/hooks/hooks.json`.

**`plugins/arcanon/scripts/`:**
- Purpose: Bash implementations of hooks and command-driven orchestration. Every script is executable, non-blocking, and localhost-only.
- Contains: hook scripts (`session-start.sh`, `install-deps.sh`, `file-guard.sh`, `impact-hook.sh`, `format.sh`, `lint.sh`); worker lifecycle (`worker-start.sh`, `worker-stop.sh`, `mcp-wrapper.sh`); command dispatchers (`hub.sh`, `impact.sh`, `drift*.sh`, `update.sh`).
- Key files: `plugins/arcanon/scripts/session-start.sh`, `plugins/arcanon/scripts/impact-hook.sh`, `plugins/arcanon/scripts/worker-start.sh`, `plugins/arcanon/scripts/update.sh`.

**`plugins/arcanon/lib/`:**
- Purpose: Reusable Bash libraries. Never executed directly — always `source`d by scripts.
- Contains: project/data-dir resolvers, per-project DB path hasher, worker HTTP client, worker lifecycle, project-type detection, linked-repo parser.
- Key files: `plugins/arcanon/lib/db-path.sh` (cross-language hash contract with `worker/db/pool.js`), `plugins/arcanon/lib/worker-client.sh`, `plugins/arcanon/lib/worker-restart.sh`.

**`plugins/arcanon/worker/`:**
- Purpose: All Node.js application code. Both daemon and MCP entry points live here.
- Contains: daemon entrypoint, HTTP server, DB layer, scan pipeline, hub sync, MCP server, UI, CLI, shared Node libs.
- Key files: `plugins/arcanon/worker/index.js`, `plugins/arcanon/worker/server/http.js`, `plugins/arcanon/worker/mcp/server.js`, `plugins/arcanon/worker/scan/manager.js`, `plugins/arcanon/worker/db/query-engine.js`.

**`plugins/arcanon/worker/cli/`:**
- Purpose: One-shot non-daemon Node entry points invoked by slash commands.
- Contains: `hub.js` (`login`/`upload`/`sync`/`status`/`version` subcommands), `export.js`, `drift-local.js`.
- Key files: `plugins/arcanon/worker/cli/hub.js`.

**`plugins/arcanon/worker/db/`:**
- Purpose: SQLite persistence layer.
- Contains: `database.js` (open + migrations + pragmas), `pool.js` (per-project QueryEngine cache), `query-engine.js` (read/write façade with prepared statement cache), `migrations/` (11 versioned `.js` files applied in order).
- Key files: `plugins/arcanon/worker/db/query-engine.js`, `plugins/arcanon/worker/db/pool.js`, `plugins/arcanon/worker/db/database.js`.

**`plugins/arcanon/worker/hub-sync/`:**
- Purpose: Optional synchronization with Arcanon Hub (api.arcanon.dev).
- Contains: `index.js` (public `syncFindings` / `drainQueue` / `hasCredentials`), `payload.js` (Payload v1.1 with `library_deps` feature flag), `client.js` (HubError classification), `auth.js` (credential resolution), `queue.js` (SQLite-backed offline queue).
- Key files: `plugins/arcanon/worker/hub-sync/index.js`.

**`plugins/arcanon/worker/lib/`:**
- Purpose: Node-side shared utilities. Mirror the Bash `lib/` helpers where cross-language contracts exist.
- Contains: `config-path.js` (locate `arcanon.config.json`), `data-dir.js` (resolve `$ARCANON_DATA_DIR`), `logger.js` (structured JSONL logger factory with component tags).

**`plugins/arcanon/worker/mcp/`:**
- Purpose: MCP stdio server that exposes tools to Claude.
- Contains: `server.js` with 8 tools (`impact_query`, `impact_changed`, `impact_graph`, `impact_search`, `impact_scan`, `drift_versions`, `drift_types`, `drift_openapi`) plus pure query functions (`queryImpact`, `queryChanged`, `queryGraph`, `querySearch`, `queryScan`, `queryDriftVersions`, `queryDriftTypes`, `queryDriftOpenapi`) exported for testing.
- Key file: `plugins/arcanon/worker/mcp/server.js`.

**`plugins/arcanon/worker/scan/`:**
- Purpose: Two-phase agent scan pipeline + enrichment.
- Contains: `manager.js` (entry: `scanRepos`, repo-type detection, parallel fan-out, retry-once, enrichment coordination, optional auto-hub-sync), `discovery.js`, `findings.js`, `enrichment.js` (registry), `codeowners.js`, `confirmation.js`, agent prompt templates (`agent-prompt-common.md`, `agent-prompt-discovery.md`, `agent-prompt-service.md`, `agent-prompt-library.md`, `agent-prompt-infra.md`), JSON schema (`agent-schema.json`), and `enrichment/` subdirectory for isolated enrichers (`auth-db-extractor.js`, `dep-collector.js`).
- Key files: `plugins/arcanon/worker/scan/manager.js`, `plugins/arcanon/worker/scan/findings.js`, `plugins/arcanon/worker/scan/enrichment.js`.

**`plugins/arcanon/worker/server/`:**
- Purpose: HTTP + ChromaDB tier.
- Contains: `http.js` (Fastify app, all REST routes), `chroma.js` (ChromaDB client, fire-and-forget sync, 3-tier fallback on search).
- Key files: `plugins/arcanon/worker/server/http.js`, `plugins/arcanon/worker/server/chroma.js`.

**`plugins/arcanon/worker/ui/`:**
- Purpose: Static single-page-app visualizer for the impact map, served by Fastify from `/`.
- Contains: `index.html`, `graph.js`, `force-worker.js` (D3 force sim in Web Worker), `modules/*.js` (renderer, interactions, layout, detail-panel, filter-panel, graph-states, project-picker/switcher, log-terminal, state, a11y, keyboard, utils, export), `styles/` (design tokens + theme), `assets/` (svg icon).

**`tests/`:**
- Purpose: Test suites.
- Contains:
  - Top-level `*.bats` cases (shell-level: `impact-hook.bats`, `session-start.bats`, `file-guard.bats`, `update.bats`, `worker-restart.bats`, etc.).
  - `bats/` — vendored `bats-core` runner.
  - `test_helper/` — `bats-support`, `bats-assert` dependencies.
  - `helpers/` — shared bash helpers.
  - `fixtures/` — sample configs, drift scenarios, hook inputs.
  - `integration/impact-flow.bats` — end-to-end.
  - `storage/*.test.js`, `ui/*.test.js`, `worker/*.test.js` — Node `--test` suites.

**`docs/`:**
- Purpose: User-facing Markdown documentation published with the repo.
- Contains: `getting-started.md`, `configuration.md`, `commands.md`, `hooks.md`, `hub-integration.md`, `architecture.md`, `architecture-diagram.mermaid`, `development.md`.

**`.planning/`:**
- Purpose: GSD (Getting Shit Done) workflow artifacts. Not shipped in the plugin distribution.
- Contains: `PROJECT.md`, `ROADMAP.md`, `STATE.md`, `MILESTONES.md`, `RETROSPECTIVE.md`, `config.json`, plus subdirectories `codebase/` (these analysis docs), `designs/`, `milestones/`, `phases/`, `research/`.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `.planning/codebase/STACK.md`, etc.

## Key File Locations

**Marketplace / plugin manifests:**
- `/.claude-plugin/marketplace.json` — repo-root marketplace entry.
- `plugins/arcanon/.claude-plugin/plugin.json` — plugin manifest (version 0.1.2).
- `plugins/arcanon/package.json` — Node dependencies for the plugin.
- `plugins/arcanon/runtime-deps.json` — minimal runtime dependency manifest for `install-deps.sh`.

**Entry points:**
- `plugins/arcanon/worker/index.js` — worker daemon entrypoint.
- `plugins/arcanon/worker/mcp/server.js` — MCP stdio server.
- `plugins/arcanon/worker/cli/hub.js` — hub CLI.
- `plugins/arcanon/worker/cli/export.js` — export CLI.
- `plugins/arcanon/worker/cli/drift-local.js` — local drift runner.
- `plugins/arcanon/scripts/worker-start.sh` — spawns the daemon.
- `plugins/arcanon/scripts/mcp-wrapper.sh` — MCP launcher (self-healing).

**Hook scripts (registered in `plugins/arcanon/hooks/hooks.json`):**
- `plugins/arcanon/scripts/session-start.sh` — SessionStart + UserPromptSubmit.
- `plugins/arcanon/scripts/install-deps.sh` — SessionStart dependency installer.
- `plugins/arcanon/scripts/file-guard.sh` — PreToolUse secret guard.
- `plugins/arcanon/scripts/impact-hook.sh` — PreToolUse cross-repo warning.
- `plugins/arcanon/scripts/format.sh` — PostToolUse formatter.
- `plugins/arcanon/scripts/lint.sh` — PostToolUse linter.

**Core logic:**
- `plugins/arcanon/worker/db/query-engine.js` — SQLite façade (upsert, persist, beginScan/endScan, getGraph, getImpact, transitive BFS, FTS5 search).
- `plugins/arcanon/worker/db/pool.js` — per-project QueryEngine cache + listProjects + getQueryEngineByHash/ByRepo.
- `plugins/arcanon/worker/db/database.js` — openDb + migration loader.
- `plugins/arcanon/worker/scan/manager.js` — scan orchestrator.
- `plugins/arcanon/worker/scan/findings.js` — agent output validator.
- `plugins/arcanon/worker/scan/enrichment.js` — enricher registry.
- `plugins/arcanon/worker/server/http.js` — REST routes.
- `plugins/arcanon/worker/server/chroma.js` — ChromaDB tier.
- `plugins/arcanon/worker/hub-sync/index.js` — hub sync entrypoint.
- `plugins/arcanon/worker/mcp/server.js` — 8 MCP tool definitions.

**Configuration:**
- `plugins/arcanon/arcanon.config.json.example` — sample project config (boundaries, linked-repos, hub block, impact-map block).
- `arcanon.config.json` (repo root) — self-hosting config so ligamen can map itself.
- `$ARCANON_DATA_DIR/settings.json` (default `$HOME/.arcanon/settings.json`) — per-machine overrides for `ARCANON_LOG_LEVEL`, `ARCANON_WORKER_PORT`, `ARCANON_CHROMA_MODE`, `ARCANON_CHROMA_HOST`, `ARCANON_CHROMA_PORT`, `ARCANON_CHROMA_SSL`.
- `$HOME/.arcanon/config.json` — hub credentials (written by `/arcanon:login`).

**Testing:**
- `Makefile` — `make test` runs `tests/*.bats`, `make lint` runs `shellcheck`, `make check` validates JSON manifests.
- `plugins/arcanon/package.json:scripts.test` — `node --test` across all `worker/**/*.test.js`.
- `tests/` — bats shell tests, `tests/storage/`, `tests/ui/`, `tests/worker/` — Node `--test` suites.

## Naming Conventions

**Files:**
- Bash scripts and libs: kebab-case with `.sh` extension → `impact-hook.sh`, `worker-restart.sh`.
- Node modules: kebab-case with `.js` extension → `query-engine.js`, `auth-db-extractor.js`.
- Tests: `<sibling>.test.js` next to the module (Node tests) or `<topic>.bats` at repo `tests/` root (shell tests). Per-migration tests use `migration-<NNN>.test.js`.
- Migrations: `<NNN>_snake_case_description.js` in `worker/db/migrations/` (e.g., `004_dedup_constraints.js`, `011_services_boundary_entry.js`). `NNN` is zero-padded.
- Slash commands: lowercase verb → `/arcanon:map` defined in `commands/map.md`.
- Skills: lowercase noun directory containing `SKILL.md` → `skills/impact/SKILL.md`.
- Agent prompts: `agent-prompt-<phase>.md` (`agent-prompt-common.md`, `agent-prompt-discovery.md`, `agent-prompt-service.md`, `agent-prompt-library.md`, `agent-prompt-infra.md`).

**Directories:**
- kebab-case under `worker/` → `hub-sync/`, no `worker/hubSync/` or `worker/HubSync/`.
- Singular nouns for cohesive domains → `scan/`, `db/`, `server/`, `mcp/`.

**Functions:**
- JS: camelCase → `buildScanContext`, `persistFindings`, `runEnrichmentPass`, `resolveDb`, `setAgentRunner`.
- Bash: snake_case with optional leading underscore for private helpers → `resolve_arcanon_data_dir`, `worker_running`, `_find_project_root`, `_query_consumers_via_worker`.

**Constants / enums:**
- JS: SCREAMING_SNAKE_CASE module-level constants → `COLLECTION_NAME`, `VALID_PROTOCOLS`, `VALID_CONFIDENCE`, `MAX_TRANSITIVE_DEPTH`, `QUERY_TIMEOUT_MS`.
- Bash: SCREAMING_SNAKE_CASE for env vars and read-only configuration → `CLAUDE_PLUGIN_ROOT`, `ARCANON_DATA_DIR`, `DATA_DIR`, `PID_FILE`, `PORT_FILE`, `SENTINEL`.

**Environment variables (user-facing):**
- All prefixed `ARCANON_` → `ARCANON_DATA_DIR`, `ARCANON_WORKER_PORT`, `ARCANON_LOG_LEVEL`, `ARCANON_CHROMA_MODE`, `ARCANON_API_KEY`, `ARCANON_DISABLE_HOOK`, `ARCANON_IMPACT_DEBUG`, `ARCANON_DISABLE_SESSION_START`, `ARCANON_PROJECT_ROOT`, `ARCANON_DB_PATH`.

**HTTP routes:**
- `/api/<noun>` for meta endpoints → `/api/readiness`, `/api/version`, `/api/status`, `/api/logs`.
- Bare nouns for data endpoints → `/graph`, `/impact`, `/service/:name`, `/versions`, `/projects`, `/scan` (POST).

## Where to Add New Code

**New slash command (`/arcanon:<name>`):**
- Create `plugins/arcanon/commands/<name>.md` with YAML front-matter (`description`, `allowed-tools`, `argument-hint`).
- Add a dispatcher script in `plugins/arcanon/scripts/<name>.sh` if the command needs any Bash logic. Invoke it from the Markdown body via `bash ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.sh`.
- For Node-side logic, add a subcommand to `worker/cli/hub.js` (for hub flows) or create a new CLI entry under `worker/cli/`.
- Update `session-start.sh` banner (`Commands:` list) if the command should be advertised.

**New hook:**
- Register in `plugins/arcanon/hooks/hooks.json` with matcher + timeout.
- Implement `plugins/arcanon/scripts/<name>.sh`. Always start with `set -euo pipefail` and `trap 'exit 0' ERR`. Never exit non-zero unless you're `file-guard.sh` blocking a sensitive path.
- Add bats coverage at `tests/<name>.bats`.

**New MCP tool:**
- Add to `plugins/arcanon/worker/mcp/server.js` after the existing `server.tool(...)` blocks.
- Use Zod schema inline (lowercase key names, camelCase for compound names, defaults where reasonable).
- Export a pure `queryX` function alongside so tests can hit it without starting the MCP transport.
- Update `plugins/arcanon/worker/mcp/server.test.js` and `server-*.test.js` with coverage.

**New HTTP route:**
- Add to `plugins/arcanon/worker/server/http.js` under the appropriate section. Always resolve the QueryEngine via `getQE(request)` and emit 503 when null.
- Wrap in try/catch, route errors through `httpLog('ERROR', ...)`, return `500 { error: msg }`.
- Add a matching route test in `plugins/arcanon/worker/server/http.test.js`.

**New schema change:**
- Add `plugins/arcanon/worker/db/migrations/<NNN>_<description>.js` exporting `version: <NNN>` and `up(db)`.
- Add a spot test `plugins/arcanon/worker/db/migration-<NNN>.test.js`.
- Update `plugins/arcanon/worker/db/migrations.test.js` if the migration set ordering is asserted.

**New enricher:**
- Implement under `plugins/arcanon/worker/scan/enrichment/<name>.js`. Export a function matching `(ctx) => Promise<Record<string, string|null>>`.
- Register at module load in `plugins/arcanon/worker/scan/manager.js` via `registerEnricher("<name>", fn)`.
- Keep it isolated — never throw out; the harness swallows errors but emits warnings.

**New scan language / framework:**
- Update `plugins/arcanon/worker/scan/discovery.js` detection.
- Add heuristics to `plugins/arcanon/worker/scan/manager.js:detectRepoType` if the language has a service/library/infra distinction.
- Extend `plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js` for language-specific extractors with a paired fixture under `enrichment/fixtures/<lang>-*/`.

**New UI module:**
- Add to `plugins/arcanon/worker/ui/modules/<name>.js`. Import from `graph.js` or another module.
- Pair with `<name>.test.js` in the same directory. Follow the existing `renderer.js` / `detail-panel.js` layout-mode patterns.
- Use CSS custom properties from `plugins/arcanon/worker/ui/styles/tokens.css`.

**Shared Bash helper:**
- Add a function to an existing `plugins/arcanon/lib/*.sh` when it fits an existing domain (data-dir, worker lifecycle, detection).
- For a new domain, create `plugins/arcanon/lib/<domain>.sh`. Script must self-guard with `[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file..."; exit 1; }` so callers cannot `bash` it by mistake.
- Add bats coverage in `tests/<domain>.bats`.

**New user config (per-user setting):**
- Add to `userConfig` block in `plugins/arcanon/.claude-plugin/plugin.json` with `title`, `type`, `description`, `required`, `sensitive` as appropriate.
- Read the value from within Node with `process.env.CLAUDE_PLUGIN_USER_CONFIG_<key>` or via `userConfig` in the plugin harness.

## Special Directories

**`$ARCANON_DATA_DIR` (default `$HOME/.arcanon/`):**
- Purpose: Per-machine plugin state. NOT inside the repo.
- Generated: Yes (by `install-deps.sh`, `worker-start.sh`, scan runs).
- Committed: No.
- Key paths:
  - `worker.pid`, `worker.port` — daemon lifecycle mutex.
  - `settings.json` — log level, port, ChromaDB config.
  - `config.json` — hub credentials (written by `/arcanon:login`).
  - `logs/worker.log` — structured JSONL logs.
  - `logs/impact-hook.jsonl` — hook debug trace (only when `ARCANON_IMPACT_DEBUG=1`).
  - `projects/<sha256(cwd)[:12]>/impact-map.db` — per-project SQLite impact map.
  - `scan.lock` — written by scan manager; honored by `update.sh --kill`.

**`$CLAUDE_PLUGIN_DATA/.arcanon-deps-installed.json`:**
- Purpose: Sentinel for diff-based dep install idempotency.
- Generated: Yes (by `install-deps.sh`).
- Committed: No.

**`plugins/arcanon/node_modules/`:**
- Purpose: Runtime Node deps installed via `install-deps.sh` or `mcp-wrapper.sh` self-heal.
- Generated: Yes.
- Committed: No — `.gitignore` excludes it.

**`tests/bats/`:**
- Purpose: Vendored `bats-core` test framework.
- Generated: No — committed as a git subtree / copy.
- Committed: Yes.

**`.planning/`:**
- Purpose: GSD workflow artifacts — plans, retros, roadmap, phase notes, codebase maps.
- Generated: Partly (codebase/ maps generated by `/gsd-map-codebase`).
- Committed: Yes.

**`docs/` vs `plugins/arcanon/README.md`:**
- `docs/` — long-form user documentation for the repo's GitHub Pages / hub site.
- `plugins/arcanon/README.md` — inline README shown inside Claude when the plugin is viewed.
- `README.md` (repo root) — project landing page.

---

*Structure analysis: 2026-04-24*
