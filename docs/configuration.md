# Configuration

Arcanon works with zero configuration. All features auto-detect your project type, tools, and linked repos. You only need a config file if you want to customize behavior.

## Project Config: `arcanon.config.json`

Create this file in your project root and commit it to git. It tells Arcanon which repos to scan together and how to group your services.

```json
{
  "project-name": "my-project",
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
  ],
  "hub": {
    "auto-upload": false,
    "url": "https://api.arcanon.dev",
    "project-slug": "my-project"
  }
}
```

### Linked Repos

The `linked-repos` array tells Arcanon which repositories to include when scanning. Use relative paths from your project root.

If you don't set this, Arcanon auto-discovers repos by looking at sibling directories (other folders next to your project). This works well for typical multi-repo setups where all repos live under the same parent directory.

### Boundaries

Boundaries group services visually in the graph UI. Each boundary draws a labeled box around its member services.

- `name` — identifier used internally and in filter dropdowns
- `label` — display text shown on the boundary box in the graph
- `services` — array of service names (must match the names Arcanon discovers during scanning)

Services not assigned to any boundary appear ungrouped. A service can only belong to one boundary.

### Hub

Controls Arcanon Hub sync. All keys are optional.

| Key | Default | Purpose |
|---|---|---|
| `hub.auto-upload` | `false` | When `true` **and** an API key is set, `/arcanon:map` uploads after every scan. |
| `hub.url` | `https://api.arcanon.dev` | Override the hub endpoint (also overridable via `$ARCANON_HUB_URL`). |
| `hub.project-slug` | `project-name` | Project slug sent in `metadata.project_slug`. Required for org-scoped API keys. |

The API key itself is **not** stored in this file by design — it lives in `~/.arcanon/config.json` (mode `0600`) or `$ARCANON_API_KEY`. See [hub-integration.md](hub-integration.md) for credential precedence.

### Impact Map

After your first `/arcanon:map` scan, Arcanon adds an `impact-map` key to your config automatically. You don't need to set this yourself. Its presence tells Arcanon to auto-start the background worker when you open a Claude Code session.

## Disabling Features

Set these environment variables to turn off specific automatic behaviors. The `ARCANON_*` names are canonical; the `LIGAMEN_*` spellings are still honored for back-compat.

| Variable | Effect |
|----------|--------|
| `ARCANON_DISABLE_FORMAT=1` | Skip auto-formatting after edits |
| `ARCANON_DISABLE_LINT=1` | Skip auto-linting after edits |
| `ARCANON_DISABLE_GUARD=1` | Skip file guard (allows writes to sensitive files) |
| `ARCANON_DISABLE_SESSION_START=1` | Skip session context injection |
| `ARCANON_LINT_THROTTLE=<seconds>` | Throttle Rust clippy checks (default: 30s) |
| `ARCANON_EXTRA_BLOCKED=<patterns>` | Additional colon-separated glob patterns for file guard to block |

## Hub credentials (environment)

| Variable | Purpose |
|----------|--------|
| `ARCANON_API_KEY` | Bearer token for the hub (starts with `arc_`). Alias: `ARCANON_API_TOKEN`. |
| `ARCANON_HUB_URL` | Override the hub endpoint. |

## Advanced: Machine Settings

Machine-specific settings live in `~/.arcanon/settings.json`. This file is never committed to git — it's for local overrides only.

```json
{
  "ARCANON_WORKER_PORT": "37888",
  "ARCANON_WORKER_HOST": "127.0.0.1",
  "ARCANON_DATA_DIR": "/Users/you/.arcanon",
  "ARCANON_LOG_LEVEL": "INFO"
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `ARCANON_WORKER_PORT` | `37888` | Port for the background worker |
| `ARCANON_WORKER_HOST` | `127.0.0.1` | Worker bind address |
| `ARCANON_DATA_DIR` | `~/.arcanon` | Where Arcanon stores databases and logs (legacy `~/.ligamen` still read if present) |
| `ARCANON_LOG_LEVEL` | `INFO` | Log verbosity (`INFO` or `DEBUG`) |

## Advanced: ChromaDB (Semantic Search)

By default, Arcanon uses keyword-based search (SQLite full-text search) when you query your service graph. For smarter, semantic search — where a query like "what services handle payments" returns results even when "payments" doesn't appear literally — you can optionally connect ChromaDB.

### Setup

**1. Run ChromaDB:**

```bash
# Docker (recommended)
docker run -d -p 8000:8000 --name chromadb chromadb/chroma

# Or pip
pip install chromadb
chroma run --host localhost --port 8000
```

**2. Enable in `~/.arcanon/settings.json`:**

```json
{
  "ARCANON_CHROMA_MODE": "local",
  "ARCANON_CHROMA_HOST": "localhost",
  "ARCANON_CHROMA_PORT": "8000"
}
```

**3. Re-scan your project:**

```
/arcanon:map
```

After scanning, Arcanon syncs your service data to ChromaDB automatically. MCP queries and impact checks will use semantic search when available.

### ChromaDB Settings

Add these to `~/.arcanon/settings.json`:

| Setting | Default | Description |
|---------|---------|-------------|
| `ARCANON_CHROMA_MODE` | _(empty)_ | Set to `"local"` to enable ChromaDB |
| `ARCANON_CHROMA_HOST` | `localhost` | ChromaDB server hostname |
| `ARCANON_CHROMA_PORT` | `8000` | ChromaDB server port |
| `ARCANON_CHROMA_SSL` | `false` | Enable HTTPS for ChromaDB connection |
| `ARCANON_CHROMA_API_KEY` | _(empty)_ | API key for authenticated ChromaDB instances |
| `ARCANON_CHROMA_TENANT` | `default_tenant` | ChromaDB tenant ID |
| `ARCANON_CHROMA_DATABASE` | `default_database` | ChromaDB database name |

### What Gets Synced

Each service becomes a searchable document containing its name, type, language, connected services and protocols, boundary membership, and external actor relationships.

### Troubleshooting

- **ChromaDB not running:** Arcanon logs a warning and falls back to keyword search. No data is lost.
- **Connection refused:** Check that `ARCANON_CHROMA_HOST` and `ARCANON_CHROMA_PORT` match your ChromaDB instance.
- **Stale data:** Re-run `/arcanon:map` to resync. ChromaDB collections are replaced on each scan.
