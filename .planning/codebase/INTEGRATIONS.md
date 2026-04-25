# External Integrations

**Analysis Date:** 2026-04-24
**Plugin version:** 0.1.2
**Scope:** Arcanon is a Claude Code plugin. Its integrations are almost entirely local (SQLite, optional ChromaDB, `git`) plus one outbound SaaS target (Arcanon Hub).

## Claude Code Plugin Integration

This is the primary integration surface. Arcanon ships as a marketplace plugin that Claude Code loads from `plugins/arcanon/`.

**Manifest files:**
- `.claude-plugin/marketplace.json` — root marketplace manifest, pins plugin version `0.1.2`.
- `plugins/arcanon/.claude-plugin/plugin.json` — plugin metadata, license (AGPL-3.0-only), `userConfig` schema (api_token, hub_url, auto_sync, project_slug).
- `plugins/arcanon/hooks/hooks.json` — hook registration.

**Hooks (`plugins/arcanon/hooks/hooks.json`):**
- `SessionStart` — runs `scripts/install-deps.sh` (120s timeout; installs MCP runtime deps into `CLAUDE_PLUGIN_ROOT` on first use) then `scripts/session-start.sh` (10s; emits the ambient banner "N services mapped. K load-bearing files. Last scan: date. Hub: status").
- `UserPromptSubmit` — re-runs `scripts/session-start.sh` (10s) so the banner refreshes mid-session.
- `PreToolUse` (matcher `Write|Edit|MultiEdit`) — runs `scripts/file-guard.sh` then `scripts/impact-hook.sh` (each 10s). The impact hook surfaces a cross-repo consumer warning as `systemMessage` before a schema edit lands. Tier 1 classifies schema files (`*.proto`, `openapi.*`, `swagger.*`); Tier 2 does an SQLite `root_path` prefix match via worker HTTP with direct-SQLite fallback.
- `PostToolUse` (matcher `Write|Edit|MultiEdit`) — runs `scripts/format.sh` then `scripts/lint.sh` (each 10s) to auto-format/lint edits.

**Slash commands** (`plugins/arcanon/commands/*.md` — markdown with frontmatter):
- `/arcanon:map` — scan linked repos, build graph, open UI.
- `/arcanon:impact` — cross-repo impact query. `--exclude`, `--changed` flags; 3-state degradation (no worker -> grep; worker but no data -> prompt + grep; worker + data -> graph).
- `/arcanon:drift` — dispatch to drift-versions / drift-types / drift-openapi.
- `/arcanon:sync` — canonical upload+drain verb. `--drain`, `--repo`, `--dry-run`, `--force`.
- `/arcanon:upload` — deprecated stub forwarding to `/arcanon:sync` (scheduled for removal in v0.2.0).
- `/arcanon:status` — worker + hub status.
- `/arcanon:login` — stash Hub API key into userConfig.
- `/arcanon:export` — export the graph.
- `/arcanon:update` — self-update (`--check`, `--kill`, `--prune-cache`, `--verify`).

**Skills** (`plugins/arcanon/skills/`):
- `impact/SKILL.md` — single skill describing the impact workflow. Loaded by Claude Code's skill system.

**Agent prompts** (`plugins/arcanon/worker/scan/agent-prompt-*.md`) — shipped but invoked via a locally injected `agentRunner`, not via Claude Code's `Task` tool (see note in `worker/scan/manager.js`: "Background subagents cannot access MCP tools — Claude Code issue #13254").

## MCP Server

Stdio MCP server in `plugins/arcanon/worker/mcp/server.js`, launched via `plugins/arcanon/scripts/mcp-wrapper.sh`.

**8 tools registered** (all with `zod` input schemas):

*Impact tools (5):*
- `impact_scan` — trigger a fresh scan of linked repos (delegates to `worker/scan/manager.js:scanRepos`).
- `impact_query` — resolve a symbol/service to its cross-repo callers.
- `impact_changed` — show impact of `git diff`-detected changes.
- `impact_graph` — return the enriched service subgraph (nodes + edges) for a service root.
- `impact_search` — three-tier search over connections (ChromaDB -> FTS5 -> SQL LIKE).

*Drift tools (3):*
- `drift_versions` — package-version drift across linked repos.
- `drift_types` — structural type/struct/class shape drift across repos.
- `drift_openapi` — OpenAPI contract drift across repos.

**Database resolution:** `resolveDb(project)` in `worker/mcp/server.js` accepts an absolute path, 12-char sha256 hash, or bare repo name; falls back to `ARCANON_PROJECT_ROOT` / `cwd`. Absolute paths are sandboxed under `~/.arcanon/projects/`.

**Transport:** `StdioServerTransport` — Claude Code spawns the MCP server as a subprocess and talks JSON-RPC over stdio.

## Arcanon Hub (api.arcanon.dev)

The single outbound SaaS integration. Client lives in `plugins/arcanon/worker/hub-sync/`.

**Endpoints consumed:**
- `POST {hub_url}/api/v1/scans/upload` — upload a `ScanPayloadV1` envelope. Documented contract in `worker/hub-sync/client.js`.
  - `202` -> `{ scan_upload_id, status, latest_payload_version }` (success or idempotent hit).
  - `409` -> idempotent hit (treated as success).
  - `400` -> project not found.
  - `401` -> missing/invalid key (JWTs explicitly rejected; must be `arc_...` bearer).
  - `413` -> payload too large (< 10 MB enforced client-side in `payload.js:MAX_PAYLOAD_BYTES`).
  - `422` -> Pydantic validation failed server-side.
  - `429` -> rate limited; honors `Retry-After`.
  - `5xx` / network -> retry with exponential backoff.

**Client behaviour:**
- `RETRY_ATTEMPTS = 3`, `BASE_BACKOFFS_MS = [1000, 2000, 4000]`, `DEFAULT_TIMEOUT_MS = 30_000`.
- Offline queue at `~/.arcanon/queue/` drained by `worker/hub-sync/queue.js` and `/arcanon:sync --drain`.

**Payload format:**
- `worker/hub-sync/payload.js` emits `ScanPayloadV1` (`version: "1.0"` exact literal).
- `metadata.tool = "claude-code"` (from the `KNOWN_TOOLS` enum mirrored from the server's `scan_payload.py`).
- `metadata.repo_name`, `metadata.commit_sha` required; git metadata derived via `execFileSync("git", ...)` in `deriveGitMetadata()`.
- `metadata.project_slug` required only for org-scoped API keys (supplied via `userConfig.project_slug`).
- **Hub Payload v1.1** is behind a feature flag (additive fields on top of v1.0); default emitter remains v1.0.

**Authentication:**
- Bearer token `arc_...` from:
  1. `userConfig.api_token` (Claude Code plugin settings), OR
  2. `ARCANON_API_KEY` environment variable (fallback).
- Get a key at `https://app.arcanon.dev/settings/api-keys` (per plugin.json description).
- Auth logic in `worker/hub-sync/auth.js`.

**Auto-sync:**
- `userConfig.auto_sync` (renamed from legacy `auto_upload` in v0.1.1) — when `true`, every `/arcanon:map` uploads the current scan and drains the offline queue. Legacy key `auto_upload` is read via two-read fallback with a stderr deprecation warning.

**Hub status surfaced via:**
- `/arcanon:status` — worker + hub health.
- Session-start banner (`scripts/session-start.sh`) — emits `Hub: auto-sync on | manual | not configured`.

## Local Data Stores

**SQLite (primary, required):**
- One DB per project: `~/.arcanon/projects/<sha256(projectRoot)[:12]>/impact-map.db`.
- Opened via `better-sqlite3` with `journal_mode = WAL`.
- 11 migrations in `plugins/arcanon/worker/db/migrations/` apply idempotently via `IF NOT EXISTS`.
- FTS5 virtual tables (`connections_fts`, `services_fts`, `endpoints_fts`) for keyword search.
- No separate database server; entire store is a single file.

**ChromaDB (optional, opt-in):**
- Client: `chromadb ^3.3.3` in `plugins/arcanon/worker/server/chroma.js`.
- Collection: `arcanon-impact` (renamed from `ligamen-impact` in v0.1.2 BREAKING — legacy collections are orphaned).
- Activated only when `ARCANON_CHROMA_MODE=local`; `ARCANON_CHROMA_HOST`/`ARCANON_CHROMA_PORT` override the target.
- Availability determined once at startup via `heartbeat()`. Outage is non-fatal — `syncFindings()` is fire-and-forget and SQLite persistence is never blocked.
- Consumption pattern: `querySearch()` in `worker/db/query-engine.js` tries Chroma first, falls through to FTS5, then SQL `LIKE`.

**File storage:**
- All persistent state under `~/.arcanon/`. No cloud object store.

**Caching:**
- None beyond the SQLite DB and the runtime-deps install sentinel (`$CLAUDE_PLUGIN_DATA/.arcanon-deps-installed.json`).

## Git Integration

`git` is shelled out via `execFileSync("git", args, { cwd })` from Node:
- `worker/hub-sync/payload.js:gitSafe()` — `remote get-url origin`, `rev-parse --abbrev-ref HEAD`, `rev-parse HEAD` to derive repo URL, branch, commit SHA for hub payload metadata.
- `worker/scan/manager.js:getChangedFiles()` — `git diff` for incremental scan mode.
- `/arcanon:impact --changed` — reads `git diff` to auto-detect changed symbols.

Every git call is fail-safe: on non-zero exit or missing repo the helpers return `null` / `[]` rather than throwing.

## CODEOWNERS Integration

Ownership enrichment in `plugins/arcanon/worker/scan/codeowners.js`:
- Probes `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS` (GitHub spec order).
- Parses glob-pattern ownership rules.
- `picomatch ^4.0.4` performs last-match-wins matching. Loaded via `createRequire` because picomatch ships CJS only.
- Owners are stored into `node_metadata` on services (OWN-01).

Not an integration with GitHub's API — pure file parsing.

## Authentication

**Hub (outbound):** Bearer `arc_...` tokens (see Arcanon Hub section).

**Local worker HTTP server:** No authentication. Binds only to localhost; CORS whitelist limited to `http://localhost:5173`, `http://127.0.0.1:5173`, and `127.0.0.1:*` in dev.

**No OAuth, SSO, or third-party identity provider.**

## Monitoring / Observability

**Logs:**
- Structured JSON lines via `plugins/arcanon/worker/lib/logger.js`.
- Location: `~/.arcanon/logs/worker.log` (and per-component log levels via `ARCANON_LOG_LEVEL`).
- MCP server reads its log level from `~/.arcanon/settings.json` at startup (see `worker/mcp/server.js`).

**Error tracking:**
- No external error-tracker (Sentry / Rollbar / Datadog) integrated.

**Metrics:**
- Impact-hook latency benchmarked in bats (`tests/impact-hook-latency.sh`) with `IMPACT_HOOK_LATENCY_THRESHOLD` — `100` ms in CI, `50` ms locally. No metrics are exported at runtime.

## CI / Release

**CI:** GitHub Actions only (`.github/workflows/ci.yml`) — lint-manifests, shell-lint, test-hub-sync (Node 20/22), test-bats.

**Release / distribution:**
- Consumed via the Claude Code plugin marketplace (`claude plugin marketplace add <this-repo>` then `claude plugin install arcanon@arcanon`).
- Self-update path via `/arcanon:update` (version check against the marketplace, `--kill` gracefully stops the worker, `--verify` polls worker health).
- No npm publish, Docker registry, or GitHub Releases artifact pipeline currently wired.

## Webhooks / Callbacks

**Incoming:** None. The worker exposes a local-only REST API on `127.0.0.1:${port}` (default 37888) consumed by the built-in UI and by the plugin's own bash scripts (`lib/worker-client.sh`). Endpoints include `/api/readiness`, `/api/version`, and query-engine routes.

**Outgoing:**
- `POST {hub_url}/api/v1/scans/upload` — the only outbound HTTP call.

## Explicitly NOT Integrated

Per the plugin brief:
- **Issue trackers** (Linear, GitHub Issues, Jira) — not integrated. Ownership info comes from `CODEOWNERS`, not from an API.
- **Chat** (Slack, Discord, Teams) — not integrated.
- **Other SaaS APIs** — none. The plugin ships entirely offline-capable, with Arcanon Hub as the single opt-in SaaS endpoint.

## Required Environment Variables (summary)

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `ARCANON_API_KEY` | Hub bearer token fallback | Only if `userConfig.api_token` unset |
| `ARCANON_PROJECT_ROOT` | Override project root for MCP server | No |
| `ARCANON_DB_PATH` | Override per-project DB location | No |
| `ARCANON_CHROMA_MODE` | Enable ChromaDB tier (`local`) | No (default disabled) |
| `ARCANON_CHROMA_HOST`, `ARCANON_CHROMA_PORT` | ChromaDB target | No |
| `ARCANON_LOG_LEVEL` | Logger threshold | No |
| `ARCANON_DISABLE_HOOK` | Silence the PreToolUse impact hook | No (escape hatch) |
| `ARCANON_IMPACT_DEBUG` | Emit JSONL trace from impact hook | No |
| `IMPACT_HOOK_LATENCY_THRESHOLD` | bats latency ceiling (ms) | CI only |
| `CLAUDE_PLUGIN_ROOT` | Plugin install dir | Injected by Claude Code |
| `CLAUDE_PLUGIN_DATA` | Per-plugin state dir | Injected by Claude Code |

Legacy `LIGAMEN_*` env vars were **removed** in v0.1.2 (BREAKING). No fallback.

---

*Integration audit: 2026-04-24*
