# Getting started with Arcanon

A five-minute walkthrough from a fresh clone to a scan synced to the hub.

## 1. Install the plugin

```bash
claude plugin marketplace add https://github.com/Arcanon-hub/arcanon
claude plugin install arcanon@arcanon --scope user
```

The plugin ships a marketplace manifest; Claude Code pulls the plugin body
and registers the `/arcanon:*` slash commands plus the MCP server.

Confirm it's live in a new Claude Code session — you should see:

> `Arcanon active. Detected: <your project types>. Commands: /arcanon:map, …`

**Supported languages:** TypeScript / JavaScript, Python, Go, Rust, Java,
C#, Ruby — for project-type detection, version drift (7 ecosystems
including Maven, NuGet, Bundler), type drift, and auth / database
enrichment. Other languages still scan (agents are language-agnostic);
the support infrastructure — drift output, CODEOWNERS, auth/db columns —
is richest for the seven above.

## 2. First scan

In any repository:

```
/arcanon:map
```

Arcanon walks your repos with Claude agents, extracts services +
connections, and writes the result to a local SQLite DB at
`~/.arcanon/projects/<hash>/impact-map.db`. The first run may take a
few minutes — subsequent runs are incremental.

When the scan finishes you can open the local graph UI:

```
/arcanon:map view
```

Or export a graph without the UI:

```
/arcanon:export
```

That drops Mermaid, DOT, JSON, and a standalone HTML viewer into
`.arcanon/reports/<timestamp>/`.

## 3. Connect to Arcanon Hub

If you just want to use Arcanon locally, you can stop here. To share your
service graph across teammates and other repos:

**a) Create an API key** at
[https://app.arcanon.dev/settings/api-keys](https://app.arcanon.dev/settings/api-keys).
Keys start with `arc_`. Org-scoped keys can upload for any project; project-
scoped keys are locked to one project_slug.

**b) Log in:**

```
/arcanon:login arc_...
```

The key is stored in `~/.arcanon/config.json` with mode `0600`.

**c) Upload your scan:**

```
/arcanon:upload
```

A `401` response means the key is invalid — regenerate one in the web
dashboard and re-run `/arcanon:login`. A `202` response means you're in.

Or turn on auto-upload in `arcanon.config.json`:

```json
{
  "project-name": "my-service",
  "hub": { "auto-upload": true }
}
```

After that, every `/arcanon:map` run uploads automatically. Failed uploads
enqueue locally and retry via `/arcanon:sync` (or opportunistically when
the worker next starts).

## 4. Query cross-repo impact

```
/arcanon:impact my-endpoint
```

Arcanon shows every consumer of the endpoint across all repos the hub
knows about — direct and transitive, with a ↪ marker for edges that cross
your repo boundary.

## 5. Detect drift

```
/arcanon:drift graph          # service-graph drift between the last two scans
/arcanon:drift versions       # dependency version drift across linked repos
/arcanon:drift openapi        # OpenAPI spec drift
```

## 6. Everyday commands

| Command | Purpose |
| --- | --- |
| `/arcanon:map` | Refresh the scan. |
| `/arcanon:map view` | Open the local graph UI. |
| `/arcanon:upload` | Push to hub manually. |
| `/arcanon:status` | Health snapshot. |
| `/arcanon:sync` | Drain upload queue. |
| `/arcanon:export --format mermaid` | Get a Mermaid block for PRs/docs. |

## Troubleshooting

- **"no local scan" errors** → run `/arcanon:map` first.
- **"hub returned 401"** → `/arcanon:login` again with a fresh key.
- **"hub returned 422"** → the payload validator rejected something —
  report it with the warning list the CLI prints.
- **Queue keeps growing** → `/arcanon:sync` drains it; check
  `~/.arcanon/hub-queue.db` for the failing rows.
- **Coming from Ligamen v5.x?** → the plugin was renamed (Ligamen → Arcanon) and reset to `0.1.0` as a clean public release. Legacy `~/.ligamen/` data dir and `LIGAMEN_*` env vars are still honored; rename to `~/.arcanon/` and `ARCANON_*` at your convenience.

## Uninstalling

```bash
claude plugin uninstall arcanon@arcanon
rm -rf ~/.arcanon
```
