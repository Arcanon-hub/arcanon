# Arcanon

> **Cross-repo service dependency scanner for Claude Code.**
> Map your architecture, detect drift, and sync to Arcanon Hub — all from inside your editor.

Arcanon is a Claude Code plugin that discovers services, endpoints, connections, and schemas across all your repositories, then helps you reason about cross-repo impact *before* you merge. The plugin works fully offline; when connected to [Arcanon Hub](https://app.arcanon.dev), findings sync to a cloud service graph that powers org-wide drift detection and impact analysis.

[![CI](https://github.com/Arcanon-hub/arcanon/actions/workflows/ci.yml/badge.svg)](https://github.com/Arcanon-hub/arcanon/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL_3.0-blue.svg)](./LICENSE)

---

## Why Arcanon?

Most dependency tools stop at `package.json` and `Cargo.toml`. Arcanon traces the *runtime* graph — the HTTP calls, gRPC streams, message-bus topics, and shared schemas that actually couple your services together — across repository boundaries.

| Pillar | What it means |
| --- | --- |
| **Discover** | Agents walk each repo, emit a structured JSON findings file. |
| **Reconcile** | Findings are stitched into a single cross-repo graph in local SQLite. |
| **Detect drift** | Compare a live scan against the last uploaded snapshot from the hub. |
| **Sync to hub** | Upload findings to `api.arcanon.dev` so your team, CI, and other repos can query them. |

## Quick start

```bash
# 1. Install the plugin marketplace (one-time)
claude plugin marketplace add https://github.com/Arcanon-hub/arcanon
claude plugin install arcanon@arcanon --scope user

# 2. In your repo, run your first scan
/arcanon:map

# 3. (Optional) Connect to Arcanon Hub
/arcanon:login            # paste your arc_... API key
/arcanon:upload           # push the latest scan
/arcanon:status           # check sync state + queue
```

Full walkthroughs live in [docs/getting-started.md](./docs/getting-started.md).

## Commands

| Command | What it does |
| --- | --- |
| `/arcanon:map` | Scan repos, build or refresh the local service graph. |
| `/arcanon:drift` | Diff the live scan against the last uploaded hub snapshot. |
| `/arcanon:impact` | Query cross-repo consumers of a service/endpoint. |
| `/arcanon:cross-impact` | Legacy alias for repo-local transitive impact. |
| `/arcanon:login` | Store your Arcanon Hub API key. |
| `/arcanon:upload` | Upload the latest scan to the hub. |
| `/arcanon:sync` | Drain the offline upload queue. |
| `/arcanon:status` | One-line health: worker + hub + queue. |
| `/arcanon:export` | Emit Mermaid / DOT / self-contained HTML graph from the latest scan. |

See [docs/commands.md](./docs/commands.md) for the full reference.

## Configuration

Arcanon reads `arcanon.config.json` from the repo root. Legacy `ligamen.config.json` is still honored — rename it when convenient.

```json
{
  "project-name": "my-project",
  "linked-repos": ["../sibling-service", "../shared-lib"],
  "hub": {
    "auto-upload": true,
    "url": "https://api.arcanon.dev"
  }
}
```

Hub credentials can live in the plugin's `userConfig` (preferred, stored in the system keychain), the `ARCANON_API_KEY` environment variable, or `~/.arcanon/config.json`. See [docs/hub-integration.md](./docs/hub-integration.md).

## How it works

```
 repo(s) ──▶  Claude agent  ──▶  findings.json  ──▶  local SQLite (~/.arcanon/)
                                                        │
                              ┌──── query/MCP tools ────┤
                              ▼                         ▼
                         /arcanon:impact          /arcanon:drift
                                                        │
                                             Arcanon Hub (api.arcanon.dev)
                                                        │
                                                 cross-repo, cross-org graph
```

The plugin is **offline-first**: no network required to scan, query, or map. Hub sync is opt-in and retries through a local SQLite-backed queue when the network blips.

## Related repos

| Repo | Role |
| --- | --- |
| [arcanon-hub](https://github.com/Arcanon-hub/arcanon-hub) | FastAPI + Postgres service graph backend. |
| [arcanon-scanner](https://github.com/Arcanon-hub/arcanon-scanner) | Standalone Rust CLI for CI/non-Claude flows. |
| [arcanon-plugin](https://github.com/Arcanon-hub/arcanon-plugin) | CVE-lookup plugin for Claude Code (separate product). |
| [arcanon-skills](https://github.com/Arcanon-hub/arcanon-skills) | Markdown skill packs for the Rust CLI. |

## License

AGPL-3.0-only. See [LICENSE](./LICENSE).

Arcanon was formerly known as **Ligamen** — see the [migration guide](./docs/migration.md) if you're upgrading from v5.x.
