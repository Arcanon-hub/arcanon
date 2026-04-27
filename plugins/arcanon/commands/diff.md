---
description: Compare two scan versions (NAV-04) or live vs shadow (--shadow, SHADOW-02). Shows services/connections added, removed, or modified.
argument-hint: "<scanA> <scanB> | --shadow [--json]"
allowed-tools: Bash
---

# Arcanon Diff — Scan-Version Comparison

Compare two scan versions of the current project's impact map. Selectors accepted:

- **Integer scan ID** — `/arcanon:diff 5 7`
- **HEAD shorthand** — `/arcanon:diff HEAD HEAD~1`
- **ISO date** — `/arcanon:diff 2026-04-20 2026-04-25` (resolves to most recent scan ≤ each cutoff)
- **Branch name** — `/arcanon:diff main feature-x` (resolves via `repo_state.last_scanned_commit`)
- **`--shadow`** — `/arcanon:diff --shadow` compares live LATEST vs shadow LATEST (Phase 119, SHADOW-02). Requires both `impact-map.db` and `impact-map-shadow.db` to exist; run `/arcanon:shadow-scan` first if shadow is missing.

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
**Usage:** `/arcanon:diff --shadow [--json]` (Phase 119, SHADOW-02)

Compare two scan versions and show services/connections added, removed, or
modified between them.

**Options:**
- `--json` — single JSON object with engine result + `project_root`/`scanA`/`scanB` metadata
- `--shadow` — compare live LATEST vs shadow LATEST instead of accepting positional scan selectors. Requires both `impact-map.db` and `impact-map-shadow.db` under `${ARCANON_DATA_DIR}/projects/<hash>/`.
- `--help`, `-h`, `help` — print this help and exit

**Examples:**
- `/arcanon:diff 5 7` — integer scan IDs
- `/arcanon:diff HEAD HEAD~1` — most recent vs one before
- `/arcanon:diff 2026-04-20 2026-04-25` — ISO date cutoffs
- `/arcanon:diff main feature-x` — branch heuristic
- `/arcanon:diff HEAD HEAD~1 --json` — machine-readable
- `/arcanon:diff --shadow` — live vs shadow comparison (after `/arcanon:shadow-scan`)
- `/arcanon:diff --shadow --json` — machine-readable live-vs-shadow

## --shadow flag (SHADOW-02 / Phase 119)

`/arcanon:diff --shadow` compares the LATEST completed scan in the live
`impact-map.db` against the LATEST completed scan in the
`impact-map-shadow.db`. Reuses the same `diffScanVersions` engine that
positional `/arcanon:diff` uses — passing the live DB handle and the shadow
DB handle as the two sources. Both DBs are opened READ-ONLY so neither file
is mutated.

**Exit codes (--shadow):**
- `0` — diff completed (with or without changes)
- `2` — no live DB, no shadow DB, or no completed scan in either side

**Workflow:** `/arcanon:shadow-scan` → `/arcanon:diff --shadow` → optionally
`/arcanon:promote-shadow`.

## Step 1 — Run the diff

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/diff.md" && exit 0
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
if ! _arcanon_is_project_dir; then
  exit 0  # silent in non-Arcanon directories per NAV-04 contract
fi
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh diff $ARGUMENTS
```
