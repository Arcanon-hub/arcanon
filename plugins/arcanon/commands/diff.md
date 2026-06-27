---
description: Compare two scan versions. Shows services/connections added, removed, or modified.
argument-hint: "<scanA> <scanB> [--json]"
allowed-tools: Bash
---

# Arcanon Diff — Scan-Version Comparison

Compare two scan versions of the current project's impact map. Selectors accepted:

- **Integer scan ID** — `/arcanon:diff 5 7`
- **HEAD shorthand** — `/arcanon:diff HEAD HEAD~1`
- **ISO date** — `/arcanon:diff 2026-04-20 2026-04-25` (resolves to most recent scan ≤ each cutoff)
- **Branch name** — `/arcanon:diff main feature-x` (resolves via `repo_state.last_scanned_commit`)

Read-only via direct SQLite access — does not require the worker to be running.

## Output

Human format groups changes by Services Added/Removed/Modified and Connections Added/Removed/Modified, with per-section counts and a summary line.

`--json` emits a single JSON object with the engine's full result plus `project_root`, `scanA`, and `scanB` metadata. Use for CI / scripting.

Same-scan input (`/arcanon:diff 5 5`) prints `Diff: scan #5 vs scan #5 — identical` and exits 0.

## Exit codes

- `0` — diff completed (with or without changes)
- `2` — usage error: missing args, unparseable selector, scan not found, branch not found, HEAD~N out of range

Silent (no output, exit 0) when run from a directory without an `impact-map.db`.

## Help

**Usage:** `/arcanon:diff <scanA> <scanB> [--json]`

Compare two scan versions and show services/connections added, removed, or
modified between them.

**Options:**
- `--json` — single JSON object with engine result + `project_root`/`scanA`/`scanB` metadata
- `--help`, `-h`, `help` — print this help and exit

**Examples:**
- `/arcanon:diff 5 7` — integer scan IDs
- `/arcanon:diff HEAD HEAD~1` — most recent vs one before
- `/arcanon:diff 2026-04-20 2026-04-25` — ISO date cutoffs
- `/arcanon:diff main feature-x` — branch heuristic
- `/arcanon:diff HEAD HEAD~1 --json` — machine-readable

## Step 1 — Run the diff

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/diff.md" && exit 0
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
if ! _arcanon_is_project_dir; then
  exit 0  # silent when not in an Arcanon-mapped repo
fi
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh diff $ARGUMENTS
```
