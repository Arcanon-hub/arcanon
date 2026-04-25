---
description: Re-read cited source files and verify the recorded evidence still exists. Read-only — never modifies scan data. Returns per-connection verdict (ok/moved/missing/method_mismatch) for one connection, one source file, or every connection in the latest scan.
argument-hint: "[--connection <id> | --source <path>] [--all] [--json]"
allowed-tools: Bash, mcp__plugin_arcanon_arcanon__*
---

<!-- Linear THE-1022 reviewer item #1 — TRUST-01 (v0.1.3) -->

# Arcanon Verify

Re-read the cited source file and confirm the recorded evidence is still where
the scan said it would be. Use this to detect stale scan data without running
a full `/arcanon:map`.

## When to use

- After significant code changes, before trusting `/arcanon:impact` results.
- In CI, to fail the build when scan drift exceeds threshold.
- After a teammate's PR merges, to spot-check whether your scan is stale.

## Usage

| Invocation | Behaviour |
| --- | --- |
| `/arcanon:verify` | Verify ALL connections in the latest scan (implicit `--all`). Capped at 1000; use `--source` to scope larger scans. |
| `/arcanon:verify --connection <id>` | Verify exactly one connection by integer ID. |
| `/arcanon:verify --source <path>` | Verify all connections whose `source_file` matches. Basename match if no `/` in the value, exact match otherwise. |
| `/arcanon:verify --json` | Emit machine-readable JSON instead of the human table. Combinable with the scoping flags above. |

## Verdicts

Every connection check returns exactly one of:

| Verdict | Meaning | Recommended action |
| --- | --- | --- |
| `ok` | Cited evidence is still present at the recorded location. | None — connection is trustworthy. |
| `moved` | The recorded `source_file` no longer exists at that path. | Rescan with `/arcanon:map` (the file was renamed or deleted). |
| `missing` | The file exists but the recorded evidence snippet is gone. | Re-run `/arcanon:map` (or, when v0.1.5 ships, `/arcanon:correct`). |
| `method_mismatch` | Snippet present, but the cited HTTP method doesn't appear in it. | Spot-check — usually means the agent misclassified the method. |

Verdicts are total — every connection gets exactly one. No `warning` or
`unknown` states.

## Step 1 — Detect worker

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
WORKER_UP=$(worker_running && echo "yes" || echo "no")
```

If `WORKER_UP=no`, print:

> Worker is not running. Start it with `/arcanon:map` (which boots the worker
> as a side effect), then re-run `/arcanon:verify`.

Then stop. Do **not** start the worker from this command — verify is read-only
and never owns the worker lifecycle.

## Step 2 — Run the verify pass

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh verify $ARGUMENTS
```

Relay the script's output verbatim. The exit code propagates so callers (CI,
pre-commit) can branch on it:

- `0` — all verdicts are `ok`
- `1` — at least one non-`ok` verdict, or the 1000-connection cap was hit
- `2` — invocation error (bad flag, invalid `--connection` ID)

## Step 3 — Interpret the result

- All `ok` → trust the graph. Move on.
- Any `moved` → rescan. The graph cannot be repaired from drift alone.
- Any `missing` → either rescan now or wait for `/arcanon:correct` (v0.1.5).
- Any `method_mismatch` → spot-check the cited connection in the detail panel.
  If the method really is wrong, mark it for `/arcanon:correct` (v0.1.5).

## Performance notes

- Each connection = one file read. ~200 connections complete in <2s on a warm
  cache.
- Hard cap at 1000 connections per call. If exceeded, scope with `--source` or
  `--connection`. The cap exists so an unscoped run on a large monorepo never
  silently blocks the terminal.

## Read-only guarantee

`/arcanon:verify` performs **zero writes**. The scan database, audit log, and
`scan_versions` table are byte-identical before and after. Safe to run in
pre-commit, CI, or in a tight loop.

It does **not**:

- Update `connections` rows
- Modify `scan_versions`
- Write to `enrichment_log`
- Trigger a rescan

For corrective action, follow up with `/arcanon:correct` (deferred to v0.1.5).
