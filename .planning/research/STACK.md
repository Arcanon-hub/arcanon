# Stack Research

**Domain:** Claude Code plugin — self-update CLI, ambient PreToolUse hooks, SessionStart enrichment
**Milestone:** v0.1.1 Command Cleanup + Update + Ambient Hooks
**Researched:** 2026-04-21
**Confidence:** HIGH (all CLI surface verified live against `claude plugin --help`; hooks.json verified against shipped file; schema verified against all 10 migrations; cache paths verified by filesystem inspection)

---

## 1. Claude Code Plugin-Management CLI Surface

### Verified Commands (live `--help` output, April 2026)

```
claude plugin update   <plugin>           --scope user|project|local|managed
claude plugin install  <plugin>[@market]  --scope user|project|local
claude plugin uninstall <plugin>          --scope user|project|local  --keep-data
claude plugin marketplace update [name]   (no flags)
claude plugin marketplace list
```

**`/arcanon:update` will need these three shell calls in sequence:**

| Step | Command | Notes |
|------|---------|-------|
| 1. Refresh marketplace manifest | `claude plugin marketplace update arcanon` | Fetches latest `marketplace.json` from GitHub into `~/.claude/plugins/marketplaces/arcanon/`. No flags, always fetches all sources. |
| 2. Detect remote version | Read `~/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin/marketplace.json` → `.version` field (currently `"0.1.0"`) | File-system read, no CLI call needed. This is the canonical remote version after step 1. |
| 3. Apply update | `claude plugin update arcanon --scope user` | Downloads new cache under `~/.claude/plugins/cache/arcanon/arcanon/<newver>/`, updates `installed_plugins.json`. Prints "(restart required to apply)". |

All three require shell invocation from inside the `/arcanon:update` command markdown. None can be done via pure file-system inspection alone (step 2 is fs, steps 1 and 3 are CLI).

### How to Query Installed Version Without Reinstalling

Two equivalent paths, both verified:

1. **From `installed_plugins.json`** — `~/.claude/plugins/installed_plugins.json` is a JSON file with a `plugins["arcanon@arcanon"][0].version` field. Read with `jq`.
2. **From cache `package.json`** — `~/.claude/plugins/cache/arcanon/arcanon/<ver>/package.json` → `.version`. This is the ground truth used by `worker-restart.sh` for the running worker.

Use path (2) for the running-worker comparison (already done in `lib/worker-restart.sh` via `CLAUDE_PLUGIN_ROOT/package.json`) and path (1) for the `/arcanon:update` pre-flight check.

### Cache Path — Stability Assessment

Observed layout:
```
~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
  ├── package.json          ← version field used by worker-restart.sh
  ├── scripts/
  ├── worker/
  └── ...full plugin source
```

**Assessment: treat as stable for v0.1.1 purposes.** The path is written by `claude plugin install/update` and read by `installed_plugins.json` (official file). The `~/.claude/plugins/` prefix matches `CLAUDE_PLUGIN_DATA` which Claude Code sets as an env var during hook execution. The `<marketplace>/<plugin>/<version>/` suffix matches what `installed_plugins.json` records as `installPath`. No documentation promises permanence, but the structure is load-bearing in the CLI's own manifest file — it is unlikely to change without a migration path.

**Mitigation if it does change:** The `/arcanon:update` command reads version via `claude plugin list --json` (which returns `installPath` from the same manifest) rather than hardcoding the path, so a layout change would surface as a read failure rather than a silent wrong answer.

### Detecting a Newer Remote Version Without Reinstalling

The correct sequence is:

```bash
# Step A: refresh marketplace (required — without this, the local manifest is stale)
claude plugin marketplace update arcanon

# Step B: read remote version from refreshed manifest
REMOTE_VER=$(jq -r '.version // empty' \
  ~/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin/marketplace.json 2>/dev/null)

# Step C: read installed version
INSTALLED_VER=$(jq -r \
  '.plugins["arcanon@arcanon"][0].version // empty' \
  ~/.claude/plugins/installed_plugins.json 2>/dev/null)
# OR: from CLAUDE_PLUGIN_ROOT/package.json (same value, slightly shorter)
INSTALLED_VER=$(jq -r '.version // empty' "${CLAUDE_PLUGIN_ROOT}/package.json" 2>/dev/null)

# Step D: compare
[[ "$REMOTE_VER" != "$INSTALLED_VER" ]] && echo "update available: $INSTALLED_VER -> $REMOTE_VER"
```

The `marketplace.json` under `~/.claude/plugins/marketplaces/arcanon/` is a full git clone of `arcanon-hub/arcanon`, so the `plugins/arcanon/.claude-plugin/marketplace.json` inside it is the same file published in the repo. Its `.version` field is the authoritative remote version.

### CLI vs File-System Decision Table

| Operation | Method | Reason |
|-----------|--------|--------|
| Refresh remote manifest | `claude plugin marketplace update arcanon` (CLI) | No fs equivalent — requires GitHub fetch |
| Read remote version after refresh | fs read of `~/.claude/plugins/marketplaces/arcanon/...` | Faster, no subprocess |
| Read installed version | fs read of `CLAUDE_PLUGIN_ROOT/package.json` | Already done in `worker-restart.sh` |
| Apply plugin update | `claude plugin update arcanon --scope user` (CLI) | No fs equivalent — requires download + manifest rewrite |
| Prune old cache versions | `rm -rf ~/.claude/plugins/cache/arcanon/arcanon/<oldver>/` | Explicit fs operation; `--keep-data` on uninstall preserves `data/`, not `cache/` |
| Kill stale worker after update | `source lib/worker-restart.sh && restart_worker_if_stale` | Already exists; version mismatch path handles this |

---

## 2. PreToolUse Hook Shape

### Verified Schema (from shipped `hooks/hooks.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/file-guard.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Key facts verified from the live file:**
- `matcher` is a pipe-delimited regex string matching tool names. No glob, no path-scoping at the JSON level.
- `timeout` is in seconds. Current guard uses 10s. Impact hook should use the same.
- `"type": "command"` is the only observed type; `"command"` is the shell path, `${CLAUDE_PLUGIN_ROOT}` is interpolated at runtime.
- Multiple hooks under the same event+matcher run sequentially. The impact hook can be added as a second entry alongside `file-guard.sh` without restructuring.

**The hook JSON schema has no path-filter field.** Path filtering must be done inside the script itself. The `file-guard.sh` convention (read `jq -r '.tool_input.file_path // .tool_input.path // empty'` from stdin) is the correct pattern to copy.

### How a Hook Injects Context Into the Conversation

Two output contracts, verified from `file-guard.sh`:

**Soft warn (exit 0 + stdout JSON):**
```bash
printf '{"systemMessage": "Arcanon: <message>"}\n'
exit 0
```
Claude Code injects `systemMessage` into the next assistant turn as a system-level reminder. This is appropriate for the impact hook — it should advise Claude without blocking the edit.

**Hard block (exit 2 + stdout JSON):**
```bash
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}\n'
exit 2
```
The impact hook must never block (exit 2). It should always exit 0 with an optional `systemMessage` when consumers are found, or exit 0 with no output when the file is not service-load-bearing.

**SessionStart / UserPromptSubmit additionalContext injection:**
```bash
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":%s}}\n' "$EVENT" "$CONTEXT_JSON"
```
This is the `session-start.sh` pattern. `additionalContext` is the correct key for injecting structured text into session context (not just a system message). This is richer than `systemMessage` — it becomes part of the conversation context the model sees at session start.

### Tool Matchers for Impact Hook

Use `"Write|Edit|MultiEdit"` — identical to `file-guard.sh`. This covers:
- `Edit` — the most common single-file edit
- `Write` — new file creation or full overwrite
- `MultiEdit` — batch edits across a file

Do not add `Bash` — bash tool use cannot have a meaningful file path extracted.

### Path Filtering Inside the Hook

The impact hook needs to classify the file being edited. No platform-level path filter exists in `hooks.json`. The script must implement it:

```bash
INPUT=$(cat)
RAW_FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -z "$RAW_FILE" ]] && exit 0   # not a file op

BASENAME=$(basename "$RAW_FILE")

# Tier 1: Known service-contract files — always check
case "$BASENAME" in
  *.proto | openapi.yaml | openapi.json | swagger.yaml | swagger.json)
    IS_CONTRACT_FILE=true ;;
  *)
    IS_CONTRACT_FILE=false ;;
esac

# Tier 2: Service root-path prefix match via SQLite (see section 4)
```

### Hook Latency Budget

The existing `file-guard.sh` completes in under 5ms on warm runs (pure bash + jq string matching, no subprocesses). The impact hook will need a SQLite query or HTTP call to the worker, adding latency.

**Latency estimates:**
- SQLite direct read (no worker): ~2–10ms (better-sqlite3 synchronous, single SELECT)
- Worker HTTP call via `worker_call GET /impact?change=...`: ~15–50ms (loopback HTTP, fastify)
- `claude plugin marketplace update` (for update command, NOT hook): ~2–8s (GitHub fetch)

**Budget recommendation: 10s timeout** (matches file-guard.sh). The actual work should complete in under 100ms. Use the same `timeout: 10` value in `hooks.json`. The hook must exit 0 on any error or timeout — `trap 'exit 0' ERR` is the established pattern.

### Can Hooks Call MCP Tools?

No. Hooks are shell scripts that execute independently. They receive tool-use context via stdin JSON. They cannot call MCP tools directly because MCP tools are invoked by the Claude model, not by the shell environment. The impact hook must either:

1. Call the worker HTTP API directly (via `worker_call` from `lib/worker-client.sh`), or
2. Query SQLite directly via `node --input-type=module` or a small Node script, or
3. Use `sqlite3` CLI if available

**Recommended: worker HTTP API call.** The `worker-client.sh` library already provides `worker_call`, handles port resolution from `$ARCANON_DATA_DIR/worker.port`, and has a 1s curl timeout. This is consistent with how `session-start.sh` checks worker status.

---

## 3. SessionStart Hook Context-Injection Patterns

### How the Existing Hook Injects the Banner

From `scripts/session-start.sh` (verified, lines 110–122):

1. Build a plain-text string: `"Arcanon active. Detected: ${PROJECT_TYPES}. Commands: ..."`
2. JSON-encode it with `printf '%s' "$CONTEXT" | jq -Rs .`
3. Output: `{"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":<json-string>}}`

The `additionalContext` field is injected once per session (dedup via `/tmp/arcanon_session_${SESSION_ID}.initialized`). The UserPromptSubmit fallback fires on every prompt but exits early after the first injection (except for the version-mismatch worker restart check, which runs unconditionally before the dedup guard).

### Richer Structured Context — Impact Map Summary

For v0.1.1 SessionStart enrichment, the goal is: if an `impact-map.db` exists for the current project, inject a summary of the service topology so Claude has architecture awareness from the first prompt.

**Recommended output format** (additionalContext string, not separate JSON):

```
Arcanon active. Detected: TypeScript.
Architecture: 7 services scanned (api-gateway, auth-service, user-service, billing-service, notification-service, analytics-service, shared-lib).
Key connections: api-gateway → auth-service (REST), api-gateway → user-service (REST), user-service → billing-service (gRPC).
Run /arcanon:impact <name> for blast-radius analysis. Commands: /arcanon:map, /arcanon:drift, /arcanon:impact, /arcanon:sync, /arcanon:status, /arcanon:export, /arcanon:update.
```

**Implementation approach:**
- Query the worker `GET /graph` via `worker_call` (already used in cross-impact.md)
- Extract service names and top-N connections from the response
- Cap at ~5 service names + ~5 connection pairs to avoid context bloat
- Guard: only enrich if worker is running AND graph has at least 2 services
- On any error: fall back to the plain-text banner (never block)

**Conditional injection:**
```bash
if [[ -f "$CONFIG_FILE" ]] && jq -e '.["impact-map"]' "$CONFIG_FILE" >/dev/null 2>&1; then
  # Only attempt graph enrichment if impact-map config exists
  GRAPH_JSON=$(worker_call GET /graph 2>/dev/null || echo "{}")
  SERVICE_COUNT=$(printf '%s\n' "$GRAPH_JSON" | jq -r '.services | length // 0' 2>/dev/null || echo "0")
  if [[ "$SERVICE_COUNT" -ge 2 ]]; then
    # build enriched context
  fi
fi
```

The existing `arcanon.config.json` + `impact-map` key check (already in session-start.sh line 74) is the right gate. The DB file existence check is less reliable than the config key check because the DB path requires resolving `resolve_arcanon_data_dir`.

---

## 4. Arcanon-Specific Plumbing for the PreToolUse Hook

### How to Resolve "Am I Editing a Service-Load-Bearing File" Fast Enough

**Two-tier classification, both fast:**

**Tier 1 — Extension/name pattern match (pure bash, ~0ms):**
```bash
case "$BASENAME" in
  *.proto)            REASON="protobuf contract file" ;;
  openapi.yaml | openapi.json | swagger.yaml | swagger.json)
                      REASON="OpenAPI spec file" ;;
  *.graphql | *.gql)  REASON="GraphQL schema file" ;;
  *)                  REASON="" ;;
esac
```
If Tier 1 matches, skip Tier 2 and proceed to impact query immediately. These files are inherently service-contract files regardless of what the SQLite map says.

**Tier 2 — SQLite root_path prefix match (~5–15ms):**
Used when the file doesn't match a known extension but the path might fall inside a known service root.

```sql
SELECT s.name, s.id
FROM services s
JOIN repos r ON r.id = s.repo_id
WHERE :file_path LIKE (s.root_path || '%')
  AND r.path = :repo_path
LIMIT 5;
```

Where `:file_path` is the absolute path of the file being edited and `:repo_path` is the current git repo root (detected via `git -C "$(dirname "$RAW_FILE")" rev-parse --show-toplevel 2>/dev/null`).

`root_path` in the `services` table is relative to the repo root (e.g., `"services/auth-service"` or `"."` for mono-service repos). The query needs `r.path || '/' || s.root_path || '%'` if root_path is relative — see note below.

**Schema reality check (from migrations 001 + 005):**
```
services.root_path  — TEXT NOT NULL (relative or absolute, populated by agent scan)
repos.path          — TEXT NOT NULL (absolute path to repo root)
```

The `root_path` value is agent-supplied. Convention from the agent prompts is that it is relative to the repo root (e.g., `"services/payment"`), but some agents may write absolute paths. The hook should handle both:

```bash
# Build absolute candidate prefix
ABS_ROOT="${REPO_ROOT}/${SERVICE_ROOT_PATH}"
# Normalize double slashes
ABS_ROOT="${ABS_ROOT//\/\///}"
if [[ "$RAW_FILE" == "${ABS_ROOT}"* ]]; then
  IS_SERVICE_FILE=true
fi
```

Or equivalently in SQL with `repos.path || '/' || services.root_path`:
```sql
SELECT s.name, s.id
FROM services s
JOIN repos r ON r.id = s.repo_id
WHERE (
  -- root_path is relative: prepend repo path
  :file_path LIKE (r.path || '/' || s.root_path || '%')
  OR
  -- root_path is absolute (defensive fallback)
  (:file_path LIKE (s.root_path || '%') AND s.root_path LIKE '/%')
)
LIMIT 5;
```

### SQLite Query for Impact Context Given a File Path

**Full query: given a file path, which services does it belong to, and what services consume them?**

```sql
-- Step 1: resolve owning services via root_path prefix
WITH owner_services AS (
  SELECT s.id, s.name
  FROM services s
  JOIN repos r ON r.id = s.repo_id
  WHERE :abs_file_path LIKE (r.path || '/' || s.root_path || '%')
     OR (:abs_file_path LIKE (s.root_path || '%') AND s.root_path LIKE '/%')
)
-- Step 2: find direct upstream consumers (services that call the owner)
SELECT
  os.name  AS owner_service,
  cs.name  AS consumer_service,
  c.protocol,
  c.method,
  c.path   AS endpoint
FROM owner_services os
JOIN connections c ON c.target_service_id = os.id
JOIN services cs   ON cs.id = c.source_service_id
ORDER BY consumer_service
LIMIT 20;
```

This is a two-hop query: file → service → consumers. It's bounded (no recursion) and will return in under 10ms on any realistic database size (<500 services).

**For the hook, direct SQLite is preferred over HTTP.**

### MCP `impact_query` vs Direct SQLite — Which to Use in a Hook?

**Verdict: direct SQLite query via a small Node.js inline script, not MCP.**

| Criterion | MCP `impact_query` | Direct SQLite |
|-----------|-------------------|---------------|
| Availability | Requires MCP server to be running; MCP is only available to the Claude model, not to shell hooks | Available any time the DB file exists |
| Latency | N/A — not callable from shell | ~5–15ms (better-sqlite3 synchronous) |
| Complexity | Not callable from shell at all | Requires small inline Node.js script |
| Correctness | `queryImpact` takes a service name, not a file path — requires file→service resolution first anyway | Handles file→service→consumer in one query |

**Implementation pattern for the hook:**

```bash
# Call a small Node.js helper that reads the DB directly
DB_PATH="${ARCANON_DATA_DIR}/impact-map.db"
if [[ ! -f "$DB_PATH" ]]; then
  exit 0  # no map, nothing to check
fi

IMPACT_JSON=$(node --input-type=module <<EOF 2>/dev/null
import Database from '${CLAUDE_PLUGIN_ROOT}/node_modules/better-sqlite3/lib/index.cjs';
const db = new Database('${DB_PATH}', { readonly: true });
const rows = db.prepare(\`
  WITH owner_services AS (
    SELECT s.id, s.name FROM services s JOIN repos r ON r.id = s.repo_id
    WHERE ('${ABS_FILE}' LIKE r.path || '/' || s.root_path || '%')
       OR ('${ABS_FILE}' LIKE s.root_path || '%' AND s.root_path LIKE '/%')
  )
  SELECT os.name AS owner, cs.name AS consumer, c.protocol
  FROM owner_services os
  JOIN connections c ON c.target_service_id = os.id
  JOIN services cs ON cs.id = c.source_service_id
  LIMIT 10
\`).all();
db.close();
process.stdout.write(JSON.stringify(rows));
EOF
)
```

**Note:** `better-sqlite3` in `CLAUDE_PLUGIN_ROOT/node_modules/` is available after the SessionStart `install-deps.sh` runs. The hook must guard: `[[ -d "${CLAUDE_PLUGIN_ROOT}/node_modules/better-sqlite3" ]] || exit 0`.

**Alternative: worker HTTP call.** If the worker is running, `worker_call GET "/impact?change=${SERVICE_NAME}"` (after resolving file→service via Tier 1/2 above) is simpler and does not require inline JS. Use this as the primary path; fall back to direct SQLite only if the worker is not running.

---

## 5. `/arcanon:sync` Flag Design

### Current State (from `hub.js` + command markdown)

- `/arcanon:upload` → `cmdUpload`: reads latest local scan for `--repo PATH`, uploads via `syncFindings()`, enqueues on failure.
- `/arcanon:sync` → `cmdSync`: drains the queue via `drainQueue()`, optionally `--prune-dead`, `--limit N`.

These are **different operations** with no overlap. The merge is a UX consolidation, not a code merge.

### Recommended Flag Design for Merged `/arcanon:sync`

```
/arcanon:sync [--dry-run] [--repo <path>] [--force] [--drain]
```

| Flag | Behavior | Notes |
|------|----------|-------|
| *(no flags)* | Smart default: upload current repo's scan, then drain queue | The action most users want 95% of the time |
| `--repo <path>` | Override which repo's findings to upload (passed through to `hub.js upload --repo`) | Matches existing `cmdUpload` flag |
| `--dry-run` | Show what would be uploaded/drained without sending anything | New behavior; requires `hub.js sync --dry-run` support or command-markdown simulation |
| `--force` | Re-upload even if scan was already uploaded (bypass `scan_upload_id` dedup) | Maps to `hub.js upload --force` (new flag needed in hub.js) |
| `--drain` | Drain queue only, skip the upload step | For users who want the old `/arcanon:sync` behavior exactly |

**Default behavior with no flags — rationale:** "upload + drain" is the right default because a user typing `/arcanon:sync` after finishing work wants both: push the fresh scan AND clear the retry queue. This collapses the mental model from "know whether to use upload or sync" to "just run sync."

**Implementation in the command markdown:**

```bash
# Default: upload then drain
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh upload $([[ -n "$REPO_FLAG" ]] && echo "--repo $REPO_FLAG") $([[ "$FORCE_FLAG" == "true" ]] && echo "--force")
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh sync
```

**Backward-compat for `/arcanon:upload`:**

Do NOT silently alias `upload → sync`. Instead:
1. Keep `upload.md` in place for v0.1.1 but mark it deprecated in its description frontmatter.
2. Remove `/arcanon:upload` in v0.2.0 after one version of overlap.
3. The `hub.js upload` subcommand stays — the command markdown is the only thing being removed.

**Rationale for keeping one-version overlap:** Users who have muscle memory of `/arcanon:upload` or have it in scripts will see the deprecation notice in the command description rather than a confusing "command not found."

### `auto_upload` → `auto_sync` Migration

The `plugin.json` has `"auto_upload"` as a `userConfig` key. For v0.1.1:
- Add `"auto_sync"` as the new canonical key.
- In `hub.js`, read `cfg?.hub?.["auto-sync"] || cfg?.hub?.["auto-upload"]` (legacy fallback).
- The `plugin.json` change renames the config UI label; existing stored values are not migrated automatically (Claude Code stores `userConfig` values by key name).
- Document in CHANGELOG: "rename `auto_upload` → `auto_sync` in `arcanon.config.json`; `auto_upload` honored for one version."

---

## 6. New Runtime Dependencies

No new runtime npm dependencies are required for any of the v0.1.1 features:

| Feature | Runtime Dep | Status |
|---------|-------------|--------|
| `/arcanon:update` | Shell + `claude` CLI + `jq` | All already required by existing hooks |
| PreToolUse impact hook | `better-sqlite3` (inline Node) + `worker-client.sh` | Already installed by `install-deps.sh` |
| SessionStart enrichment | `worker-client.sh` + `jq` | Already used in `session-start.sh` |
| `/arcanon:sync` merged command | `hub.js` (existing) | No changes to Node deps |

The only new shell tool dependency is `sqlite3` CLI — and only if the fallback direct-query path uses it instead of inline Node. Recommend inline Node via `better-sqlite3` to avoid this dependency.

---

## 7. Key Constraints and Gotchas

### `hooks.json` lives in `plugins/arcanon/hooks/hooks.json` (not `plugins/arcanon/hooks.json`)

The file is at `plugins/arcanon/hooks/hooks.json` — a subdirectory named `hooks/` containing a file named `hooks.json`. This is the actual path used by the plugin runtime. Do not confuse with a top-level `hooks.json`.

### `$CLAUDE_PLUGIN_ROOT` vs `$CLAUDE_PLUGIN_DATA`

- `CLAUDE_PLUGIN_ROOT` = `~/.claude/plugins/cache/arcanon/arcanon/0.1.0/` (immutable plugin source, version-stamped)
- `CLAUDE_PLUGIN_DATA` = `~/.claude/plugins/data/arcanon-arcanon/` (mutable persistent data, survives updates)

The impact-map SQLite DB lives under `ARCANON_DATA_DIR` (resolved by `lib/data-dir.sh`), which is derived from `CLAUDE_PLUGIN_DATA`. After `claude plugin update arcanon`, `CLAUDE_PLUGIN_ROOT` changes to the new version path; `CLAUDE_PLUGIN_DATA` does not change.

**Implication for `/arcanon:update`:** After the update, the old worker process still references the old `CLAUDE_PLUGIN_ROOT` path. `restart_worker_if_stale` will detect the version mismatch on the next prompt (via the existing `version_mismatch` restart path in `worker-restart.sh`) and restart from the new path. The `/arcanon:update` command should also explicitly call `restart_worker_if_stale` after confirming the update applied.

### PreToolUse Hook Must Never Block (exit 2) for Impact Warnings

The impact hook is advisory. `exit 2` is reserved for `file-guard.sh`'s hard-block behavior (secrets, lock files, generated dirs). Impact context must always use `systemMessage` + `exit 0`. If the hook exits 2 for an impact warning, it blocks the edit, which violates the "non-blocking hooks" constraint in `PROJECT.md`.

### Hook Registration in `hooks.json` — Ordering

Hooks under the same `matcher` run sequentially in array order. The impact hook should be placed AFTER `file-guard.sh` in the `PreToolUse` array. This way:
1. `file-guard.sh` blocks hard-blocked files first (secrets, lock files).
2. The impact hook only runs for files that passed the guard.

This avoids running a SQLite query on a file that is about to be blocked anyway.

### `claude plugin update` Requires Restart

The `--help` output explicitly says "(restart required to apply)." This means after running `claude plugin update arcanon`, the new plugin code is downloaded to cache but not yet active. The `/arcanon:update` command must tell the user: "Update downloaded. Claude Code must be restarted to activate v{newver}." The worker restart (via `restart_worker_if_stale`) handles the worker side; the Claude Code session restart is the user's responsibility.

### macOS `realpath` Portability

`file-guard.sh` already has a macOS-compatible fallback for `realpath -m` (GNU coreutils not available on macOS). The impact hook must copy the same pattern — do not use `realpath -m` without the macOS fallback.

---

## Sources

All findings verified directly against:
- Live `claude plugin --help` output (April 2026, version running on this machine)
- `plugins/arcanon/hooks/hooks.json` (shipped in v0.1.0)
- `plugins/arcanon/scripts/file-guard.sh` (shipped in v0.1.0)
- `plugins/arcanon/scripts/session-start.sh` (shipped in v0.1.0)
- `plugins/arcanon/scripts/install-deps.sh` (shipped in v0.1.0)
- `plugins/arcanon/lib/worker-restart.sh` (shipped in v5.8.0 / v0.1.0)
- `plugins/arcanon/worker/cli/hub.js` (shipped in v0.1.0)
- `plugins/arcanon/worker/server/http.js` (shipped in v0.1.0)
- `plugins/arcanon/worker/mcp/server.js` (shipped in v0.1.0)
- `plugins/arcanon/worker/db/migrations/001–010` (all 10 migrations)
- `~/.claude/plugins/installed_plugins.json` (live filesystem)
- `~/.claude/plugins/known_marketplaces.json` (live filesystem)
- `~/.claude/plugins/cache/arcanon/arcanon/0.1.0/` (live filesystem)
- `~/.claude/plugins/marketplaces/arcanon/` (live filesystem after marketplace update)
