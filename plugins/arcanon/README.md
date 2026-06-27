# Arcanon plugin

> You're inside the plugin source directory. For user docs, marketplace install instructions, and the full command reference, see the [repo root README](https://github.com/Arcanon-hub/arcanon#readme).

## Install

```bash
claude plugin marketplace add https://github.com/Arcanon-hub/arcanon
claude plugin install arcanon@arcanon --scope user
```

## Commands shipped by this plugin

Every command supports `--help` / `-h` / `help`.

**Scanning & graph**
- `/arcanon:map` — scan linked repos and build the service graph
- `/arcanon:rescan <repo>` — re-scan exactly one linked repo (bypasses the incremental skip)
- `/arcanon:export` — emit Mermaid / DOT / JSON / self-contained HTML

**Read-only navigation**
- `/arcanon:list` — 5-line project overview (repos, services, connections, actors, hub)
- `/arcanon:view` — open the graph UI
- `/arcanon:doctor` — 8-check smoke-test diagnostics
- `/arcanon:diff <scanA> <scanB>` — diff two scans (`HEAD`/`HEAD~N`/ISO/branch)

**Corrections & verification**
- `/arcanon:correct <kind> --action <action>` — stage a `scan_overrides` row consumed on the next scan
- `/arcanon:verify` — re-read source at cited line ranges; flag drifted connections

**Cross-repo intelligence**
- `/arcanon:impact <target>` — cross-repo impact query (MCP-backed)
- `/arcanon:drift [graph|versions|types|openapi]` — drift detection across 8 ecosystems

**Hub sync**
- `/arcanon:login` — store an `arc_*` API key
- `/arcanon:sync` — upload current scan + drain the offline queue (`--offline`, `--repo`, `--dry-run`, `--force`, `--drain`)
- `/arcanon:status` — one-line health + per-repo scan freshness

**Maintenance**
- `/arcanon:update` — version check / worker kill / cache prune / verify

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
