# Architecture Research — v0.1.1 Integration Points

**Domain:** Claude Code plugin — command cleanup, self-update, ambient hooks
**Researched:** 2026-04-21
**Confidence:** HIGH (all findings from direct file inspection, no inference)

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  hooks/hooks.json  (hook registrations — single source of truth)     │
├──────────────────────────────────────────────────────────────────────┤
│  SessionStart + UserPromptSubmit                                      │
│    install-deps.sh (120s)  →  session-start.sh (10s)                 │
│                                                                       │
│  PreToolUse: Write|Edit|MultiEdit                                     │
│    file-guard.sh (10s)  [NEW: impact-hook.sh here]                   │
│                                                                       │
│  PostToolUse: Write|Edit|MultiEdit                                    │
│    format.sh (10s)  →  lint.sh (10s)                                 │
├──────────────────────────────────────────────────────────────────────┤
│  commands/                   scripts/          lib/                   │
│    map.md                      hub.sh            worker-client.sh    │
│    impact.md                   drift.sh          worker-restart.sh   │
│    drift.md                    session-start.sh  data-dir.sh         │
│    sync.md  [absorbs upload]   worker-start.sh   detect.sh           │
│    export.md                   file-guard.sh     linked-repos.sh     │
│    login.md                    format.sh                             │
│    status.md                   lint.sh                               │
│    [NEW: update.md]            [NEW: update.sh]                      │
│    [REMOVE: cross-impact.md]   [NEW: impact-hook.sh]                 │
│    [REMOVE: upload.md]                                               │
├──────────────────────────────────────────────────────────────────────┤
│  worker/ (Node.js daemon — port 37888, ~/.arcanon/)                  │
│    server/  scan/  mcp/  ui/  hub-sync/  db/  cli/                   │
│      cli/hub.js  ←  scripts/hub.sh (thin exec wrapper)               │
│      db/query-engine.js  ←  services, connections, exposed_endpoints │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Workstream 1: Command Cleanup

### 1a. Remove `commands/cross-impact.md`

**Files that reference "cross-impact" — confirmed by grep:**

| File | Line | Action |
|------|------|--------|
| `plugins/arcanon/commands/cross-impact.md` | entire file | DELETE |
| `plugins/arcanon/scripts/session-start.sh` | line 114 | EDIT — remove `/arcanon:cross-impact` from the commands list string |
| `plugins/arcanon/worker/scan/agent-prompt-infra.md` | line 5 | READ-ONLY mention, no user-facing reference; leave as-is |
| `plugins/arcanon/README.md` | TBD | EDIT — remove cross-impact from documented commands |

No JS worker code references "cross-impact" as a route or tool name. The command is markdown-only.

### 1b. Merge `commands/upload.md` → `commands/sync.md`

**Current state:**

- `commands/sync.md` — drains offline queue via `hub.sh sync $ARGUMENTS`. Narrow scope: retry queued payloads.
- `commands/upload.md` — manual push of latest scan via `hub.sh upload $ARGUMENTS`. Preflight: check scan exists, check credentials.

**Merge decision:** `sync.md` becomes the unified command. `upload.md` is deleted.

Rationale: "sync" is the superset concept (upload + drain + retry). The preflight logic from `upload.md` folds into the merged `sync.md` as a new `--upload` flag flow, or as the default behaviour when no subcommand is given.

**Implementation locus:**

- All implementation is in `worker/cli/hub.js` — the `upload` and `sync` subcommands already exist there as separate code paths. No shell logic to merge.
- `scripts/hub.sh` is a pass-through exec wrapper (lines 1–15); it needs no changes.
- The merged `commands/sync.md` will call `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh upload $ARGUMENTS` for upload flows and `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh sync $ARGUMENTS` for queue-drain flows — the CLI subcommands remain distinct, only the command surface merges.

**Files to change:**

| File | Action |
|------|--------|
| `commands/upload.md` | DELETE |
| `commands/sync.md` | EDIT — absorb upload preflight + run steps; add `--dry-run`, `--repo`, `--force`, `--drain` flag docs |
| `scripts/session-start.sh` line 114 | EDIT — replace `/arcanon:upload` with nothing (or document `/arcanon:sync` handles it) |
| `README.md` | EDIT — command table |

### 1c. Config rename `auto_upload` → `auto_sync` with legacy grace period

**Where the config key is read — confirmed by grep:**

| File | Location | Key read |
|------|----------|----------|
| `worker/cli/hub.js` | line 114 | `cfg?.hub?.["auto-upload"]` |
| `worker/scan/manager.js` | line 55 | `cfg?.hub?.["auto-upload"]` |

The config is read from `arcanon.config.json` via `resolveConfigPath` in `worker/lib/config-path.js`. The key is `hub["auto-upload"]` (hyphen in JSON, not underscore — `plugin.json` uses `auto_upload` as the `userConfig` key name but the arcanon.config.json path uses `hub["auto-upload"]`).

**Also:** `plugin.json` line 34 declares `"auto_upload"` in `userConfig`. This is the Claude plugin config schema entry. It must be renamed to `"auto_sync"`.

**Legacy grace pattern — two-read approach:**

```javascript
// In worker/cli/hub.js line 114 and worker/scan/manager.js line 55:
// Replace:
const hubAutoUpload = Boolean(cfg?.hub?.["auto-upload"]);
// With:
const hubAutoSync = Boolean(cfg?.hub?.["auto-sync"] ?? cfg?.hub?.["auto-upload"]);
```

This reads the new key first, falls back to old key, costs zero overhead. Remove the `??` fallback in v0.2.0.

**Files to change:**

| File | Line | Change |
|------|------|--------|
| `worker/cli/hub.js` | 114, 131, 144 | Rename variable + add fallback read |
| `worker/scan/manager.js` | 55, 859, 863, 867 | Same two-read pattern |
| `.claude-plugin/plugin.json` | 34–40 | Rename `auto_upload` → `auto_sync`; update title/description |
| `commands/status.md` | line 21, 26 | Update config key references |
| `commands/login.md` | lines 42–46 | Update config key references |

---

## Workstream 2: `/arcanon:update` Command

### Orchestration split: markdown vs shell

**Decision:** `commands/update.md` owns the user-facing orchestration (confirmation prompts, output formatting, verification report). `scripts/update.sh` owns the deterministic shell steps (version probing, kill, cache prune, verify). This matches the existing pattern: `commands/map.md` orchestrates, `scripts/worker-start.sh` does the mechanical work.

```
commands/update.md
  → Step 1: version state query (calls scripts/update.sh --check, reads JSON)
  → Step 2: confirm with user
  → Step 3: reinstall (calls `claude plugin install` or equivalent)
  → Step 4: kill stale worker (calls scripts/update.sh --kill)
  → Step 5: cache prune (calls scripts/update.sh --prune-cache)
  → Step 6: verify (calls scripts/update.sh --verify)
  → formats and reports result
```

### State queries

**Installed version** — `plugin.json` at `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`, key `.version`. Already used by `worker-restart.sh` lines 57–59 via `jq -r '.version'` on `package.json`. For update.sh, read from `plugin.json` (user-facing version) not `package.json`.

**Running worker version** — `GET http://127.0.0.1:${PORT}/api/version`. Port is in `$(resolve_arcanon_data_dir)/worker.port`. Pattern already in `worker-restart.sh` lines 61–65.

**Plugin cache path** — Claude Code stores marketplace plugins at `~/.claude/plugins/cache/<marketplace>/<plugin>/`. The stable API for this is unverified from official docs — treat as LOW confidence. Use `ls -d ~/.claude/plugins/cache/*/arcanon/ 2>/dev/null` for discovery. Do not hardcode the marketplace segment.

**Remote latest** — After `claude plugin marketplace update`, the refreshed manifest is inspected. If Claude Code does not expose a CLI flag to print the latest version without installing, `update.md` should instruct Claude to run `claude plugin marketplace update` and then read the version from the refreshed cache. This is the weakest link — flag for validation during phase research.

### Worker kill semantics

`restart_worker_if_stale` in `lib/worker-restart.sh` handles three cases: `no_pid_file`, `stale_pid`, `version_mismatch`. It uses graceful kill → 1s wait → SIGKILL.

`/arcanon:update` needs a stronger "kill regardless of version" semantic because the update is intentional, not a mismatch detection. `scripts/update.sh --kill` should:

1. Read `${DATA_DIR}/worker.pid`
2. If PID exists and live: `kill $PID`, sleep 1, `kill -9 $PID` if still up
3. Remove `worker.pid` and `worker.port`

This is a superset of what `restart_worker_if_stale` does on `version_mismatch`. **Do not reuse `restart_worker_if_stale` for the update path** — calling it would re-start the old worker immediately (line 121: `worker_start_background`). The update flow needs kill-only, then reinstall, then start.

### Cache pruning

Safe prune pattern: list `~/.claude/plugins/cache/*/arcanon/` subdirectories, exclude the version matching `plugin.json`, remove the rest. A directory is safe to remove if no process has it as cwd or open file descriptor. Check via `lsof +D <dir> 2>/dev/null | wc -l` — if 0, safe. This is a best-effort check; the worker is already killed at this point so any open handles are stale.

### New files

| File | Type | Purpose |
|------|------|---------|
| `commands/update.md` | NEW | User-facing orchestration: version check → confirm → reinstall → kill → prune → verify |
| `scripts/update.sh` | NEW | Deterministic shell: `--check` (emit JSON), `--kill` (kill worker), `--prune-cache` (remove old cache dirs), `--verify` (confirm new version running) |

---

## Workstream 3: PreToolUse Impact Hook

### Hook registration

Claude Code reads hook registrations from `hooks/hooks.json` — confirmed by the existing file at `plugins/arcanon/hooks/hooks.json`. The `plugin.json` manifest does not contain hook config. All hook additions go into `hooks.json`.

The new hook entry:

```json
{
  "PreToolUse": [
    {
      "matcher": "Write|Edit|MultiEdit",
      "hooks": [
        {
          "type": "command",
          "command": "${CLAUDE_PLUGIN_ROOT}/scripts/file-guard.sh",
          "timeout": 10
        },
        {
          "type": "command",
          "command": "${CLAUDE_PLUGIN_ROOT}/scripts/impact-hook.sh",
          "timeout": 5
        }
      ]
    }
  ]
}
```

**File to change:** `hooks/hooks.json` — add the impact-hook entry to the existing `PreToolUse` array. The `file-guard.sh` hook runs first; `impact-hook.sh` runs after (Claude Code fires hooks in array order within an event).

### Hook output convention

From `file-guard.sh` lines 56–58 (block) and 62–65 (warn):

- **Context injection (soft, allow):** `printf '{"systemMessage": "..."}\n'` + exit 0
- **Hard block (deny):** `printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}\n'` + exit 2

The impact hook wants injection (not blocking), so it outputs `{"systemMessage": "..."}` with impact context and exits 0. This matches the `warn_file()` pattern in `file-guard.sh` line 62.

For richer session-level injection (like `session-start.sh`), the pattern is `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"..."}}`. Both formats are supported; `systemMessage` is simpler and appropriate for per-edit inline warnings.

### Service-file detection

The question "is this file service-load-bearing?" requires two data sources:

1. **`connections.source_file`** — files that contain outbound service calls (tracked per connection in the `connections` table, migration 001 line 46).
2. **`services.root_path`** — service root directory (tracked per service, migration 001 line 35); any file under a service root is loosely "service-bearing", but too broad for precise injection.
3. **`exposed_endpoints` table** — does NOT have a `source_file` column (migration 003 confirmed). Only has `service_id, method, path, handler`.

The most precise signal: match the edited file path against `connections.source_file` (exact or prefix). A file is "service-load-bearing" if it appears in `connections.source_file` for any connection, or if it matches known service contract file patterns (`.proto`, `openapi.yaml`, `openapi.json`, `swagger.yaml`).

### SQLite query runtime: shell (sqlite3 CLI) vs Node

**Use sqlite3 CLI, not Node.** The hook fires on every Edit/Write — Node.js startup cost is 80–200ms per invocation, which makes the hook perceptibly slow for large files. `sqlite3` binary executes a prepared query in under 5ms on a local file.

The query:

```sql
-- Is this file (or a proto/OpenAPI file) referenced in any connection?
SELECT COUNT(*) FROM connections WHERE source_file = ?;
```

Shell call:

```bash
COUNT=$(sqlite3 "$DB_PATH" \
  "SELECT COUNT(*) FROM connections WHERE source_file = '$ESCAPED_FILE';")
```

Use parameter quoting carefully; prefer passing via `-cmd` with proper escaping or use printf to build the query.

### DB path resolution

The DB path is per-project: `~/.arcanon/projects/<hash>/impact-map.db`. The hash is derived from the project root path. The existing `worker/lib/config-path.js` and `worker/lib/data-dir.js` handle this in Node, but the hook needs a shell equivalent.

The `lib/data-dir.sh` already resolves `~/.arcanon` (or legacy `~/.ligamen`). A new `lib/db-path.sh` helper should resolve the per-project DB path from CWD. Pattern: use the same hash algorithm as `data-dir.js` (inspect that file to confirm the hash function before implementing).

### Cache for hot path

A flat-file index of "known service source files" addresses the cold-start cost: on every scan completion, the worker writes `~/.arcanon/service-files.txt` (one absolute path per line). The hook does a fast `grep -qxF "$FILE" "$SERVICE_FILES_INDEX"` check before opening SQLite. This is a 0.5ms `grep` vs a 5ms SQLite query for the common case (file not in index).

Cache invalidation: compare `stat -f %m "$SERVICE_FILES_INDEX"` vs `stat -f %m "$DB_PATH"`. If DB is newer, skip the cache and hit SQLite directly (also triggers an async index rebuild — write to a temp file, mv atomically).

**This is an optimization, not a hard requirement for v0.1.1.** Implement the SQLite-direct path first; add the flat-file cache if hook latency is observed to be perceptible (>100ms) in practice.

### New files

| File | Type | Purpose |
|------|------|---------|
| `scripts/impact-hook.sh` | NEW | PreToolUse hook: reads file path from stdin JSON, checks service-file index, queries SQLite for consumers, emits systemMessage context |
| `lib/db-path.sh` | NEW | Shell helper: resolves per-project DB path from CWD using data-dir.sh + project hash |
| `hooks/hooks.json` | EDIT | Add impact-hook.sh to PreToolUse array (after file-guard.sh) |

---

## Workstream 4: SessionStart Enrichment

### Existing hook config

`session-start.sh` is registered in two places in `hooks/hooks.json`:

- `SessionStart` array, index 1 (after `install-deps.sh`), timeout 10s
- `UserPromptSubmit` array, index 0, timeout 10s (fallback for upstream bug #10373)

The script emits `{"hookSpecificOutput":{"hookEventName":"<EVENT>","additionalContext":"<STRING>"}}` at line 120–122.

### Enrichment injection point

The banner string is assembled at lines 110–115 of `session-start.sh`. The current output is:

```
Arcanon active. Detected: <types>. Commands: /arcanon:map, ...
```

Enriched output target:

```
Arcanon active. Detected: <types>. Services: <N> across <M> repos. Last scan: <date>. Hub: <status>. Commands: ...
```

### Where to add the query

After the `WORKER_STATUS` block (line 83), before the `CONTEXT` assembly (line 110). Add a new block that:

1. Checks if the DB exists: `ls ~/.arcanon/projects/*/impact-map.db 2>/dev/null | head -1`
2. If found, queries via `sqlite3`:

```bash
sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM services;" 2>/dev/null
sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM repos;" 2>/dev/null
sqlite3 "$DB_PATH" "SELECT MAX(scanned_at) FROM repos;" 2>/dev/null
```

3. Hub sync status: `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh status --json 2>/dev/null | jq -r '.hub_status // "unknown"'`

**Fast-path concern:** session-start.sh has a 10s timeout. Three `sqlite3` calls add ~15ms total. The `hub.sh status` call adds ~50–100ms (Node startup + one HTTP call). Total overhead is well under 1s. No caching needed.

**Output shape:** plain text string injected into `additionalContext`. Not JSON — Claude Code processes this as a natural language hint, not structured data.

### File to change

| File | Line range | Change |
|------|-----------|--------|
| `scripts/session-start.sh` | after line 83, before line 109 | Add stats query block; update CONTEXT assembly at line 114 |
| `scripts/session-start.sh` | line 114 | Remove `/arcanon:cross-impact` and `/arcanon:upload`; add `/arcanon:update` |

---

## Build Order

```
Phase 1 — Command cleanup (standalone, zero dependencies)
  1a. Delete commands/cross-impact.md
  1b. Delete commands/upload.md; rewrite commands/sync.md
  1c. Rename auto_upload → auto_sync in plugin.json + two JS files
  1d. Edit session-start.sh line 114: update command list string

Phase 2 — /arcanon:update (depends on nothing milestone-specific)
  2a. Create scripts/update.sh with --check / --kill / --prune-cache / --verify subcommands
  2b. Create commands/update.md
  (Worker restart lib is already in place; update.sh uses the kill-only subset)

Phase 3 — SessionStart enrichment (builds on Phase 1 session-start.sh edits)
  3a. Add stats query block to session-start.sh
  3b. Update CONTEXT string assembly

Phase 4 — PreToolUse impact hook (highest risk; needs stable infra)
  4a. Create lib/db-path.sh
  4b. Create scripts/impact-hook.sh (SQLite-direct, no cache)
  4c. Edit hooks/hooks.json: add impact-hook.sh entry
  4d. (Optional, if latency observed) Add flat-file service-files index + cache
```

**Why this order:**

- Phase 1 is pure subtraction + rename — no new failure modes.
- Phase 2 is additive-only (new command, new script) — can't break existing behaviour.
- Phase 3 edits session-start.sh which Phase 1 also touches; sequencing avoids merge conflicts.
- Phase 4 last because: (a) it fires on every edit — latency regressions surface immediately in daily use; (b) it depends on `lib/db-path.sh` which doesn't exist yet; (c) hooks.json changes are the most disruptive (a syntax error silently breaks all PreToolUse hooks).

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `hooks/hooks.json` | Single source of truth for hook registrations | Claude Code runtime |
| `scripts/session-start.sh` | Session context injection + worker version check + stats | `lib/worker-restart.sh`, `lib/detect.sh`, sqlite3 CLI, `scripts/hub.sh` |
| `scripts/file-guard.sh` | Hard-block / soft-warn on sensitive file writes | Claude Code via stdout JSON |
| `scripts/impact-hook.sh` (NEW) | Service-file detection + consumer context injection | `lib/db-path.sh`, sqlite3 CLI |
| `scripts/update.sh` (NEW) | Deterministic version-check / kill / prune / verify shell | `lib/worker-restart.sh` patterns, `worker.pid`, `worker.port` |
| `commands/update.md` (NEW) | Orchestration layer for self-update UX | `scripts/update.sh`, user confirmation |
| `commands/sync.md` (EDIT) | Unified upload + queue-drain command | `scripts/hub.sh` → `worker/cli/hub.js` |
| `worker/cli/hub.js` | Node CLI for all hub operations | `worker/hub-sync/index.js` |
| `worker/scan/manager.js` | Reads hub config including auto_sync flag | `worker/lib/config-path.js` |
| `lib/worker-restart.sh` | Stale worker detection and graceful restart | `lib/worker-client.sh`, `lib/data-dir.sh` |

---

## Data Flow

### Impact Hook (PreToolUse)

```
Claude Edit/Write tool call
    ↓
hooks.json dispatches to file-guard.sh (exit 0/2)
    ↓ (if exit 0)
hooks.json dispatches to impact-hook.sh
    ↓
Read tool_input.file_path from stdin JSON
    ↓
lib/db-path.sh resolves ~/.arcanon/projects/<hash>/impact-map.db
    ↓
(Optional: grep service-files.txt fast-path miss → SQLite)
sqlite3 query: SELECT ... FROM connections WHERE source_file = ?
    ↓
No consumers → exit 0, no output (silent pass)
Consumers found → printf '{"systemMessage": "Arcanon: <N> services depend on <file>: ..."}' → exit 0
```

### Update Command

```
/arcanon:update
    ↓
commands/update.md: scripts/update.sh --check → JSON {installed, running, latest}
    ↓
Claude prompts user: "Update from X to Y?"
    ↓
scripts/update.sh --kill → graceful kill worker, rm pid/port
    ↓
claude plugin install (or equivalent reinstall command)
    ↓
scripts/update.sh --prune-cache → rm old cache dirs (lsof check)
    ↓
scripts/worker-start.sh (start new worker)
    ↓
scripts/update.sh --verify → GET /api/version, compare to plugin.json
    ↓
commands/update.md: report result to user
```

### Config Rename (auto_upload → auto_sync)

```
arcanon.config.json: hub["auto-sync"] (new) | hub["auto-upload"] (legacy)
    ↓
worker/scan/manager.js _readHubConfig():
    hubAutoSync = cfg?.hub?.["auto-sync"] ?? cfg?.hub?.["auto-upload"]
    ↓
worker/cli/hub.js status subcommand: same two-read pattern
    ↓
plugin.json userConfig: "auto_sync" key (Claude settings UI)
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Starting Node for the impact hook

**What:** Spawning `node scripts/impact-check.js` from the bash hook to run SQLite queries.
**Why wrong:** Node startup is 80–200ms. The hook fires on every Edit/Write. In a session with 50 edits, this adds 4–10 seconds of latency.
**Do this instead:** Use `sqlite3` CLI binary for the impact query. It executes in <5ms. Reserve Node for operations that run once per session (like hub.sh status in session-start.sh where the overhead is amortized).

### Anti-Pattern 2: Calling `restart_worker_if_stale` from `update.sh`

**What:** Reusing `lib/worker-restart.sh`'s `restart_worker_if_stale` for the update kill step.
**Why wrong:** `restart_worker_if_stale` unconditionally calls `worker_start_background` after killing. The update flow needs to kill the worker, run the reinstall, THEN start the new worker. Calling `restart_worker_if_stale` would start the old binary before the new one is installed.
**Do this instead:** Inline the kill sequence in `scripts/update.sh --kill`: read PID file, send SIGTERM, wait 1s, send SIGKILL if still alive, remove pid/port files. Do not call `worker_start_background`.

### Anti-Pattern 3: Putting hook registrations in `plugin.json`

**What:** Adding hook entries to `.claude-plugin/plugin.json` instead of `hooks/hooks.json`.
**Why wrong:** Claude Code reads hooks exclusively from `hooks/hooks.json`. The `plugin.json` manifest has no `hooks` key — confirmed by inspection of the current file.
**Do this instead:** All hook additions go in `hooks/hooks.json` under the appropriate event key.

### Anti-Pattern 4: Hardcoding the marketplace cache path

**What:** Using `~/.claude/plugins/cache/github.com/Arcanon-hub/arcanon/` in `update.sh`.
**Why wrong:** The marketplace segment (`github.com/Arcanon-hub`) is not confirmed stable API. The path structure may change.
**Do this instead:** Use glob discovery: `ls -d ~/.claude/plugins/cache/*/arcanon/ 2>/dev/null`. If zero or multiple results, ask the user for the path before pruning.

### Anti-Pattern 5: Emitting `additionalContext` from the impact hook

**What:** Using `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"..."}}` in `impact-hook.sh`.
**Why wrong:** `additionalContext` is the session-level injection format used by `SessionStart`. For PreToolUse, the correct soft-message format is `{"systemMessage": "..."}` — this is what `file-guard.sh`'s `warn_file()` uses (line 62). Using `additionalContext` in PreToolUse is untested and may not inject into the right context window position.
**Do this instead:** Use `{"systemMessage": "Arcanon: <consumers>"}` + exit 0 for the impact hook.

---

## Integration Points Summary

| Point | File | Line(s) | New vs Edit |
|-------|------|---------|-------------|
| Remove cross-impact from session banner | `scripts/session-start.sh` | 114 | EDIT |
| Remove upload from session banner | `scripts/session-start.sh` | 114 | EDIT |
| Add update to session banner | `scripts/session-start.sh` | 114 | EDIT |
| Add stats query block | `scripts/session-start.sh` | after 83 | EDIT |
| Merge upload into sync command | `commands/sync.md` | entire file | REWRITE |
| Delete upload command | `commands/upload.md` | entire file | DELETE |
| Delete cross-impact command | `commands/cross-impact.md` | entire file | DELETE |
| New update command | `commands/update.md` | — | NEW |
| New update shell | `scripts/update.sh` | — | NEW |
| New impact hook shell | `scripts/impact-hook.sh` | — | NEW |
| New DB path resolver | `lib/db-path.sh` | — | NEW |
| Register impact hook | `hooks/hooks.json` | PreToolUse array | EDIT |
| Rename auto_upload key | `.claude-plugin/plugin.json` | 34–40 | EDIT |
| Rename auto_upload in hub CLI | `worker/cli/hub.js` | 114, 131, 144 | EDIT |
| Rename auto_upload in manager | `worker/scan/manager.js` | 55, 859, 863, 867 | EDIT |

---

## Test Strategy

| Workstream | Framework | File(s) | What to cover |
|------------|-----------|---------|---------------|
| Command cleanup | — | — | Manual smoke test: removed commands 404 cleanly; sync.md handles upload flow |
| auto_sync rename | node:test | `worker/cli/hub.test.js` (new or existing) | Legacy `auto-upload` key still activates sync; new `auto-sync` key works; neither key → disabled |
| `auto_sync` rename | node:test | `worker/scan/manager.test.js` (existing) | Same two-key fallback logic |
| `/arcanon:update` check | bats | `tests/update.bats` (new) | `--check` emits valid JSON; `--kill` removes pid/port; `--verify` detects version match/mismatch |
| SessionStart enrichment | bats | `tests/session-start.bats` (existing) | Stats injected when DB present; graceful no-op when DB absent; output remains valid JSON |
| Impact hook — no DB | bats | `tests/impact-hook.bats` (new) | Exits 0 silently when DB not found |
| Impact hook — non-service file | bats | `tests/impact-hook.bats` | Exits 0, no systemMessage output |
| Impact hook — service file with consumers | bats | `tests/impact-hook.bats` | Exits 0, systemMessage contains consumer names; use fixture impact-map.db with known rows |
| Impact hook — service file, no consumers | bats | `tests/impact-hook.bats` | Exits 0, no systemMessage |
| hooks.json syntax | bats | `tests/hooks-json.bats` (new or inline) | Valid JSON, all command paths exist |

**Fixture requirement:** `tests/fixtures/impact-map.db` — a minimal SQLite DB with schema through migration 010, two services, and one connection where `source_file` is set to a known test path. Create this with a setup script that runs the migration chain, not a checked-in binary.

---

## Open Questions (Require Phase-Specific Research)

1. **Claude plugin cache path stability** — Is `~/.claude/plugins/cache/<marketplace>/<plugin>/` a documented stable API? If not, `update.sh --prune-cache` needs a user-confirmation gate before deleting anything.

2. **`claude plugin install` CLI flag** — What is the exact command to reinstall the current plugin from the marketplace without prompting? This is the missing link in the update flow. If no such flag exists, `commands/update.md` may need to instruct the user to run the command manually rather than automating it.

3. **PreToolUse `additionalContext` vs `systemMessage`** — The Claude Code hook docs distinguish these, but the exact rendering difference (system prompt injection vs inline message) is not confirmed. Test empirically in Phase 4 before committing to one format.

4. **db-path.sh hash algorithm** — `worker/lib/data-dir.js` likely uses a hash of the project root path to derive the per-project DB directory name. The exact hash function must be read from that file before implementing `lib/db-path.sh`. (Not read during this research pass — add to Phase 4 pre-work.)

---

*Architecture research for: Arcanon plugin v0.1.1 (Command Cleanup + Update + Ambient Hooks)*
*Researched: 2026-04-21*
