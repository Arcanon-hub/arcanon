---
description: Run 8 smoke-test diagnostics (worker reachable, version, schema head, config, data dir, DB integrity, MCP smoke, hub creds). PASS/WARN/FAIL/SKIP per check, exits 1 on critical fail. Read-only.
argument-hint: "[--json]"
allowed-tools: Bash
---

# Arcanon Doctor — Diagnostic Suite

Run 8 read-only smoke tests against the current Arcanon installation:

| # | Check | Disposition |
| - | ----- | ----------- |
| 1 | worker HTTP reachable | CRITICAL |
| 2 | worker `/api/version` matches plugin version | non-critical (WARN) |
| 3 | DB schema head == migration head | non-critical (WARN) |
| 4 | `arcanon.config.json` parses + linked repos resolve | non-critical (WARN) |
| 5 | `$ARCANON_DATA_DIR` exists + writable | CRITICAL |
| 6 | DB integrity (`PRAGMA quick_check`) | CRITICAL |
| 7 | MCP server liveness probe | non-critical (WARN) |
| 8 | hub credential round-trip | non-critical (WARN; SKIP if no creds) |

Critical failures (1, 5, 6) exit `1`. Non-critical failures stay at exit `0`
with a `WARN` line. In a non-Arcanon directory the command is a silent no-op
(matches `/arcanon:list`).

## Usage

| Invocation | Behaviour |
| ---------- | --------- |
| `/arcanon:doctor` | Pretty per-check table to stdout. Exit 0 on all-pass / WARN; 1 on critical FAIL. |
| `/arcanon:doctor --json` | Single JSON object with `{version, project_root, checks[], summary}`. Same exit-code semantics. |

## Read-only guarantee

`/arcanon:doctor` performs **zero writes** to the project DB. Check 6 uses a
fresh **read-only** SQLite connection (bypassing the worker's process-cached
singleton) so `PRAGMA quick_check` cannot mutate state and cannot interfere with
in-flight worker queries. Check 5 writes a single PID-suffixed probe file under
`$ARCANON_DATA_DIR` and unlinks it in the same try-block.

## Step 1 — Run the command

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
if ! _arcanon_is_project_dir; then
  exit 0  # silent in non-Arcanon directories
fi
if ! worker_running; then
  bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh > /dev/null 2>&1
fi
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh doctor $ARGUMENTS
```

Relay the output verbatim. Exit code propagates so callers (CI, pre-release
gates) can branch on critical failure.

## Help

- **All PASS** → installation is healthy.
- **Check 1 FAIL** → worker is not reachable. Try `/arcanon:status` to see the
  port, then re-launch via `/arcanon:map` (boots the worker as a side effect).
- **Check 5 FAIL** → `$ARCANON_DATA_DIR` is missing or not writable. Check
  permissions; default is `~/.arcanon`.
- **Check 6 FAIL** → impact-map.db is corrupted. Back it up, then re-run
  `/arcanon:map` to rebuild.
- **Check 3 WARN** → DB schema is behind the migration head. Restart the worker;
  migrations run on first DB open.
- **Check 4 WARN** → `arcanon.config.json` has a missing/invalid linked-repo
  path. Fix the path or remove the entry.
- **Check 7 WARN** → MCP server failed to start cleanly. Run
  `node plugins/arcanon/worker/mcp/server.js` directly to see the error.
- **Check 8 SKIP** → no credentials configured. This is normal; only matters
  if you intend to use `/arcanon:sync` or hub-backed enrichment.
- **Check 8 WARN** → hub configured but unreachable or auth rejected. Verify
  `/arcanon:status` shows `credentials: present`, then check network.
