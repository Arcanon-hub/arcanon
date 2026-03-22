# Ligamen

**Your AI coding agent doesn't know what it's about to break.**

Claude Code is powerful — it writes, refactors, and ships code fast. But it operates blind to what lives in your other repositories. It doesn't know that the endpoint it just renamed is called by three downstream services, or that the schema it changed is shared across your entire platform.

Ligamen gives Claude Code a service dependency graph that spans all your repositories. Before changes are made, Claude can see which services are connected, trace the blast radius of a change, and catch drift across API contracts, shared types, and dependency versions — so your AI agent stops introducing cross-service bugs.

## What Ligamen Does

**Maps your architecture.** Ligamen scans your linked repositories with Claude agents to build an interactive service dependency graph — services, libraries, infrastructure, external actors, and every connection between them. Explore it visually in an interactive graph UI at `http://localhost:37888`.

**Shows what breaks before it breaks.** Run `/ligamen:cross-impact` and Ligamen traces dependencies through your service graph, flagging every downstream service affected by your changes — ranked by severity. Your AI agent can check this automatically via MCP tools before making any modification.

**Catches drift across repos.** Dependency versions out of sync? Type definitions that diverged? OpenAPI specs that don't agree? `/ligamen:drift` finds the inconsistencies before they become production incidents.

**Keeps your code clean automatically.** Every file Claude edits gets auto-formatted and auto-linted. Sensitive files like `.env`, lock files, and credentials are protected from accidental writes. No configuration needed.

## Quick Start

```bash
claude plugin marketplace add https://github.com/chilleregeravi/ligamen
claude plugin install ligamen@ligamen --scope user
```

That's it. Ligamen works with zero configuration — hooks activate immediately, and commands are available in every Claude Code session.

**Build your first service map:**

```
/ligamen:map
```

**See what your changes affect:**

```
/ligamen:cross-impact
```

**Check for drift across repos:**

```
/ligamen:drift
```

## Commands

| Command | What it does |
|---------|-------------|
| `/ligamen:map` | Scan repos and build service dependency graph |
| `/ligamen:map view` | Open the graph UI without re-scanning |
| `/ligamen:cross-impact` | Trace blast radius of current changes across services |
| `/ligamen:drift` | Find version mismatches, type drift, and API spec divergence |
| `/ligamen:quality-gate` | Run lint, format, test, and typecheck for your project |

See [Commands](docs/commands.md) for full usage and options.

## Automatic Behaviors

Ligamen runs these in the background on every Claude Code session with zero setup:

- **Auto-format** — formats every file Claude edits (Python, Rust, TypeScript, Go, JSON, YAML)
- **Auto-lint** — runs your project's linter and surfaces issues to Claude
- **File guard** — blocks writes to `.env`, lock files, credentials, and generated directories
- **Session context** — detects your project type and auto-starts the graph worker if configured

See [Automatic Behaviors](docs/hooks.md) for details and how to disable individual behaviors.

## Graph UI

After scanning, open `http://localhost:37888` to explore your service architecture visually — layered layout, boundary grouping, protocol-differentiated edges, subgraph isolation, blast radius highlighting, what-changed overlay, filtering by protocol/language/boundary, and PNG export.

See [Service Map](docs/service-map.md) for the full feature set.

## MCP Server

After building your first map, add the Ligamen MCP server so every Claude agent — not just the session that ran the scan — can check impact before making changes:

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

Add this to your Claude Code MCP settings (typically `~/.claude/settings.json` under `"mcpServers"`).

This exposes 8 tools to all Claude sessions: `impact_query`, `impact_changed`, `impact_graph`, `impact_search`, `impact_scan`, `drift_versions`, `drift_types`, and `drift_openapi`.

## Configuration

Ligamen works with zero configuration. For customization, see [Configuration](docs/configuration.md) — linked repos, service boundaries, ChromaDB semantic search, environment variables, and machine settings.

## Documentation

| Doc | Description |
|-----|-------------|
| [Commands](docs/commands.md) | All slash commands with usage and options |
| [Automatic Behaviors](docs/hooks.md) | Auto-format, auto-lint, file guard, session context |
| [Service Map](docs/service-map.md) | Dependency graph scanning, graph UI, MCP setup |
| [Configuration](docs/configuration.md) | Project config, environment variables, ChromaDB, advanced settings |
| [Architecture](docs/architecture.md) | System internals for contributors |
| [Development](docs/development.md) | Testing, linting, contributing |

## License

AGPL-3.0-only — see [LICENSE](LICENSE)
