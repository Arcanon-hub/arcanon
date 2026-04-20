# Architecture

> **Audience:** Contributors to the Arcanon codebase. If you're a user looking to get started, see [Getting started](getting-started.md) and [Commands](commands.md).

## System Overview

```
┌─────────────────────────────────────────────────┐
│  Claude Code                                     │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │
│  │  Hooks    │  │ Commands │  │    Skills       │ │
│  │ format.sh │  │ map.md   │  │ impact/        │ │
│  │ lint.sh   │  │ drift.md │  │ ...            │ │
│  │ guard.sh  │  │ ...      │  │                │ │
│  └──────────┘  └──────────┘  └────────────────┘ │
└──────────────────┬──────────────────────────────┘
                   │ spawns/queries
    ┌──────────────┴──────────────┐
    │                              │
    ▼                              ▼
┌──────────┐              ┌──────────────┐
│  Worker   │              │  MCP Server   │
│  (Fastify)│              │  (stdio)      │
│  :37888   │              │  8 tools      │
│           │              │               │
│  /graph   │              │  impact_query │
│  /impact  │              │  drift_*      │
│  /scan    │              │  ...          │
│  /projects│              └───────┬──────┘
│  /api/logs│                      │
└─────┬─────┘                      │
      │                            │
      ▼                            ▼
┌──────────────────────────────────────┐
│  SQLite (per-project, WAL mode)      │
│                                       │
│  repos, services, connections,        │
│  schemas, fields, exposed_endpoints,  │
│  scan_versions, actors, node_metadata │
│                                       │
│  Optional: ChromaDB vector sync       │
└──────────────────────────────────────┘
```

## Plugin Structure

Arcanon is a Claude Code marketplace plugin. Repo root has `marketplace.json`; all source lives under `plugins/arcanon/`.

| Directory | Purpose |
|-----------|---------|
| `commands/` | User-invoked slash commands (`/arcanon:*`). Markdown prompts Claude follows. |
| `skills/` | Auto-invoked by Claude based on context triggers. Not user-invoked. |
| `hooks/` | Event bindings — PostToolUse (format/lint), PreToolUse (file guard), SessionStart (context). |
| `scripts/` | Shell implementations for hooks, drift checks, and worker lifecycle. |
| `lib/` | Shared bash libraries (config, detect, linked-repos, worker-client). |
| `worker/` | Node.js background daemon — DB, HTTP API, MCP server, scan agents, graph UI. |
| `worker/hub-sync/` | Optional Arcanon Hub upload client — payload transformer, Bearer auth, retry client, SQLite offline queue. Gated on `ARCANON_API_KEY` + `hub.auto-upload` config. |
| `worker/cli/` | Small Node CLIs dispatched by slash commands (`hub.js`, `export.js`, `drift-local.js`). |

## Worker Process

Background Node.js daemon started by `worker-start.sh`:

- Serves the graph UI on `localhost:37888`
- REST API for graph queries and scan persistence (9 endpoints)
- Project-agnostic — resolves per-project DB via `?project=` or `?hash=` query params
- Auto-restarts on version mismatch

## MCP Server

Separate stdio process (not part of the worker). Reads SQLite directly via per-call DB resolution. 8 tools:

- **Impact** (5): `impact_query`, `impact_changed`, `impact_graph`, `impact_search`, `impact_scan`
- **Drift** (3): `drift_versions`, `drift_types`, `drift_openapi`

Drift tools query the filesystem directly — repo paths from SQLite, actual files from disk.

## Hub sync (optional)

When `ARCANON_API_KEY` is set and `arcanon.config.json` has `hub.auto-upload: true`, `worker/scan/manager.js` calls `syncFindings()` after every successful `endScan()`. Findings are reconciled against the hub's `ScanPayloadV1` envelope (`payload.js`), POSTed with Bearer auth and exponential backoff (`client.js`), and on retriable failure enqueued to a SQLite queue at `<data-dir>/hub-queue.db` (`queue.js`) for later `/arcanon:sync` drain. A hub failure never fails a scan — findings are persisted locally first.

See [hub-integration.md](hub-integration.md) for the full endpoint contract.

## Storage

- **SQLite** with WAL mode — 8 migrations, per-project isolation via SHA256 path hashing under `~/.arcanon/projects/`
- **ChromaDB** (optional) — vector search with boundary/actor-enriched embeddings
- **Search fallback chain** (same for both worker and MCP): ChromaDB → FTS5 → SQL LIKE

## Graph UI

Vanilla JavaScript single-page app served by the worker. Canvas-based, no build step, no framework.

- **Layout**: Deterministic layered grid — services top, libraries middle, infra bottom, with boundary grouping
- **Node shapes**: Circles (services), outline diamonds (libraries), filled diamonds (infra), hexagons (actors)
- **Edge styles**: Solid (REST), dashed (gRPC), dotted (events), red (mismatch), bundled (parallel edges with count badge)
- **Keyboard shortcuts**: F (fit), Esc (deselect), / (search), I (isolate subgraph), 2/3 (expand depth)
- **Features**: Drag/pan/zoom, click-to-detail with clickable navigation, edge bundle expansion, "what changed" overlay, PNG export

## Scan Pipeline

Two-phase agent-based scanning:

1. **Discovery** (fast) — reads manifests and directory structure, returns language/framework hints
2. **Deep scan** (targeted) — reads source files guided by discovery, extracts services, connections, schemas

Type-specific prompts for services, libraries, and infrastructure. Scan bracket pattern (`beginScan`/`endScan`) ensures atomic stale-row cleanup — failed scans leave prior data intact.

## Hook Architecture

- **PostToolUse** — auto-format and auto-lint after file edits. Non-blocking (warn on failure, don't block).
- **PreToolUse** — file guard blocks writes to sensitive files.
- **SessionStart** — injects project context and optionally starts the worker daemon.
