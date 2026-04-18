# Migrating from Ligamen v5 to Arcanon v6

Arcanon is a rename + feature expansion of the Ligamen plugin. Your existing
setup will keep working — this page lists what changed and what's safe to
update at your leisure.

## Quick summary

| Concern | v5 (Ligamen) | v6 (Arcanon) | Back-compat? |
| --- | --- | --- | --- |
| Plugin dir | `plugins/ligamen/` | `plugins/arcanon/` | rename handled by marketplace |
| Config file | `ligamen.config.json` | `arcanon.config.json` | legacy honored |
| Data dir | `~/.ligamen/` | `~/.arcanon/` | legacy honored |
| Command prefix | `/ligamen:*` | `/arcanon:*` | tracks plugin name |
| Env vars | `LIGAMEN_*` | `ARCANON_*` | legacy aliases honored |
| MCP server name | `ligamen-impact` | `arcanon` | — |
| Worker API | unchanged | unchanged | — |

## Do I have to do anything?

**No** for an upgrade in place. After installing v6:

- `arcanon.config.json` is preferred, but `ligamen.config.json` still loads.
- `~/.arcanon/` is used when present, else `~/.ligamen/` — old scans keep working.
- `$LIGAMEN_*` env vars are still read; `$ARCANON_*` takes precedence.
- The command prefix *does* change to `/arcanon:*` because Claude Code
  derives it from the plugin name. Your muscle memory will need an update.

## Suggested cleanup (when convenient)

```bash
# 1. Rename the repo-local config.
mv ligamen.config.json arcanon.config.json

# 2. Migrate the home data dir (optional — leave it if you don't need the rename).
mv ~/.ligamen ~/.arcanon
# Update any launchd/systemd units that hard-coded LIGAMEN_DATA_DIR.

# 3. Update CI env vars.
#    LIGAMEN_API_KEY → ARCANON_API_KEY (no plugin change needed; both work)
```

## What's new in v6

- **Hub sync.** `/arcanon:login`, `/arcanon:upload`, `/arcanon:sync`,
  `/arcanon:status`. Offline queue at `~/.arcanon/hub-queue.db`.
- **`/arcanon:drift graph`.** Service-graph drift between the two most
  recent scans (added / removed / changed services + connections).
- **`/arcanon:impact`.** Cross-repo impact query (MCP-backed).
- **`/arcanon:export`.** Mermaid / DOT / JSON + self-contained HTML
  viewer.
- **`userConfig.api_token`** in `plugin.json` — Claude Code stores the
  token in its system keychain; no plaintext env var required.

## Breaking changes

- **Command prefix**: `/ligamen:*` → `/arcanon:*`. Claude Code auto-
  registers from the plugin name, so the old prefix is gone. No aliasing
  layer exists yet; update any saved prompts / keyboard shortcuts.
- **Plugin name in marketplace**: references to `ligamen@ligamen` should
  become `arcanon@arcanon`.

## Known non-breaking renames

- `LIGAMEN_WORKER_PORT` → `ARCANON_WORKER_PORT` (legacy name still read).
- `LIGAMEN_CHROMA_MODE` → `ARCANON_CHROMA_MODE` (legacy name still read).
- `LIGAMEN_CONFIG_LINKED_REPOS` → `ARCANON_CONFIG_LINKED_REPOS` (shell
  variable exported by `lib/config.sh`; legacy name mirrors the new one).

## Rolling back

The plugin is AGPL-3.0 — you can pin an older version by installing a
specific tag:

```bash
claude plugin install arcanon@arcanon --version 5.7.0
```

Open an issue if the legacy fallback misses a path you rely on.
