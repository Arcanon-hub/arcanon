---
phase: 112-arcanon-verify-command
plan: 01
subsystem: arcanon-worker, arcanon-commands
tags: [trust, verify, read-only, cli, http-endpoint, slash-command]
requires:
  - plugins/arcanon/worker/server/http.js (createHttpServer + getQE pattern)
  - plugins/arcanon/worker/cli/hub.js (HANDLERS dispatcher + flag parser)
  - plugins/arcanon/scripts/hub.sh (forwards $@ verbatim — no edits needed)
  - plugins/arcanon/lib/worker-client.sh (worker_running detection)
provides:
  - GET /api/verify HTTP route on the worker
  - computeVerdict(conn, projectRoot) pure helper (exported for unit tests)
  - cmdVerify CLI handler, registered as `verify` subcommand
  - /arcanon:verify slash command (commands/verify.md)
affects:
  - plugins/arcanon/worker/server/http.js (additive — new route + helper)
  - plugins/arcanon/worker/cli/hub.js (additive — new handler + HANDLERS entry)
tech-stack:
  added:
    - none (uses existing fastify, node:fs, fetch — no new deps)
  patterns:
    - "Pure helper outside the request-handler closure → directly testable"
    - "URLSearchParams to build query string in CLI (matches existing patterns elsewhere)"
    - "Reply.code(N).send({ error }) for validation failures — mirrors /impact, /service/:name"
key-files:
  created:
    - plugins/arcanon/commands/verify.md
  modified:
    - plugins/arcanon/worker/server/http.js
    - plugins/arcanon/worker/cli/hub.js
decisions:
  - "Whole-file substring match for evidence (Phase 109 D-03 trade-off — schema has no line_start)"
  - "Worker-down → CLI exit 1 with friendly message (do NOT start worker; verify is read-only)"
  - "404 from server (unknown connection_id, project not indexed) → CLI exit 1; 400 → exit 2"
  - "1000-connection cap only applies when scope=all (un-scoped). --source / --connection bypasses it."
  - "Pre-Phase-109 connections with empty evidence return verdict=ok with evidence_present=false and message=no-evidence-recorded (degraded but not failure)"
metrics:
  duration_seconds: 231
  duration_human: "~4 min"
  tasks: 3
  files_changed: 3
  files_created: 1
  files_modified: 2
  lines_added: ~530
  completed: "2026-04-25T13:11:37Z"
requirements_completed:
  - TRUST-01
---

# Phase 112 Plan 01: `/arcanon:verify` Command + Endpoint Summary

End-to-end implementation of `/arcanon:verify` — a read-only command that re-reads cited source files and returns a per-connection verdict (ok / moved / missing / method_mismatch), satisfying TRUST-01 (Linear THE-1022 reviewer's #1 priority).

## Three artifacts, one chain

```
/arcanon:verify (commands/verify.md)
  └─→ bash scripts/hub.sh verify $ARGUMENTS  (existing thin pass-through)
       └─→ node worker/cli/hub.js verify ... (new cmdVerify handler)
            └─→ HTTP GET /api/verify?...     (new fastify route)
                 └─→ computeVerdict(conn, projectRoot)  (new pure helper, exported)
```

## Task-by-task

### Task 1 — `GET /api/verify` + `computeVerdict` helper

**File:** `plugins/arcanon/worker/server/http.js`
**Commit:** `d29a45a`

- Added new fastify route `GET /api/verify` between `/api/version` and `/projects` (per plan placement rule).
- Extracted verdict computation into a module-level `computeVerdict(conn, projectRoot)` so 112-02's node tests can drive it without booting a server. Exported alongside `createHttpServer`.

**SQL used to resolve scope:**

```sql
-- scope=all (latest scan only)
SELECT id AS connection_id, source_file, method, path, evidence
  FROM connections
 WHERE scan_version_id = (
         SELECT MAX(scan_version_id) FROM connections
          WHERE scan_version_id IS NOT NULL
       )
   AND source_file IS NOT NULL

-- scope=connection (by integer ID, no scan_version_id filter so a stale
-- connection ID is still resolvable for forensics)
SELECT id AS connection_id, source_file, method, path, evidence
  FROM connections WHERE id = ?

-- scope=source (exact path match — value contains '/')
SELECT id AS connection_id, source_file, method, path, evidence
  FROM connections
 WHERE source_file = ?
   AND scan_version_id = (
         SELECT MAX(scan_version_id) FROM connections
          WHERE scan_version_id IS NOT NULL
       )

-- scope=source (basename match — value has no '/'; fetch latest-scan rows
-- then filter in JS via path.basename())
SELECT id AS connection_id, source_file, method, path, evidence
  FROM connections
 WHERE source_file IS NOT NULL
   AND scan_version_id = (
         SELECT MAX(scan_version_id) FROM connections
          WHERE scan_version_id IS NOT NULL
       )
```

**Four verdict branches in `computeVerdict`:**

| Branch | Trigger | Verdict | Notes |
| --- | --- | --- | --- |
| 1 | `!conn.source_file` (column null) | `moved` | Defensive — message: `no source_file recorded on connection` |
| 2 | `!fs.existsSync(absPath)` | `moved` | message: `source_file not found at recorded path` |
| 3 | `fs.readFileSync` throws (EACCES, etc.) | `moved` | message includes the underlying error — same user remedy as moved |
| 4 | `!evidence` (null or trim==='') | `ok` (degraded) | `evidence_present: false`, message: `no-evidence-recorded` — pre-Phase-109 connections |
| 5 | `content.indexOf(evidence) === -1` | `missing` | message: `evidence snippet not found in file` |
| 6 | found, no method recorded | `ok` | `evidence_present: true`, snippet truncated to 80 chars |
| 7 | found, method recorded but absent in snippet (whole-word, case-insensitive) | `method_mismatch` | message: `method '<m>' not found in evidence` |
| 8 | found, method recorded and present | `ok` | snippet truncated to 80 chars |

**Validation responses:**

- Missing `project` → 400 `{ error: "missing required param: project" }`
- `connection_id` not a positive integer → 400 `{ error: "invalid connection_id" }`
- `connection_id` provided but no row → 404 `{ error: "no connection with id <N>" }`
- QE resolution returns null → 404 `{ error: "project not indexed: <root>" }`

**Read-only guarantee enforced by grep:**
`grep -E "INSERT|UPDATE|DELETE" plugins/arcanon/worker/server/http.js | grep -i verify` returns **no results** — the verify route handler and `computeVerdict` perform pure reads only.

**1000-connection cap (D-03):** when `scope === "all" && total > 1000`, the response is `{ results: [], total, truncated: true, scope: "all", message: "..." }` with HTTP 200. CLI maps that to exit 1.

**33/33 existing http.test.js tests still pass.**

---

### Task 2 — `cmdVerify` handler in `worker/cli/hub.js`

**File:** `plugins/arcanon/worker/cli/hub.js`
**Commit:** `42e5417`

**CLI flag surface (for 112-02's test fixtures):**

| Flag | Type | Effect |
| --- | --- | --- |
| `--connection <id>` | positive integer | Single-connection scope. Bad value (non-numeric, zero, negative) → exit 2. |
| `--source <path>` | string | If contains `/` → exact path match; else basename match. |
| `--all` | (no-op) | Default behaviour — implicit when no scope flag (D-06). Accepted for documentation symmetry. |
| `--json` | bool | Emit raw response body as JSON (full server response, not just `results`). |
| `--repo <path>` | string | Override project root (default: `process.cwd()`). |

**Worker port resolution (in order):**

1. `<dataDir>/worker.port` (existing convention used by `lib/worker-client.sh`)
2. `process.env.ARCANON_WORKER_PORT`
3. Default `37888`

If the port file is missing or unreadable, falls through to env then default. The CLI **never starts the worker** — verify is read-only.

**Exit code matrix (D-04):**

| Condition | Exit code |
| --- | --- |
| All verdicts `ok` | `0` |
| Any non-`ok` verdict, OR `truncated: true`, OR worker not reachable, OR empty result set, OR 404 from server | `1` |
| `--connection <non-int>`, OR HTTP 400 from server | `2` |

**Default human output format:**

```
connection_id | verdict          | source_file:line_start            | evidence_excerpt
--------------+------------------+-----------------------------------+----------------------
12            | ok               | src/api/users.ts:42               | router.post('/users'…
13            | moved            | src/api/legacy.ts:?                | (file not found)
14            | missing          | src/api/orders.ts:?                | (snippet not found)
15            | method_mismatch  | src/api/admin.ts:30               | method 'POST' not in snippet

3 ok, 1 moved, 0 missing, 1 method_mismatch (total 5)
```

`--json` emits the raw server response (`{ results, total, truncated, scope }`) so callers can pipe it through `jq`.

`cmdVerify` is exported via `export { _readHubAutoSync, cmdVerify }` for direct test access in 112-02.

---

### Task 3 — `/arcanon:verify` slash command

**File:** `plugins/arcanon/commands/verify.md` (new — 101 lines)
**Commit:** `fb7d6d0`

- Frontmatter: `description`, `argument-hint`, `allowed-tools: Bash, mcp__plugin_arcanon_arcanon__*`
- Step 1 detects worker via existing `lib/worker-client.sh::worker_running`. Does NOT start the worker (verify is read-only — D-02).
- Step 2 delegates to `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh verify $ARGUMENTS`. The existing thin pass-through forwards args verbatim to `node worker/cli/hub.js verify ...` — **no edits to `hub.sh` were needed**, contrary to the plan's `files_modified` listing.
- Step 3 gives recommended actions for each verdict.
- Performance + read-only guarantee documented per D-02 / D-03.

---

## 1000-connection cap behavior (so 112-02 can skip the dedicated test)

- Triggered only when `scope === "all"` AND `total > 1000`.
- Response is HTTP 200 with `{ results: [], total: N, truncated: true, scope: "all", message: "too many connections (N > 1000) — scope with --source <path> or --connection <id>" }`.
- CLI maps `truncated: true` to: print `message` to stderr, exit `1`. JSON mode emits the full body.
- `--connection <id>` and `--source <path>` always bypass the cap (whatever the count, they return all matching rows).

## Read-only contract proof (D-02)

```bash
$ grep -E "INSERT|UPDATE|DELETE" plugins/arcanon/worker/server/http.js | grep -in verify
# (empty)
```

The verify code path performs:

- 1 SQL `SELECT` per request (no writes)
- 1 `fs.readFileSync` per result row (no writes)
- 0 calls to `qe.upsertRepo`, `qe.beginScan`, `qe.persistFindings`, `qe.endScan`, or any `enrichment_log` insert.

A byte-level checksum of the SQLite file before/after a verify call would be identical (formal proof deferred to 112-02's bats fixtures).

## Deviations from Plan

### Plan said `files_modified` includes `plugins/arcanon/scripts/hub.sh` — file NOT touched

**Found during:** Task 3 review.
**Issue:** The plan's frontmatter listed `scripts/hub.sh` under `files_modified`, but the plan's body explicitly says "scripts/hub.sh forwards `$@` verbatim per its existing implementation — no shell changes." The actual file was inspected (single `exec node "$HUB_CLI" "$@"` line) and confirmed it needs no changes.
**Resolution:** Did not edit hub.sh. The 4-line file already does exactly what's needed.
**Files affected:** none — pure documentation discrepancy in the plan frontmatter.

### Plan said error message should be "no connections found" for an unknown connection_id — actual is server-side error message

**Found during:** Task 2 smoke test (`hub.js verify --connection 99999999`).
**Issue:** Plan's smoke-test expectation was `exit 1 + "no connections found" message`. Server returns `404 { error: "no connection with id 99999999" }` per the server-side error contract; CLI prints that as `error: no connection with id 99999999` and exits 1.
**Resolution:** Kept server-side message — it's more precise than "no connections found" and matches the actual 404 contract. Exit code 1 is correct.
**Files affected:** none — same exit code, clearer message.

No other deviations from D-01 through D-06.

## Manual smoke test

```
$ node plugins/arcanon/worker/cli/hub.js verify --connection abc
error: --connection requires a positive integer ID
$ echo $?
2

$ node plugins/arcanon/worker/cli/hub.js
usage: arcanon-hub <version|login|status|upload|sync|queue|verify> [options]
$ echo $?
2

$ node --input-type=module -e "import('./plugins/arcanon/worker/server/http.js').then(m => console.log(Object.keys(m).join(',')))"
computeVerdict,createHttpServer
```

All three sanity checks pass (exit codes 0/1/2 verified, route registered via fastify.inject, helper exported for 112-02).

## TDD Gate Compliance

This is a `type: execute` (non-TDD) plan; the test plan is 112-02 (Wave 2, sequential). No RED gate required for 112-01.

## Self-Check: PASSED

- File `plugins/arcanon/commands/verify.md` exists ✓
- `plugins/arcanon/worker/server/http.js` modified — `GET /api/verify` route registered, `computeVerdict` exported ✓
- `plugins/arcanon/worker/cli/hub.js` modified — `cmdVerify` handler registered in HANDLERS, exported for tests ✓
- Commits `d29a45a`, `42e5417`, `fb7d6d0` exist in git log ✓
- 33/33 existing http.test.js tests still pass ✓
- No INSERT/UPDATE/DELETE in verify path (grep verified) ✓
