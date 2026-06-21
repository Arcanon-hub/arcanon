# Getting started with Arcanon

A five-minute walkthrough from a fresh clone to a scan synced to the hub.

## Prerequisites

- **Node.js 22.13 or newer** and **npm** on your `PATH`. On first activation the plugin
  installs its own runtime dependencies (pure-JS — no native compilation required)
  into the plugin directory.
- **git** CLI (you already have it for working with repos).
- **Windows:** install [Git for Windows](https://git-scm.com/downloads/win),
  which bundles **Git Bash** — the plugin's hooks and commands run under it.
  (If you use the `git` CLI on Windows you already have this.) PowerShell-only
  setups are not yet supported. If a machine has *both* Git Bash and WSL,
  Claude Code's `bash` may route to WSL ([#26006](https://github.com/anthropics/claude-code/issues/26006));
  pin Git Bash in your settings if scans run in the wrong environment.

> **First session after install/upgrade:** the dependency install runs in the
> background while your session starts, so the `impact_*` MCP tools may not be
> ready for the very first prompt. Slash commands like `/arcanon:map` work
> regardless; if an impact tool reports "not connected," run `/mcp` to
> reconnect, or just continue — it's ready from the next session on.

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
C#, Ruby — for project-type detection, version drift (8 ecosystems
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
Keys start with `arc_`.

**b) Log in:**

```
/arcanon:login arc_xxxxxxxxxxxx
```

The plugin calls the hub's `whoami` endpoint to learn which orgs your
key is authorized for:

- If the key has **one** grant, that org is auto-selected and stored.
- If the key has **multiple** grants, you'll be prompted to pick one.
- If the key has **no** grants, login fails — ask your admin to grant
  the key access.

You can also pin an org id explicitly:

```
/arcanon:login arc_xxxxxxxxxxxx --org-id 7f3e1234-…
```

The triple (api key, hub url, default org id) is stored in
`~/.arcanon/config.json` with mode `0600`.

**c) Verify with `/arcanon:status`:**

```
/arcanon:status
```

You should see an Identity block with your resolved org id and the list
of orgs your key is authorized for.

**d) Upload your scan:**

```
/arcanon:sync
```

Or turn on auto-sync in `arcanon.config.json`:

```json
{
  "project-name": "my-service",
  "hub": { "auto-sync": true }
}
```

After that, every `/arcanon:map` run uploads automatically. Failed
uploads enqueue locally and retry via `/arcanon:sync`.

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
| `/arcanon:sync` | Push to hub (also drains the offline queue). |
| `/arcanon:status` | Health snapshot (incl. Identity block). |
| `/arcanon:login` | Sign in to the hub (whoami auto-resolves your org). |
| `/arcanon:export --format mermaid` | Get a Mermaid block for PRs/docs. |

## Troubleshooting

- **"no local scan" errors** → run `/arcanon:map` first.
- **"hub returned 401 / invalid_key"** → `/arcanon:login` again with a fresh key.
- **"hub returned 403 / key_not_authorized_for_org"** → `/arcanon:login --org-id <uuid>`
  to switch to an org your key has access to.
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
