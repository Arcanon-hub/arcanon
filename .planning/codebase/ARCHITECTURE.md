# Architecture

**Analysis Date:** 2026-04-24

## Pattern Overview

**Overall:** Claude Code plugin with a long-running local daemon and a sibling MCP server. The plugin ships as a single Node.js + Bash distribution that Claude Code loads from `plugins/arcanon/`. User intent is expressed through **slash commands**, **auto-invoked skills**, and **hooks** that shell out to project scripts.

**Key Characteristics:**
- **Plugin-first surface.** All user entry points are Claude Code primitives: slash commands (`commands/*.md`), skills (`skills/*/SKILL.md`), hooks (`hooks/hooks.json`). No CLI is exposed to end users directly.
- **Two long-running Node processes per session.**
  - `worker/index.js` — Fastify HTTP daemon on port 37888 (ARCANON_WORKER_PORT). Owns SQLite + ChromaDB. Started by `scripts/worker-start.sh`, lifecycle managed by `lib/worker-restart.sh`.
  - `worker/mcp/server.js` — MCP stdio server. Launched by `scripts/mcp-wrapper.sh` via `.mcp.json` registration. Self-healing on missing `node_modules`.
- **Project-agnostic worker, project-scoped data.** The worker is a single process that resolves the correct per-project SQLite DB per request using `?project=<absolute-path>` or `?hash=<12-char>` query params. DBs live at `$ARCANON_DATA_DIR/projects/<sha256(projectRoot)[:12]>/impact-map.db`.
- **Dual-entry scan pipeline.** Two-phase agent scan (discovery then deep scan) with parallel fan-out across linked repos, followed by a separate enrichment pass (CODEOWNERS, auth/DB extraction, dependency collection).
- **Bash-first hook layer.** Hooks are pure Bash with `jq`/`sqlite3` — they do NOT require the worker to run. When the worker is up, hooks prefer it (`worker_call` HTTP); when it's down, they fall back to direct SQLite read-only queries.
- **Three-tier search fallback.** ChromaDB (semantic) → FTS5 (lexical) → SQL `LIKE` (last-resort substring).
- **Offline-first hub sync.** Optional uploads to `api.arcanon.dev` go through an SQLite-backed queue; network failures enqueue, `/arcanon:sync` drains.

## Layers

**Plugin surface (Claude-facing):**
- Purpose: User-invoked slash commands, auto-invoked skills, Claude Code event hooks.
- Location: `plugins/arcanon/commands/`, `plugins/arcanon/skills/`, `plugins/arcanon/hooks/hooks.json`.
- Contains: Markdown slash-command specs, `SKILL.md` auto-invoke specs, `hooks.json` event registration.
- Depends on: Scripts layer (all commands/hooks shell out to `scripts/*.sh`).
- Used by: Claude Code runtime.

**Scripts layer (Bash orchestration):**
- Purpose: Deterministic Bash entry points invoked by commands and hooks. Handles session/worker lifecycle, pre-tool-use gating, format/lint, hub subcommand dispatch, self-update.
- Location: `plugins/arcanon/scripts/`.
- Contains: `session-start.sh`, `impact-hook.sh`, `file-guard.sh`, `worker-start.sh`, `worker-stop.sh`, `mcp-wrapper.sh`, `install-deps.sh`, `update.sh`, `hub.sh`, `format.sh`, `lint.sh`, `drift*.sh`, `impact.sh`.
- Depends on: `lib/*.sh` shared helpers; worker HTTP (optional); Node binaries in `worker/cli/`.
- Used by: `hooks/hooks.json` events; slash command bodies via `${CLAUDE_PLUGIN_ROOT}/scripts/...` invocations.

**Shared library layer (Bash):**
- Purpose: Reusable Bash helpers sourced by scripts. Project detection, config resolution, data-dir resolution, per-project DB path hashing, HTTP client to worker, worker lifecycle logic.
- Location: `plugins/arcanon/lib/`.
- Contains: `db-path.sh` (sha256 hash mirror of `worker/db/pool.js`), `data-dir.sh`, `config-path.sh`, `config.sh`, `detect.sh` (project type detection), `linked-repos.sh`, `worker-client.sh` (HTTP `worker_call`, `worker_running`), `worker-restart.sh` (stale-PID + version-mismatch logic).
- Depends on: `shasum`/`sha256sum`, `jq`, `curl`, `sqlite3` binaries.
- Used by: Everything under `plugins/arcanon/scripts/`.

**Worker daemon (Node.js):**
- Purpose: Long-running Fastify HTTP service. Owns SQLite pool, runs scans, exposes graph/impact/scan REST endpoints, serves UI static assets, optionally talks to ChromaDB.
- Location: `plugins/arcanon/worker/`.
- Contains: `index.js` (entrypoint), `server/http.js` (Fastify routes), `server/chroma.js` (ChromaDB init + sync), `db/` (SQLite pool + query engine + migrations), `scan/` (orchestration), `hub-sync/` (offline upload queue), `ui/` (static SPA), `cli/` (non-daemon entry points), `lib/` (Node utilities).
- Depends on: `better-sqlite3`, `fastify`, `@fastify/cors`, `@fastify/static`, `chromadb` (optional), `zod`, `picomatch`.
- Used by: Slash commands via HTTP; hooks via HTTP (with SQLite fallback); UI via HTTP + static.

**MCP server (Node.js stdio):**
- Purpose: Exposes 8 read-oriented tools to Claude through MCP stdio transport. Runs as a separate process per Claude session.
- Location: `plugins/arcanon/worker/mcp/server.js` (launched via `scripts/mcp-wrapper.sh`).
- Contains: Zod-validated tool schemas for `impact_query`, `impact_changed`, `impact_graph`, `impact_search`, `impact_scan`, `drift_versions`, `drift_types`, `drift_openapi`.
- Depends on: `@modelcontextprotocol/sdk`, shared `worker/db/` modules, shared `worker/server/chroma.js`.
- Used by: Claude's MCP client (registered via `.mcp.json`).

**Storage layer (SQLite + optional ChromaDB):**
- Purpose: Per-project durable impact map.
- Location: `plugins/arcanon/worker/db/` for code; `$ARCANON_DATA_DIR/projects/<hash>/impact-map.db` for data.
- Contains: `query-engine.js` (prepared statement cache, upsert helpers, transitive impact traversal, FTS5 search, scan-version brackets), `database.js` (open + migrations + pragmas), `pool.js` (per-project QueryEngine cache), `migrations/001...011_*.js`.
- Depends on: `better-sqlite3` (WAL, FTS5), optional ChromaDB collection `arcanon-impact`.
- Used by: HTTP server, MCP server, scan manager, hub-sync.

**Scan pipeline layer:**
- Purpose: Orchestrate two-phase agent scan with parallel fan-out across linked repos, parse findings, run enrichment passes, persist to SQLite under scan-version brackets.
- Location: `plugins/arcanon/worker/scan/`.
- Contains: `manager.js` (orchestrator, repo-type detection, agent runner injection, discovery+deep scan, enrichment coordinator, optional auto-hub-sync), `discovery.js` (Phase 1 language/framework/entry-point detection), `findings.js` (Zod-like validator of agent output), `enrichment.js` (enricher registry + runner), `codeowners.js`, `confirmation.js`, `enrichment/auth-db-extractor.js` (Java/C#/Ruby/Python heuristics), `enrichment/dep-collector.js` (7-ecosystem dependency harvester), `agent-prompt-*.md` templates, `agent-schema.json`.
- Depends on: Injected agent runner (Claude Task tool from MCP server or test mock), `git` binary, `hub-sync/` for auto-sync.
- Used by: `/arcanon:map` command, `/arcanon:impact changed` flow.

**Hub sync layer (optional):**
- Purpose: Upload scan payloads to `api.arcanon.dev`. Resilient to network failures via an SQLite-backed offline queue.
- Location: `plugins/arcanon/worker/hub-sync/`.
- Contains: `index.js` (public API: `syncFindings`, `drainQueue`, `hasCredentials`), `payload.js` (Payload v1.1 builder with library_deps feature flag), `client.js` (HubError classification for retriable vs 4xx), `auth.js` (credential resolution from `~/.arcanon/config.json`, plugin `userConfig.api_token`, env vars), `queue.js` (enqueue/drain/mark-dead rows in `upload_queue` table).
- Depends on: `fetch` (Node built-in), SQLite queue tables (in the same per-project DB as the scan data).
- Used by: `scan/manager.js` (auto-sync after scan when enabled), `cli/hub.js` (manual `/arcanon:upload`, `/arcanon:sync`), `/arcanon:login`, `/arcanon:status`.

**UI layer (static SPA):**
- Purpose: Browser-based interactive service graph. Served by the worker's Fastify static handler.
- Location: `plugins/arcanon/worker/ui/`.
- Contains: `index.html`, `graph.js`, `force-worker.js` (D3 force simulation in Web Worker), `modules/*.js` (renderer, interactions, layout, detail-panel, filter-panel, project-picker, log-terminal, state, a11y, keyboard, utils, export, graph-states), `styles/` (design tokens + theme), `assets/icon.svg`.
- Depends on: D3 force (CDN), worker HTTP (`/graph`, `/projects`, `/api/status`, `/api/logs`).
- Used by: End user browser pointed at `http://localhost:<worker_port>`.

## Data Flow

**Map build flow (`/arcanon:map`):**

1. User invokes `/arcanon:map` → Claude opens `plugins/arcanon/commands/map.md`, prints plan, asks for scope confirmation.
2. Command body calls `worker_running || bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh` → `lib/worker-client.sh` + `lib/worker-restart.sh` ensure a fresh worker on the resolved port.
3. Linked-repo discovery via `lib/linked-repos.sh` reads `arcanon.config.json` and returns one or more repo roots.
4. Claude (inside the command prompt) runs per-repo discovery (Phase 1) by invoking `scan/discovery.js`-equivalent agent prompt → returns language, framework, entry points.
5. Discovery JSON is injected into the deep scan prompt (`worker/scan/agent-prompt-service.md` / `agent-prompt-library.md` / `agent-prompt-infra.md` with `{{DISCOVERY_JSON}}` placeholder substituted by `worker/scan/manager.js`).
6. Parallel deep scans run across repos; each repo's agent output is parsed by `worker/scan/findings.js` → `validateFindings()` returns `{ valid, findings | error }`.
7. User confirms the scan summary (generated by `worker/scan/confirmation.js`).
8. `worker/db/query-engine.js`: `upsertRepo()` → `beginScan(repoId)` → `persistFindings(repoId, findings, commit, scanVersionId)` → `endScan(repoId, scanVersionId)`. Version brackets guarantee atomic stale-row cleanup on success; failure leaves the bracket open.
9. `worker/scan/enrichment.js` runs each registered enricher (`codeowners`, `auth-db`, `dep-collector`) in try/catch — failures are silenced and logged as `warn`.
10. `worker/scan/manager.js` writes findings to ChromaDB via fire-and-forget `server/chroma.js:syncFindings()` when `ARCANON_CHROMA_MODE` is set; outage never blocks.
11. If `hub.auto-sync` (or legacy `hub.auto-upload`) is enabled in `arcanon.config.json`, `hub-sync/index.js:syncFindings()` POSTs to `api.arcanon.dev`; retriable failures go to the offline queue.

**Edit-gate flow (PreToolUse Edit|Write):**

1. Claude Code fires PreToolUse hooks for Edit|Write|MultiEdit tools in order (`hooks/hooks.json`).
2. `scripts/file-guard.sh` runs first — blocks sensitive paths (secrets, `.env`, etc.) and exits 2 when a block is warranted, else exit 0.
3. `scripts/impact-hook.sh` runs second. Pure bash, no worker dependency:
   - **Self-exclusion** (HOK-07): any file inside `$CLAUDE_PLUGIN_ROOT` exits 0 silently.
   - **Tier 1** (~0 ms): basename match against `*.proto`, `openapi.{yaml,yml,json}`, `swagger.{yaml,yml,json}` → immediately emit `{"systemMessage": "Arcanon: schema file ... edited — cross-repo consumers may be impacted."}`.
   - **Tier 2** (~5–15 ms): walk up to project root (first of `arcanon.config.json`, `.arcanon/`, `.git/`). Resolve `$DATA_DIR/projects/<hash>/impact-map.db` via `lib/db-path.sh`. Prefix-match the edited file against `services.root_path` (JOINed to `repos.path` for absolute prefix) using `sqlite3 -readonly`; trailing-slash normalization prevents `auth-legacy` matching `auth`.
   - **Consumer query** (HOK-04): if worker is up (`worker_running`), `worker_call /impact?project=<uri>&change=<svc>`. Else fall back to direct `sqlite3` JOIN on `connections`.
   - **Staleness prefix** (HOK-08): when `$DB_PATH` mtime > 48 h, prepend `[stale map — scanned Nd ago]` to the message.
   - Emit `{"systemMessage": "Arcanon: <svc> has N consumer(s): a, b, c. Run /arcanon:impact for details."}` on stdout and exit 0. Never blocks (never exits 2).

**Hub sync flow (`/arcanon:sync`):**

1. User runs `/arcanon:sync` → `commands/sync.md` calls `scripts/hub.sh sync` → `node worker/cli/hub.js sync`.
2. `cli/hub.js` imports `hub-sync/index.js:drainQueue({ apiKey, hubUrl, limit })`.
3. `drainQueue()` reads due rows via `queue.js:listDueUploads(limit)` → for each row, POST to hub via `client.js:uploadScan()`.
4. On success, `deleteUpload(row.id)`. On retriable failure, `markUploadFailure()` increments attempt count with exponential backoff; after max attempts row is marked `dead`. Non-retriable (4xx validation) → `dead` immediately.
5. Returns `{ attempted, succeeded, failed, dead, stats }` which the CLI prints human-readable or JSON.

**Session-start flow (SessionStart / UserPromptSubmit):**

1. Claude Code fires both `install-deps.sh` and `session-start.sh` as configured in `hooks/hooks.json`.
2. `install-deps.sh`: diff `runtime-deps.json` against `$CLAUDE_PLUGIN_DATA/.arcanon-deps-installed.json`. If different (or `better-sqlite3` dir missing), `npm install --prefix $CLAUDE_PLUGIN_ROOT --omit=dev --no-fund --no-audit --package-lock=false`. Write sentinel on success; delete on failure to retry next session.
3. `session-start.sh`:
   - Version-mismatch check (runs on every UserPromptSubmit) — compares installed `package.json` version against running worker `/api/version`; restarts worker if different (`lib/worker-restart.sh:restart_worker_if_stale`).
   - Session dedup via `/tmp/arcanon_session_<SESSION_ID>.initialized` — subsequent UserPromptSubmit events short-circuit.
   - Auto-starts worker if `arcanon.config.json` has an `"impact-map"` block and worker is not running.
   - Builds `ENRICHMENT` suffix from direct `sqlite3` reads of the impact-map DB: `"N services mapped. K load-bearing files. Last scan: YYYY-MM-DD. Hub: <auto-sync on|manual|offline|unknown>."`. Age > 48 h gets `[stale map — last scanned Nd ago]` prefix; age > 168 h emits no enrichment.
   - Emits `{"hookSpecificOutput":{"hookEventName":"<EVENT>","additionalContext":"Arcanon active. Detected: <types>. Commands: /arcanon:map, /arcanon:drift, ... <ENRICHMENT>"}}` to stdout.

**Incremental scan flow (SREL-01 / THE-933):**

1. `worker/scan/manager.js:buildScanContext()` checks the last `scan_versions.commit_sha` for the repo and calls `getChangedFiles(repoPath, sinceCommit)`.
2. If `modified.length === 0`, skip agent invocation entirely and push `{ mode: "incremental-noop", findings: null }` to results — no `beginScan` call, no SQLite touch.
3. Otherwise, build an `INCREMENTAL_CONSTRAINT` block listing only the changed files and append it to the deep scan prompt before calling the injected `agentRunner`.

**State Management:**
- Worker state is kept in-memory via `db/pool.js:pool` (Map<projectRoot, QueryEngine>). Entries are lazy-loaded and cached for the process lifetime — there is no explicit eviction.
- MCP server state is per-invocation: `resolveDb(project)` looks up a QueryEngine by absolute path, 12-char hex hash, or repo name (case-insensitive), scanning all project DBs when necessary.
- Session lifecycle state lives in `$DATA_DIR/worker.pid`, `$DATA_DIR/worker.port`, `$DATA_DIR/settings.json`, `$DATA_DIR/logs/worker.log`, `$DATA_DIR/logs/impact-hook.jsonl` (debug only).

## Key Abstractions

**Slash command:**
- Purpose: Markdown-defined user command. Each file's YAML front-matter declares `description`, `allowed-tools`, `argument-hint`. The body is executed by Claude as instructions.
- Examples: `plugins/arcanon/commands/map.md`, `plugins/arcanon/commands/impact.md`, `plugins/arcanon/commands/drift.md`, `plugins/arcanon/commands/login.md`, `plugins/arcanon/commands/upload.md`, `plugins/arcanon/commands/sync.md`, `plugins/arcanon/commands/status.md`, `plugins/arcanon/commands/export.md`, `plugins/arcanon/commands/update.md`.
- Pattern: Thin plan + Bash dispatch into `scripts/*.sh` or `node worker/cli/*.js`. Business logic never inlined in the Markdown.

**Skill (auto-invoke knowledge):**
- Purpose: Contextual knowledge Claude pulls into scope when relevant. Each skill directory contains a `SKILL.md` with a YAML front-matter describing when it should auto-invoke.
- Example: `plugins/arcanon/skills/impact/SKILL.md`.

**Hook:**
- Purpose: Shell command registered against a Claude Code event (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`) with a matcher regex and a timeout.
- Registration: `plugins/arcanon/hooks/hooks.json`.
- Non-blocking contract: every Arcanon hook script uses `trap 'exit 0' ERR`, swallows stdin errors, and exits 0 by default. Only `file-guard.sh` can exit 2 (block).

**QueryEngine:**
- Purpose: Per-project read/write façade over better-sqlite3. Holds an `StmtCache(50)` LRU prepared statement cache for hot paths.
- Location: `plugins/arcanon/worker/db/query-engine.js`.
- Responsibilities: `upsertService`, `upsertRepo`, `persistFindings`, `beginScan`/`endScan` brackets, `getGraph`, `getImpact`, `getService`, `getVersions`, transitive impact BFS with cycle detection (max depth 7, 30 s timeout), FTS5 + `LIKE` fallback search, `enrichImpactResult`/`enrichSearchResult`/`enrichAffectedResult` (owner / auth / DB metadata merge).

**Agent runner (dependency injection):**
- Purpose: Decouples scan orchestration from Claude's Task tool so tests can inject mocks and the MCP server can inject the real invoker.
- Contract: `(prompt: string, repoPath: string) => Promise<string>`.
- Injection: `worker/scan/manager.js:setAgentRunner(fn)`. Called by `worker/mcp/server.js` at startup (production) and by test suites (mocks). Background subagents cannot access MCP tools, so runners always execute in the foreground.

**Enricher:**
- Purpose: Post-scan metadata contributor. Each enricher receives `{ serviceId, repoPath, repoAbsPath, language, entryFile, db, logger }` and returns `{ key: value, ... }`. Values are written to `node_metadata(service_id, view='enrichment', key, value)`.
- Registration: Module-level `registerEnricher(name, fn)` in `worker/scan/manager.js`.
- Registered enrichers: `"codeowners"` (from `codeowners.js`), `"auth-db"` (from `enrichment/auth-db-extractor.js`).
- Isolation: Each enricher runs in try/catch; errors are logged as `warn` and never abort the scan.

**Scan version bracket:**
- Purpose: Atomic staleness cleanup. Every successful `persistFindings` runs between `beginScan(repoId)` (increments `scan_versions` row) and `endScan(repoId, scanVersionId)` (deletes rows whose `last_seen_scan_id < current`).
- Invariant: On exception between them, the bracket stays open; stale rows are retained until the next successful scan. Never lose data on partial failure.

**Migration:**
- Purpose: Versioned schema evolution. Each file in `worker/db/migrations/` exports `version: number` and `up(db)`. Loaded at module init via top-level await in `worker/db/database.js`; applied in version order by `openDb(projectRoot)`.
- Current migrations (11): 001_initial_schema, 002_service_type, 003_exposed_endpoints, 004_dedup_constraints, 005_scan_versions, 006_dedup_repos, 007_expose_kind, 008_actors_metadata, 009_confidence_enrichment, 010_service_dependencies, 011_services_boundary_entry.

## Entry Points

**Worker daemon:**
- Location: `plugins/arcanon/worker/index.js`.
- Triggers: `scripts/worker-start.sh` spawns via `nohup node worker/index.js --port $PORT --data-dir $DATA_DIR &`.
- Responsibilities: parse `--port` / `--data-dir`, load `$DATA_DIR/settings.json`, create PID/port files, init structured logger, conditionally init ChromaDB (non-blocking), create HTTP server with per-request DB resolution, register SIGTERM/SIGINT/SIGHUP graceful shutdown.

**MCP server:**
- Location: `plugins/arcanon/worker/mcp/server.js`.
- Triggers: Claude Code spawns via `.mcp.json` → `scripts/mcp-wrapper.sh` → `exec node worker/mcp/server.js`. Wrapper self-heals a missing `node_modules/better-sqlite3` by running `npm install` inline.
- Responsibilities: Register 8 Zod-validated MCP tools on an `McpServer({ name: "arcanon-impact", version: "0.1.0" })`, connect to `StdioServerTransport`, keep the DB handle live for the session.

**Worker CLI (non-daemon):**
- Location: `plugins/arcanon/worker/cli/hub.js`, `plugins/arcanon/worker/cli/export.js`, `plugins/arcanon/worker/cli/drift-local.js`.
- Triggers: Invoked directly by slash commands via `node worker/cli/hub.js <subcommand>`.
- Responsibilities: One-shot Node processes for `login` / `upload` / `sync` / `status` / `version`, scan export, local drift checks — none of these require the daemon.

**Slash commands:**
- Location: `plugins/arcanon/commands/*.md`.
- Triggers: User types `/arcanon:<name>` in Claude.
- Responsibilities: Present a plan, invoke `scripts/*.sh` or `node worker/cli/*.js`, render results.

**Hook scripts:**
- Location: `plugins/arcanon/scripts/`.
- Triggers: Registered in `plugins/arcanon/hooks/hooks.json`. Claude Code pipes event JSON on stdin and interprets stdout/exit code per Claude Code's hook contract.
- Responsibilities (by event):
  - **SessionStart**: `install-deps.sh` → `session-start.sh` (with 120 s / 10 s timeouts).
  - **UserPromptSubmit**: `session-start.sh` (version-mismatch check every prompt, dedup guard short-circuits after first run).
  - **PreToolUse matcher=`Write|Edit|MultiEdit`**: `file-guard.sh` (block secrets) → `impact-hook.sh` (cross-repo consumer warning).
  - **PostToolUse matcher=`Write|Edit|MultiEdit`**: `format.sh` → `lint.sh` (non-blocking quality hooks).

## Error Handling

**Strategy:** Defense-in-depth via layered fallbacks. No hook ever blocks Claude unless the user's file would be dangerous (only `file-guard.sh` exits 2). Every other Arcanon error is logged and swallowed.

**Patterns:**
- **Bash scripts:** `set -euo pipefail` + `trap 'exit 0' ERR` at the top; every recoverable failure exits 0 silently. Errors that the user must see go to stderr via `>&2`.
- **Worker routes:** Every Fastify handler is wrapped in try/catch that routes errors through `httpLog('ERROR', ...)` and returns `500 { error: msg }`. Missing DB returns `503 { error: "No map data yet ... run /arcanon:map first" }`.
- **MCP tools:** Each handler returns `{ content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] }` on failure. Missing scan data returns `{ error: "no_scan_data", project, hint: "Run /arcanon:map first in that project" }` — a domain error, not a thrown exception.
- **Scan pipeline:** Each repo's scan and each enricher is isolated in try/catch; one failure never aborts the rest. Retry-once policy for transient agent errors in `worker/scan/manager.js:scanRepos`.
- **Hub sync:** Retriable `HubError` → enqueue and retry via `queue.js` backoff; non-retriable (e.g., 422 validation) → immediate `dead` row.
- **ChromaDB:** All writes are fire-and-forget — `syncFindings().catch(log)`. `chromaSearch` throws when unavailable, triggering FTS5 fallback; FTS5 failures fall through to SQL `LIKE`.
- **Scan bracket safety:** If `persistFindings` throws, `endScan` is deliberately skipped so the bracket stays open and stale rows are preserved until the next successful scan.

## Cross-Cutting Concerns

**Logging:**
- Worker/MCP: structured JSONL via `worker/lib/logger.js:createLogger({ dataDir, logLevel, component })`. Log lines land in `$DATA_DIR/logs/worker.log`. Log level controlled by `settings.json:ARCANON_LOG_LEVEL`.
- Log levels: `ERROR`, `WARN`, `INFO`, `DEBUG` (default `INFO`). Component tags include `worker`, `http`, `mcp`, `scan`.
- Scan manager receives logger via module-level injection: `setScanLogger(logger)`. Same for `setExtractorLogger`.
- UI polls `/api/logs?component=<name>&since=<iso>` for a filtered tail (last 500 lines).
- Hooks: debug-only JSONL trace at `$DATA_DIR/logs/impact-hook.jsonl` when `ARCANON_IMPACT_DEBUG=1`.

**Validation:**
- Agent output: `worker/scan/findings.js:parseAgentOutput` extracts the fenced JSON block and runs `validateFindings()` (zero-dep hand-rolled validator over the schema in `agent-schema.json`).
- MCP tool inputs: Zod schemas inline in each `server.tool(...)` registration. Defaults filled for `direction`, `transitive`, `depth`, `severity`, `full`, `limit`.
- HTTP inputs: Fastify 400 on missing `change` for `/impact`; 400 on missing `repo_path` or `findings` for `POST /scan`.

**Authentication:**
- Worker is localhost-only (`fastify.listen({ host: '127.0.0.1' })`). No per-request auth.
- Hub auth: Bearer token `arc_<...>` resolved in priority order by `worker/hub-sync/auth.js`: explicit `--api-key` → `ARCANON_API_KEY` env var → `~/.arcanon/config.json:api_key` → plugin `userConfig.api_token`. Key is `sensitive: true` in `plugin.json`.

**Project hashing (cross-language contract):**
- Every DB path resolves through `sha256(projectRoot).hex.slice(0, 12)`. Implementations that must stay in lockstep:
  - JS: `worker/db/pool.js:projectHashDir`, `worker/mcp/server.js:resolveDbPath`.
  - Bash: `lib/db-path.sh:resolve_project_db_hash` (uses `printf '%s'` — no trailing newline — to match Node's `crypto.createHash.update(string)`).
- Path: `$ARCANON_DATA_DIR/projects/<hash>/impact-map.db` where `$ARCANON_DATA_DIR` defaults to `$HOME/.arcanon`.

**Self-update / version safety:**
- `scripts/update.sh --check|--kill|--prune-cache|--verify` orchestrates plugin self-update.
- `--kill` honors `$DATA_DIR/scan.lock` (written by `scan/manager.js` during active scans) — refuses to kill mid-scan.
- `session-start.sh` and `worker-start.sh` both check `GET /api/version` against the installed `package.json` version and restart the worker on mismatch. This is the only hook logic that runs on every UserPromptSubmit (not deduped).

---

*Architecture analysis: 2026-04-24*
