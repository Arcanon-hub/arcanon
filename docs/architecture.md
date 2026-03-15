# Architecture

## Project Structure

```
allclear/
  .claude-plugin/
    plugin.json              # plugin manifest
  commands/                  # user-invoked slash commands (auto-namespaced)
    quality-gate.md
    cross-impact.md
    drift.md
    pulse.md
    deploy-verify.md
    map.md
  skills/                    # auto-invoked contextual knowledge
    quality-gate/SKILL.md    # auto-invocable quality gate
    impact/SKILL.md          # impact recommendations
  hooks/
    hooks.json               # hook event bindings
  scripts/                   # hook implementations + worker lifecycle
    format.sh
    lint.sh
    file-guard.sh
    session-start.sh
    impact.sh                # legacy grep-based scanner
    worker-start.sh
    worker-stop.sh
    drift-versions.sh
    drift-types.sh
    drift-openapi.sh
    drift-common.sh
  lib/                       # shared bash libraries
    config.sh
    detect.sh
    linked-repos.sh
    worker-client.sh
  worker/                    # Node.js service dependency intelligence
    index.js                 # worker entry point
    db.js                    # SQLite lifecycle (WAL, migrations)
    db-pool.js               # per-project DB pool
    query-engine.js          # graph queries, impact classification
    http-server.js           # Fastify REST API
    mcp-server.js            # MCP stdio server (5 tools)
    scan-manager.js          # agent dispatch + incremental scanning
    agent-prompt.md          # scanning agent prompt template
    findings-schema.js       # findings validation
    repo-discovery.js        # repo discovery module
    confirmation-flow.js     # user confirmation UX
    chroma-sync.js           # optional ChromaDB sync
    migrations/
      001_initial_schema.js
      002_service_type.js
    ui/
      index.html             # D3 Canvas graph (zero build step)
      graph.js               # Canvas renderer + interactions
      force-worker.js        # off-thread force simulation
  tests/
    *.bats                   # bats tests (173+)
    integration/             # E2E tests
    storage/                 # query engine tests
```

## Commands vs Skills

- **`commands/`** — user types `/allclear:<name>`. Auto-namespaced with `(plugin:allclear)`.
- **`skills/`** — Claude auto-loads based on context. Not user-invoked.

## Worker Process

The worker is a Node.js background daemon that:
- Serves the graph UI on localhost
- Provides REST API for graph queries
- Is project-agnostic (resolves DB per-request via `?project=` or `?hash=`)
- Auto-restarts on version mismatch (same pattern as claude-mem)
- Auto-starts via session hook when `impact-map` config section exists

## MCP Server

Separate stdio process (not part of the worker). Reads SQLite directly. Provides 5 tools for any Claude agent to query the impact map.

## Storage

- **SQLite** with WAL mode — primary storage, always available
- **ChromaDB** (optional) — vector search enhancement
- **Fallback chain**: ChromaDB → FTS5 → direct SQL
