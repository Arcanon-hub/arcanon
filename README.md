# AllClear

Quality gates, cross-repo impact analysis, and service dependency intelligence for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

AllClear is a Claude Code **plugin** that auto-formats, auto-lints, guards sensitive files, and maps service dependencies across your repositories.

## Quick Start

```bash
git clone https://github.com/chilleregeravi/allclear.git
cd allclear
git submodule update --init --recursive
npm install
make install
```

## What It Does

**Runs automatically (hooks):**
- Auto-format on every edit (Python, Rust, TypeScript, Go)
- Auto-lint with issues surfaced to Claude
- Block writes to `.env`, lock files, credentials
- Session context with project type detection

**On-demand (commands):**
- `/allclear:quality-gate` — lint, format, test, typecheck
- `/allclear:map` — scan repos and build service dependency graph
- `/allclear:cross-impact` — find what breaks when you change something
- `/allclear:drift` — check dependency version alignment across repos
- `/allclear:pulse` — Kubernetes service health check
- `/allclear:deploy-verify` — compare expected vs actual cluster state

## Documentation

| Doc | Description |
|-----|-------------|
| [Hooks](docs/hooks.md) | Auto-format, auto-lint, file guard, session context |
| [Commands](docs/commands.md) | All slash commands with usage examples |
| [Service Map](docs/service-map.md) | Dependency graph scanning, storage, visualization |
| [Configuration](docs/configuration.md) | Config files, environment variables, settings |
| [Architecture](docs/architecture.md) | Project structure, worker process, MCP server |
| [Development](docs/development.md) | Testing, linting, contributing |

## Configuration

Zero-config by default. Optional overrides:

- `allclear.config.json` — linked repos, impact-map settings ([details](docs/configuration.md))
- `~/.allclear/settings.json` — worker port, ChromaDB, log level ([details](docs/configuration.md#machine-settings))
- Environment variables — disable individual hooks ([details](docs/configuration.md#environment-variables))

## License

Apache-2.0
