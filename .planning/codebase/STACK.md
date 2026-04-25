# Technology Stack

**Analysis Date:** 2026-04-24
**Plugin version:** 0.1.2 (shipped 2026-04-24)
**Most recent milestones:** v0.1.1 (2026-04-23) hub-sync + impact-hook; v0.1.2 (2026-04-24) Node 25 ABI fix + `boundary_entry` migration 011

## Languages

**Primary:**
- **JavaScript (ES Modules, Node runtime)** — `"type": "module"` in `plugins/arcanon/package.json`. All worker, MCP server, scan pipeline, hub-sync, and migration code. Roughly 80+ `.js` files across `plugins/arcanon/worker/`.
- **Bash 4+** — All hooks and orchestration glue. 17 scripts in `plugins/arcanon/scripts/` and 8 sourceable libraries in `plugins/arcanon/lib/`.

**Secondary / embedded:**
- **Markdown** — Slash-command definitions in `plugins/arcanon/commands/*.md` (9 commands: drift, export, impact, login, map, status, sync, update, upload). Skills in `plugins/arcanon/skills/impact/SKILL.md`. Agent prompts in `plugins/arcanon/worker/scan/agent-prompt-*.md`.
- **JSON** — All manifests (`plugin.json`, `hooks.json`, `marketplace.json`, `agent-schema.json`, `package.json`, `runtime-deps.json`).
- **SQL** — Embedded in migration files `plugins/arcanon/worker/db/migrations/001_initial_schema.js` … `011_services_boundary_entry.js`. 11 migrations total.
- **HTML / CSS / client JS** — Graph UI in `plugins/arcanon/worker/ui/` (`index.html`, `graph.js`, `force-worker.js`, `modules/`, `styles/`). Served statically by Fastify.

## Runtime

**Environment:**
- **Node.js >= 20.0.0** — `engines.node` in `plugins/arcanon/package.json`. CI matrix runs **Node 20 and Node 22** (`.github/workflows/ci.yml` job `test-hub-sync`). Bats job uses Node 22.
- **Node 25** is explicitly supported as of v0.1.2 via the `better-sqlite3 ^12.9.0` bump (prebuilt Node ABI v141 binaries — see `plugins/arcanon/CHANGELOG.md` issue #18 Bug 1).
- **Bash 4+** — On macOS this requires Homebrew bash (system bash is 3.2).
- **SQLite** bundled via `better-sqlite3` native addon (no separate server process).

**Package Manager:**
- **npm** (with `package-lock.json`) — CI uses `npm ci --no-audit --no-fund` from `plugins/arcanon/` directory.
- Lockfile: `plugins/arcanon/package-lock.json` committed.
- **Two package.json files:**
  - `plugins/arcanon/package.json` — dev/test dependency manifest (checked into git).
  - `plugins/arcanon/runtime-deps.json` — reduced runtime-only manifest; `scripts/install-deps.sh` (SessionStart hook) runs `npm install --prefix "$CLAUDE_PLUGIN_ROOT" --omit=dev` against this when the plugin is first loaded.

## Frameworks

**Core HTTP:**
- **fastify** `^5.8.5` — Worker HTTP server in `plugins/arcanon/worker/server/http.js`. Default port `37888` (persisted to `~/.arcanon/worker.port`).
- **@fastify/cors** `^10.0.0` — CORS for localhost dev UI (allows `127.0.0.1:*` and `:5173`).
- **@fastify/static** `^9.1.1` in dev, `^8.0.0` in `runtime-deps.json` — Serves the graph UI bundle from `plugins/arcanon/worker/ui/`.

**MCP:**
- **@modelcontextprotocol/sdk** `^1.27.1` — `McpServer` + `StdioServerTransport` from `@modelcontextprotocol/sdk/server/mcp.js`. Entrypoint `plugins/arcanon/worker/mcp/server.js`. Registers **8 stdio tools** (5 impact + 3 drift).
- **zod** `^3.25.0` — Input schema for every MCP tool (used directly in `server.tool(name, { schema }, handler)`).

**Plugin framework:**
- **Claude Code plugin marketplace** — Declared via `.claude-plugin/marketplace.json` (root) and `plugins/arcanon/.claude-plugin/plugin.json` (plugin). Hooks registered in `plugins/arcanon/hooks/hooks.json`: `SessionStart`, `UserPromptSubmit`, `PreToolUse` (Write|Edit|MultiEdit), `PostToolUse` (Write|Edit|MultiEdit). Slash commands declared as frontmatter-headed markdown files under `plugins/arcanon/commands/`.

## Storage

**Primary — SQLite:**
- **better-sqlite3** `^12.9.0` — Synchronous SQLite driver, bundled with prebuilt binaries for Node ABI up to v141 (Node 25). Lifecycle in `plugins/arcanon/worker/db/database.js`.
- Enabled pragmas: `journal_mode = WAL` (see `worker/db/database.js` and re-applied in `worker/mcp/server.js`).
- **FTS5 virtual tables** (`connections_fts`, `services_fts`, `endpoints_fts`) created in migration 001 with triggers to keep them in sync — second-tier keyword search.
- **11 migrations** under `plugins/arcanon/worker/db/migrations/`: initial schema, service_type, exposed_endpoints, dedup_constraints, scan_versions, dedup_repos, expose_kind, actors_metadata, confidence_enrichment, service_dependencies, services_boundary_entry.
- **Per-project DB paths:** `~/.arcanon/projects/<sha256(projectRoot)[:12]>/impact-map.db`. Hashing ported to bash in `plugins/arcanon/lib/db-path.sh` so hooks can resolve the DB without shelling into Node.

**Optional — Vector search:**
- **chromadb** `^3.3.3` — Semantic search tier in `plugins/arcanon/worker/server/chroma.js`. Collection name `arcanon-impact` (renamed from `ligamen-impact` in v0.1.2 BREAKING). Enabled when `ARCANON_CHROMA_MODE=local` is set; module is imported lazily and a ChromaDB outage never blocks SQLite writes.
- **@chroma-core/default-embed** `^1.0.0` — Declared as an `optionalDependencies` entry so installs succeed if native deps fail.
- Three-tier search fallback in `querySearch()` (`worker/db/query-engine.js` ~line 441): ChromaDB -> FTS5 -> SQL `LIKE`.

**Other on-disk state under `~/.arcanon/`:**
- `projects/<hash>/impact-map.db` — per-project graph DB
- `projects/<hash>/scan-lock` — scan mutex
- `queue/` — offline hub-sync outbox (used by `worker/hub-sync/queue.js`)
- `logs/worker.log` — structured JSON log from `plugins/arcanon/worker/lib/logger.js`
- `settings.json` — runtime log level + feature flags
- `worker.port`, `worker.pid` — worker handshake files
- `.arcanon-deps-installed.json` in `CLAUDE_PLUGIN_DATA` — install sentinel

## Key Dependencies

**Critical (production):**
- `@modelcontextprotocol/sdk ^1.27.1` — Exposes the MCP server that Claude Code connects to.
- `better-sqlite3 ^12.9.0` — Entire persistence layer; floor bumped in v0.1.2 for Node 25 compat.
- `fastify ^5.8.5` — Worker HTTP surface (REST + UI + readiness).
- `chromadb ^3.3.3` — Optional semantic search; declared as a required dep but treated as optional at runtime.
- `zod ^3.25.0` — MCP tool input validation.
- `picomatch ^4.0.4` — CODEOWNERS glob matching in `plugins/arcanon/worker/scan/codeowners.js`. CJS-only, loaded via `createRequire`.

**Dev vs runtime split:**
- `@fastify/static` has a different version range between `package.json` (`^9.1.1`) and `runtime-deps.json` (`^8.0.0`) — intentional so dev tests use the current Fastify 5 line while the slim runtime uses the older, smaller tree.

## Configuration

**User configuration:**
- **Claude Code plugin `userConfig`** — Defined in `plugins/arcanon/.claude-plugin/plugin.json`: `api_token` (sensitive, `arc_...` bearer), `hub_url` (default `https://api.arcanon.dev`), `auto_sync` (boolean), `project_slug` (for org-scoped keys).
- **Per-repo config:** `arcanon.config.json` at the repo root (example at `plugins/arcanon/arcanon.config.json.example`). Config discovery via `plugins/arcanon/lib/config-path.sh` and `plugins/arcanon/worker/lib/config-path.js`. Legacy `ligamen.config.json` support was **removed** in v0.1.2 (BREAKING).

**Environment variables (all `ARCANON_*`):**
- `ARCANON_PROJECT_ROOT` — override the project root seen by the MCP server.
- `ARCANON_DB_PATH` — bypass per-project hashing and point the MCP server at a specific DB.
- `ARCANON_CHROMA_MODE` (`local` | empty) — enables the ChromaDB tier.
- `ARCANON_CHROMA_HOST`, `ARCANON_CHROMA_PORT` — ChromaDB network target.
- `ARCANON_API_KEY` — Hub bearer token (fallback path when `userConfig.api_token` is unset).
- `ARCANON_LOG_LEVEL` — logger threshold (also readable from `~/.arcanon/settings.json`).
- `ARCANON_DISABLE_HOOK=1` — escape hatch that silences the PreToolUse impact hook.
- `ARCANON_IMPACT_DEBUG=1` — emit JSONL trace from the impact hook.
- `IMPACT_HOOK_LATENCY_THRESHOLD` — bats benchmark ceiling (ms). `100` in CI, `50` locally (HOK-06).
- All legacy `LIGAMEN_*` env reads were **removed** in v0.1.2 (BREAKING).

**Claude Code injected variables:**
- `CLAUDE_PLUGIN_ROOT` — absolute path to the installed plugin.
- `CLAUDE_PLUGIN_DATA` — per-plugin state dir; used for the install sentinel.

## Build / Test Tools

**Build:**
- **GNU Make** — Top-level `Makefile` with targets: `test`, `lint`, `check`, `install`, `uninstall`, `dev`. `make install` wires the marketplace registration + `claude plugin install`.
- **`jq`** — Manifest validation in `make check` and CI.

**Test frameworks:**
- **Node test runner** (`node --test`) — All JS unit/integration tests. Runner configured through npm scripts in `plugins/arcanon/package.json`:
  - `test` — runs every `worker/**/*.test.js` (excluding `node_modules`).
  - `test:storage` — `worker/db/query-engine-*.test.js`.
  - `test:hub-sync` — `worker/hub-sync/**/*.test.js`.
  - `test:migrations` — `worker/db/migration-*.test.js` and `worker/db/migrations.test.js`.
  - 40+ `.test.js` files total across `worker/db/`, `worker/hub-sync/`, `worker/mcp/`, `worker/scan/`, `worker/server/`, `worker/cli/`.
- **bats-core** — End-to-end shell integration tests. Bundled as a git submodule at `tests/bats/` (run via `./tests/bats/bin/bats tests/*.bats`). 35+ `.bats` files in `tests/` covering hooks, commands surface, config, detect, drift dispatcher, file guard, format/lint, impact hook latency + merged features, install-deps, MCP launch/wrapper/server, session-start + enrichment, structure, update, worker index/lifecycle/restart.
- **Shared bats helpers:** `tests/test_helper.bash`, `tests/test_helper/`, `tests/helpers/`, plus fixture trees under `tests/fixtures/`, `tests/integration/`, `tests/storage/`, `tests/ui/`, `tests/worker/`.

**Linting / formatting:**
- **shellcheck** — Enforced in `make lint` and CI (`shell-lint` job). Severity is `error` in CI, full checks locally. Flags: `-x -e SC1091`. Covers `plugins/arcanon/scripts/*.sh` and `plugins/arcanon/lib/*.sh`.
- **`scripts/format.sh` + `scripts/lint.sh`** — PostToolUse hooks that auto-format/lint on every Write|Edit|MultiEdit. 10s timeout.
- No JS formatter/linter (eslint/prettier) is declared in `package.json`.

## CI / CD

**GitHub Actions** (`.github/workflows/ci.yml`) — four jobs on every push/PR to `main`:
1. `lint-manifests` — `jq empty` on every JSON manifest + asserts plugin/marketplace names equal `"arcanon"`.
2. `shell-lint` — installs shellcheck on `ubuntu-latest` and runs with `--severity=error`.
3. `test-hub-sync` — matrix `node: ['20', '22']`, runs `node --test worker/hub-sync/` after `npm ci`.
4. `test-bats` — Node 22, runs the full bats suite with `IMPACT_HOOK_LATENCY_THRESHOLD=100`.

All jobs use `actions/checkout@v4` with `submodules: recursive` (bats submodule).

## Platform Requirements

**Development (macOS / Linux):**
- Node >= 20 (Node 22 or 25 recommended; 25 requires v0.1.2+).
- npm (ships with Node).
- Bash >= 4 (Homebrew `bash` on macOS).
- `jq`, `shellcheck`, `git`.
- `claude` CLI (Claude Code) for `make install` / `make dev`.

**Production runtime (end-user machine running Claude Code):**
- Same Node and Bash floors. MCP runtime deps are installed automatically into `CLAUDE_PLUGIN_ROOT/node_modules/` by `scripts/install-deps.sh` the first time the plugin session starts (diff-based idempotency against `runtime-deps.json`).

**Not used:**
- No Docker / containerization for the plugin itself (bats upstream ships a Dockerfile but it is not part of Arcanon's runtime).
- No Python, Go, or Rust in the plugin code path. Language detection inside `worker/mcp/server.js` (`detectRepoLanguage`) and `drift-types.sh` *reads* ts/go/py/rs repos but only via regex extraction from JS/bash.
- No bundler / transpiler. Everything runs as plain ESM off disk.

---

*Stack analysis: 2026-04-24*
