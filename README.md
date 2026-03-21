# Ligamen

Quality gates, cross-repo impact analysis, and service dependency intelligence for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Ligamen is a Claude Code **plugin** that auto-formats, auto-lints, guards sensitive files, and maps service dependencies across your repositories — with an interactive layered graph UI.

## Installation

```bash
claude plugin marketplace add https://github.com/chilleregeravi/ligamen
claude plugin install ligamen@ligamen --scope user
```

This registers Ligamen globally — all your Claude Code sessions will have access to the hooks and commands.

**Update:**

```bash
claude plugin update ligamen@ligamen
```

**Uninstall:**

```bash
claude plugin uninstall ligamen@ligamen
```

### Contributing

See [Development](docs/development.md) for cloning the repo, running tests, and submitting changes.

## What It Does

**Runs automatically (hooks):**
- Auto-format on every edit (Python, Rust, TypeScript, Go)
- Auto-lint with issues surfaced to Claude
- Block writes to `.env`, lock files, credentials
- Session context with project type detection

**On-demand (commands):**
- `/ligamen:quality-gate` — lint, format, test, typecheck
- `/ligamen:map` — scan repos and build service dependency graph
- `/ligamen:cross-impact` — find what breaks when you change something
- `/ligamen:drift` — check dependency version alignment across repos

**Graph UI (http://localhost:37888):**
- Deterministic layered layout (services, libraries, infrastructure)
- Boundary grouping with labeled boxes
- External actor detection (hexagon nodes)
- Protocol-differentiated edges (solid/dashed/dotted)
- Collapsible filter panel (protocol, layer, boundary, language)
- Click-to-inspect detail panels per node type

## Configuration

Zero-config by default. Optional overrides:

### Project Config: `ligamen.config.json`

Lives in your project root. Committed to git.

```json
{
  "linked-repos": [
    "../api",
    "../auth",
    "../sdk"
  ],
  "boundaries": [
    {
      "name": "core",
      "label": "Core Services",
      "services": ["api-gateway", "auth-service", "user-service"]
    },
    {
      "name": "adapters",
      "label": "Protocol Adapters",
      "services": ["grpc-adapter", "mqtt-adapter"]
    }
  ]
}
```

| Key | Purpose |
|-----|---------|
| `linked-repos` | Explicit list of connected repos. Auto-discovered from parent dir if absent. |
| `boundaries` | Optional service grouping for the graph UI. Services are enclosed in labeled boxes. |

### Machine Settings: `~/.ligamen/settings.json`

Machine-specific settings. Never committed.

```json
{
  "LIGAMEN_WORKER_PORT": "37888",
  "LIGAMEN_LOG_LEVEL": "INFO"
}
```

### ChromaDB (optional)

Ligamen can sync service graph data to [ChromaDB](https://www.trychroma.com/) for semantic search. This is optional — without it, Ligamen falls back to SQLite FTS5 full-text search.

**1. Run ChromaDB locally:**

```bash
# Docker
docker run -p 8000:8000 chromadb/chroma

# Or pip
pip install chromadb
chroma run --host localhost --port 8000
```

**2. Enable in `~/.ligamen/settings.json`:**

```json
{
  "LIGAMEN_CHROMA_MODE": "local",
  "LIGAMEN_CHROMA_HOST": "localhost",
  "LIGAMEN_CHROMA_PORT": "8000"
}
```

**3. Re-scan your project:**

```
/ligamen:map
```

Findings are synced to ChromaDB automatically after each scan. MCP tools and `/ligamen:cross-impact` will use ChromaDB for semantic search when available.

**All ChromaDB settings:**

| Setting | Default | Description |
|---------|---------|-------------|
| `LIGAMEN_CHROMA_MODE` | _(empty)_ | Set to `"local"` to enable ChromaDB sync |
| `LIGAMEN_CHROMA_HOST` | `localhost` | ChromaDB server hostname |
| `LIGAMEN_CHROMA_PORT` | `8000` | ChromaDB server port |
| `LIGAMEN_CHROMA_SSL` | `false` | Enable HTTPS for ChromaDB connection |
| `LIGAMEN_CHROMA_API_KEY` | _(empty)_ | API key for authenticated ChromaDB instances |
| `LIGAMEN_CHROMA_TENANT` | `default_tenant` | ChromaDB tenant ID |
| `LIGAMEN_CHROMA_DATABASE` | `default_database` | ChromaDB database name |

### Environment Variables

| Variable | Effect |
|----------|--------|
| `LIGAMEN_DISABLE_FORMAT=1` | Skip auto-formatting |
| `LIGAMEN_DISABLE_LINT=1` | Skip auto-linting |
| `LIGAMEN_DISABLE_GUARD=1` | Skip file guard |
| `LIGAMEN_DISABLE_SESSION_START=1` | Skip session context |

## MCP Server

After building your first map, add the Ligamen MCP server so all Claude agents can check impact before making changes:

```json
{
  "mcpServers": {
    "ligamen-impact": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to-ligamen>/plugins/ligamen/worker/mcp/server.js"]
    }
  }
}
```

## Documentation

| Doc | Description |
|-----|-------------|
| [Hooks](docs/hooks.md) | Auto-format, auto-lint, file guard, session context |
| [Commands](docs/commands.md) | All slash commands with usage examples |
| [Service Map](docs/service-map.md) | Dependency graph scanning, storage, visualization |
| [Configuration](docs/configuration.md) | Config files, environment variables, settings |
| [Architecture](docs/architecture.md) | Project structure, worker process, MCP server |
| [Development](docs/development.md) | Testing, linting, contributing |

## License

Apache-2.0
