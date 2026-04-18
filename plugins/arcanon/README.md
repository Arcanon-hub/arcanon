# Arcanon plugin

> You're inside the plugin source directory. For user docs, marketplace install instructions, and the full command reference, see the [repo root README](https://github.com/Arcanon-hub/arcanon#readme).

## Install

```bash
claude plugin marketplace add https://github.com/Arcanon-hub/arcanon
claude plugin install arcanon@arcanon --scope user
```

## Commands shipped by this plugin

**Scanning & graph**
- `/arcanon:map` — scan linked repos and build the service graph
- `/arcanon:export` — emit Mermaid / DOT / JSON / self-contained HTML
- `/arcanon:impact` — cross-repo impact query (MCP-backed)
- `/arcanon:cross-impact` — legacy repo-local impact query

**Drift**
- `/arcanon:drift` — service-graph / version / type / OpenAPI drift

**Hub sync**
- `/arcanon:login` — store an `arc_*` API key
- `/arcanon:upload` — push the latest scan to the hub
- `/arcanon:sync` — drain the offline upload queue
- `/arcanon:status` — one-line health report

See [`docs/commands.md`](../../docs/commands.md) at the repo root for full details.

## Automatic behaviors

Hooks defined in `hooks/hooks.json` run automatically:

- **Format** on edit (Python, Rust, TypeScript, Go)
- **Lint** on edit, surfacing issues to Claude
- **File guard** blocks writes to `.env`, lock files, credentials
- **Session-start context** injects project type + command list
- **Dep install** pulls MCP runtime deps on first session

## Package layout

| Path | Purpose |
|---|---|
| `commands/` | Slash-command markdown (`/arcanon:*`) |
| `skills/` | Context-triggered skills |
| `hooks/` | Hook bindings |
| `scripts/` | Shell implementations for hooks and CLIs |
| `lib/` | Shared bash libs (config, detect, linked-repos, data-dir) |
| `worker/` | Node.js daemon — DB, HTTP API, MCP, scan agents, UI |
| `worker/hub-sync/` | Hub upload client + offline queue |
| `worker/cli/` | Node CLIs dispatched by slash commands |

## Running the test suite

```bash
cd plugins/arcanon
npm ci
node --test worker/hub-sync/   # 35 hub-sync tests
```
