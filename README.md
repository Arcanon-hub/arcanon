# AllClear

Auto-format, auto-lint, file guard, cross-repo quality gates, and **service dependency intelligence** for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

AllClear is a Claude Code **plugin** that runs automatically in the background — formatting files after edits, linting on save, blocking writes to sensitive files — and provides commands for cross-repo impact analysis, dependency drift detection, service health checking, and deployment verification.

**v2.0** adds a service dependency graph: scan linked repos with Claude agents, store the dependency map in SQLite, query impact transitively, and visualize the graph in an interactive D3 web UI.

## Installation

**Prerequisites:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed. Node.js v20+ for v2.0 worker features.

### From source

```bash
git clone https://github.com/chilleregeravi/allclear.git
cd allclear
git submodule update --init --recursive
npm install   # v2.0 worker dependencies (better-sqlite3, fastify, etc.)
```

Register as a local marketplace and install:

```bash
make install
```

### Quick test (no install)

```bash
claude --plugin-dir /path/to/allclear
```

### Verify installation

Start a new Claude Code session. You should see "AllClear active" in the session context. Run `/help` to see available commands.

## What happens automatically

Once installed, AllClear hooks run in the background with zero configuration.

### Auto-format (PostToolUse)

Every time Claude writes or edits a file, AllClear runs the appropriate formatter:

| Extension | Formatter |
|-----------|-----------|
| `.py` | `ruff format` or `black` |
| `.rs` | `rustfmt` |
| `.ts` `.tsx` `.js` `.jsx` | `prettier` or `eslint --fix` |
| `.go` | `gofmt` |
| `.json` `.yaml` `.yml` | `prettier` |

If a formatter isn't found, the hook silently skips. If it crashes, it exits cleanly — never blocks Claude.

### Auto-lint (PostToolUse)

After every write/edit, AllClear runs your linter and surfaces issues as a system message:

| Language | Linter |
|----------|--------|
| Python | `ruff check` |
| Rust | `cargo clippy` (throttled to once per 30s) |
| TypeScript/JavaScript | `eslint` |
| Go | `golangci-lint` |

### File guard (PreToolUse)

Blocks writes to sensitive files:

- **Hard block:** `.env`, `*.pem`, `*.key`, `*credentials*`, `*secret*`, lock files, `node_modules/`, `.venv/`, `target/`
- **Soft warn:** migration files, generated code (`*.pb.go`, `*_generated.*`), `CHANGELOG.md`

### Session context (SessionStart)

Detects your project type, lists available commands, and auto-starts the dependency map worker (if configured).

## Commands

Commands are invoked as `/allclear:<command-name>`.

### `/allclear:quality-gate` — Quality checks

```
/allclear:quality-gate              # run all checks (lint, format, test, typecheck)
/allclear:quality-gate lint         # lint only
/allclear:quality-gate format       # format check (dry-run)
/allclear:quality-gate test         # tests only
/allclear:quality-gate quick        # lint + format (fast)
/allclear:quality-gate fix          # auto-fix lint and format
```

### `/allclear:map` — Service dependency map (v2.0)

Build an interactive service dependency graph by scanning linked repos with Claude agents.

```
/allclear:map              # discover repos → scan → confirm → persist → open graph UI
/allclear:map --view       # open graph UI without scanning
/allclear:map --full       # force full re-scan (ignore incremental)
```

The map flow:
1. Discovers repos from `allclear.config.json` + parent directory + memory
2. Presents repo list for confirmation
3. Spawns Claude agents to analyze each repo (any language, no external tools)
4. Presents findings for user confirmation (high-confidence batch + low-confidence questions)
5. Persists to SQLite, opens interactive D3 graph UI

### `/allclear:cross-impact` — Impact analysis

When a dependency map exists, queries the service graph for transitive impact with CRITICAL/WARN/INFO severity. Falls back to grep-based symbol scanning when no map is available.

```
/allclear:cross-impact                    # auto-detect changes from git diff
/allclear:cross-impact UserService        # query impact for a specific symbol
/allclear:cross-impact --exclude legacy   # exclude a repo
```

### `/allclear:drift` — Dependency and type drift

```
/allclear:drift                # run all drift checks
/allclear:drift versions       # dependency version alignment
/allclear:drift types          # type/interface/struct consistency
/allclear:drift openapi        # OpenAPI spec alignment
```

### `/allclear:pulse` — Service health

```
/allclear:pulse                     # all deployments in current context
/allclear:pulse staging api         # specific service in staging
```

Requires `kubectl` configured with cluster access.

### `/allclear:deploy-verify` — Deploy verification

```
/allclear:deploy-verify                    # check production
/allclear:deploy-verify staging --diff     # staging with full diff
```

Requires `kubectl` with read permissions.

## Configuration

AllClear works with zero configuration. All features auto-detect project types and tools.

### `allclear.config.json` (project root)

```json
{
  "linked-repos": [
    "../api",
    "../auth",
    "../sdk"
  ],
  "impact-map": {
    "history": true
  }
}
```

- `linked-repos` — explicit list of connected repos (auto-discovered from parent dir if absent)
- `impact-map` — created automatically after first `/allclear:map`. Presence triggers worker auto-start on session open.

### `~/.allclear/settings.json` (machine-level)

```json
{
  "ALLCLEAR_WORKER_PORT": "37888",
  "ALLCLEAR_WORKER_HOST": "127.0.0.1",
  "ALLCLEAR_DATA_DIR": "/Users/you/.allclear",
  "ALLCLEAR_LOG_LEVEL": "INFO",
  "ALLCLEAR_CHROMA_MODE": "local",
  "ALLCLEAR_CHROMA_HOST": "localhost",
  "ALLCLEAR_CHROMA_PORT": "8000",
  "ALLCLEAR_CHROMA_SSL": "false",
  "ALLCLEAR_CHROMA_API_KEY": "",
  "ALLCLEAR_CHROMA_TENANT": "default_tenant",
  "ALLCLEAR_CHROMA_DATABASE": "default_database"
}
```

### Environment variables

| Variable | Effect |
|----------|--------|
| `ALLCLEAR_DISABLE_FORMAT=1` | Skip auto-formatting |
| `ALLCLEAR_DISABLE_LINT=1` | Skip auto-linting |
| `ALLCLEAR_DISABLE_GUARD=1` | Skip file guard |
| `ALLCLEAR_DISABLE_SESSION_START=1` | Skip session context |
| `ALLCLEAR_LINT_THROTTLE=<seconds>` | Cargo clippy throttle (default: `30`) |
| `ALLCLEAR_EXTRA_BLOCKED=<patterns>` | Colon-separated glob patterns to block |

### MCP Server (optional)

After building your first map, add the AllClear MCP server to your project's `.mcp.json` so all Claude agents can check impact before making changes:

```json
{
  "mcpServers": {
    "allclear-impact": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to-allclear>/worker/mcp-server.js"]
    }
  }
}
```

MCP tools: `impact_query`, `impact_changed`, `impact_graph`, `impact_search`, `impact_scan`.

## Architecture

```
allclear/
  .claude-plugin/
    plugin.json              # plugin manifest
  commands/
    quality-gate.md          # /allclear:quality-gate
    cross-impact.md          # /allclear:cross-impact
    drift.md                 # /allclear:drift
    pulse.md                 # /allclear:pulse
    deploy-verify.md         # /allclear:deploy-verify
    map.md                   # /allclear:map (v2.0)
  skills/
    quality-gate/SKILL.md    # auto-invocable quality gate
    impact/SKILL.md          # impact recommendations (v2.0)
  hooks/
    hooks.json               # hook event bindings
  scripts/
    format.sh                # auto-format hook
    lint.sh                  # auto-lint hook
    file-guard.sh            # file guard hook
    session-start.sh         # session context + worker auto-start
    impact.sh                # legacy grep-based impact scanner
    worker-start.sh          # worker daemon start (v2.0)
    worker-stop.sh           # worker daemon stop (v2.0)
  lib/
    config.sh                # config loading
    detect.sh                # language/project detection
    linked-repos.sh          # linked repo discovery
    worker-client.sh         # worker HTTP client helpers (v2.0)
  worker/                    # v2.0 service dependency intelligence
    index.js                 # worker entry point (Fastify + DB)
    db.js                    # SQLite lifecycle (WAL, migrations, snapshots)
    query-engine.js          # graph queries (transitive CTEs, impact classification)
    http-server.js           # REST API routes
    mcp-server.js            # MCP stdio server (5 impact tools)
    scan-manager.js          # agent dispatch + incremental scanning
    agent-prompt.md          # scanning agent prompt template
    findings-schema.js       # findings validation
    repo-discovery.js        # repo discovery module
    confirmation-flow.js     # user confirmation UX
    chroma-sync.js           # optional ChromaDB vector sync
    ui/
      index.html             # D3 Canvas graph UI (zero build step)
      graph.js               # Canvas renderer + interactions
      force-worker.js        # off-thread D3 force simulation
  tests/
    *.bats                   # bats test files (173+ tests)
    integration/             # E2E integration tests
  Makefile
  package.json               # v2.0 Node.js dependencies
```

## Development

```bash
make help        # show all targets
make test        # run all bats tests (173+ tests)
make lint        # shellcheck scripts and libs
make check       # validate plugin.json and hooks.json
make dev         # launch Claude Code with plugin loaded (no install)
```

## License

Apache-2.0
