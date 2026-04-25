---
phase: 111-quality-score-and-audit-trail
plan: 03
subsystem: worker/db,worker/mcp,commands/map
tags: [audit-log, mcp-tool, reconciliation, enrichment, trust]
requirements: [TRUST-06, TRUST-14]
dependency-graph:
  requires:
    - "Plan 111-01 migration 016 (enrichment_log table + CHECK + FK CASCADE + indexes)"
    - "Plan 111-02 endScan() quality-score wiring (the inline-Node block in map.md Step 5 it left in place)"
    - "QueryEngine constructor's try/catch fallback pattern for optional tables"
  provides:
    - "QueryEngine.logEnrichment() — stable write API for any future enricher (codeowners, auth-db, ...)"
    - "QueryEngine.getEnrichmentLog() — read API with enricher filter"
    - "MCP tool impact_audit_log + exported handleImpactAuditLog handler"
    - "/arcanon:map reconciliation now writes one enrichment_log row per crossing change"
  affects:
    - "MCP tool count: 8 → 9"
    - "commands/map.md Step 3 (capture _reconciliation) + Step 5 (audit-log writer block)"
    - "tests/mcp-launch.bats + tests/mcp-chromadb-fallback.bats fixtures bumped to 9 tools"
    - "worker/mcp/server.js stdio transport gated behind NODE_TEST_CONTEXT for testability"
tech-stack:
  added: []
  patterns:
    - "Try/catch fallback for pre-migration prepared statements (mirrors actor / node_metadata / service_dependencies)"
    - "Defer-and-write audit-log pattern: capture transient _reconciliation field on connection at reclassification time, write rows after persistFindings/endScan resolves connection_id (Approach A from CONTEXT D-04)"
    - "Top-level exported handle*() function pattern for MCP tool testability (parity with queryImpact / queryChanged / queryGraph)"
    - "NODE_TEST_CONTEXT gate around StdioServerTransport to avoid hanging the test runner on import"
    - "SQL `(col IS ? OR col = ?)` pattern for null-vs-string lookup robustness"
key-files:
  created:
    - "plugins/arcanon/worker/db/query-engine.enrichment-log.test.js"
    - "plugins/arcanon/worker/db/query-engine.reconciliation-audit.test.js"
    - "plugins/arcanon/worker/mcp/server.impact-audit-log.test.js"
  modified:
    - "plugins/arcanon/worker/db/query-engine.js (added 3 prepared statements + 2 methods)"
    - "plugins/arcanon/worker/mcp/server.js (handleImpactAuditLog handler + tool registration + NODE_TEST_CONTEXT gate)"
    - "plugins/arcanon/commands/map.md (Step 3 capture _reconciliation; Step 5 audit-log writer block)"
    - "tests/mcp-launch.bats (bumped tool count to 9; added impact_audit_log assertion)"
    - "tests/mcp-chromadb-fallback.bats (bumped test name to 9; added impact_audit_log assertion)"
decisions:
  - "Approach A (defer-and-write) over Approach B (capture-then-persist): connection identity is preserved through persistFindings (source/target/path/method tuple), and Approach A keeps change context co-located with the connection object so it rides through the JSON write-then-read round-trip in Step 5 without a separate side-list to maintain"
  - "No JS pre-validation of target_kind in logEnrichment — SQL CHECK from migration 016 is the source of truth (CONTEXT D-04). Duplicating the check would silently mask SQL-level errors and drift if the CHECK loosens later"
  - "Single shared fixture project across MCP tests — database.js's _db is a module-level singleton that caches the first openDb call, so per-test isolation lives at the scan_version_id level (not per-projectRoot)"
  - "Fixture project root inside <ARCANON_DATA_DIR>/projects/ — server.js resolveDb absolute-path security check rejects paths that escape <dataDir>/projects/, so the fixture must live there to exercise project resolution end-to-end"
  - "Stdio transport gated behind NODE_TEST_CONTEXT — without this, importing server.js from any test file holds stdin open and hangs the runner after all tests pass (Rule 3 deviation)"
metrics:
  duration: "~30 minutes"
  tasks-completed: 3
  tests-added: 17 (8 enrichment-log + 3 reconciliation integration + 6 MCP tool)
  tests-passing: "17/17 plan tests; 174/175 in the broader query-engine + mcp suite (1 pre-existing dev-machine flake)"
  completed: "2026-04-25"
---

# Phase 111 Plan 03: Audit Log Write Path + impact_audit_log MCP Tool Summary

Closes the reconciliation audit trail (TRUST-06) and lands the `impact_audit_log` MCP read tool (TRUST-14). After this plan, every post-scan reconciliation that downgrades `external` → `cross-service` writes one row to `enrichment_log`, and any caller (Claude via MCP, future enrichers) can query the log via `QueryEngine.getEnrichmentLog` or the new `impact_audit_log` MCP tool. The `logEnrichment` API is stable and reusable — future enrichers (codeowners, auth-db) can write audit rows without changing the table or the API.

## What Shipped

- **`QueryEngine.logEnrichment(scanVersionId, enricher, targetKind, targetId, field, fromValue, toValue, reason)`** — writes one row to `enrichment_log`. Returns `lastInsertRowid` on success, `null` on a pre-016 db. Throws `SqliteError: CHECK constraint failed` for invalid `target_kind` (no JS pre-validation per CONTEXT D-04).
- **`QueryEngine.getEnrichmentLog(scanVersionId, { enricher? })`** — reads rows in `created_at ASC, id ASC` order. Returns `[]` on a pre-016 db, on an unknown scan_version_id, or on any read error.
- **MCP tool `impact_audit_log`** — registered with the locked Zod schema and description from CONTEXT D-03. Handler factored as a top-level exported function `handleImpactAuditLog(params)` so tests can call it without going through the MCP SDK stdio transport.
- **`/arcanon:map` reconciliation instrumentation** — Step 3 captures `_reconciliation: { from, to, reason }` on each reclassified connection BEFORE mutating `crossing`. Step 5 (after `persistFindings` + `endScan` + the quality-score lines from Plan 111-02) iterates connections with `_reconciliation`, resolves the persisted connection_id by `(source, target, path, method)` tuple, and calls `qe.logEnrichment`.

## Chosen Approach: A (defer-and-write) per CONTEXT D-04

**Why A over B:**

- Connection identity is preserved through `persistFindings` via the `(source_service_id, target_service_id, protocol, method, path)` tuple, so we can resolve the persisted `connection_id` by name lookup after the fact.
- Approach A keeps the change context (`from`, `to`, `reason`) co-located with the connection object. The `_reconciliation` field rides through the JSON write-then-read round-trip in Step 5 because it's a plain own enumerable property — `JSON.stringify` includes it, `JSON.parse` restores it, no side-list to keep in sync.
- Approach B would have required a separate side-list of `{ source, target, path, method, from, to, reason }` tuples that lives outside the per-repo `findings` object — more state to thread through Step 4/5, more risk of skew if the agent's findings are later trimmed/filtered.

## Sample Audit-Log Row

```json
{
  "id": 1,
  "scan_version_id": 1,
  "enricher": "reconciliation",
  "target_kind": "connection",
  "target_id": 42,
  "field": "crossing",
  "from_value": "external",
  "to_value": "cross-service",
  "reason": "target matches known service: payments",
  "created_at": "2026-04-25 14:02:10"
}
```

## Sample MCP Tool Response

Calling `impact_audit_log({ scan_version_id: 1 })` returns the standard MCP envelope:

```json
{
  "content": [
    {
      "type": "text",
      "text": "[{\"id\":1,\"scan_version_id\":1,\"enricher\":\"reconciliation\",\"target_kind\":\"connection\",\"target_id\":42,\"field\":\"crossing\",\"from_value\":\"external\",\"to_value\":\"cross-service\",\"reason\":\"target matches known service: payments\",\"created_at\":\"2026-04-25 14:02:10\"}]"
    }
  ]
}
```

When no DB is resolvable for the requested `project`, the same envelope wraps an error payload (parity with `impact_query` / `impact_changed` / `impact_search`):

```json
{ "error": "no_scan_data", "project": "<path>", "hint": "Run /arcanon:map first in that project" }
```

## Pre-016 DB Compatibility Confirmation

- `new QueryEngine(db)` on a db where migration 016 has not been applied does NOT throw — the prepared-statement block is wrapped in try/catch that nulls the three statement handles when the table is absent.
- `qe.logEnrichment(...)` returns `null` (no-op) on a pre-016 db.
- `qe.getEnrichmentLog(...)` returns `[]` on a pre-016 db.
- Confirmed by Test 6 in `worker/db/query-engine.enrichment-log.test.js` (full migration chain 001–015 only, no 016).

## Verification

### Test runs

```
$ cd plugins/arcanon && node --test worker/db/query-engine.enrichment-log.test.js \
                                    worker/db/query-engine.reconciliation-audit.test.js \
                                    worker/mcp/server.impact-audit-log.test.js
✔ QueryEngine enrichment-log API (Plan 111-03 / TRUST-06, TRUST-14) (8/8)
✔ reconciliation → enrichment_log integration (Plan 111-03 / TRUST-06, TRUST-14) (3/3)
✔ Test 1..6 — handleImpactAuditLog (6/6)
ℹ tests 17 — pass 17 — fail 0
```

### Broader node-test suite

```
$ node --test worker/db/query-engine*.test.js worker/mcp/server*.test.js
ℹ tests 175 — pass 174 — fail 1
```

The single failure (`queryScan: returns unavailable when port file does not exist` in `worker/mcp/server-search.test.js`) is **pre-existing on this dev machine** — `~/.arcanon/worker.port` happens to exist locally, so `queryScan` returns `triggered` instead of `unavailable`. Not caused by Plan 111-03; reproduces on `main` before any of this plan's commits land.

### Bats suite (`make test`)

```
1..315
not ok 151 impact-hook - HOK-06: p99 latency < ${IMPACT_HOOK_LATENCY_THRESHOLD:-50}ms over 100 iterations
```

Only HOK-06 fails (the documented pre-existing macOS flake the orchestrator's prompt called out). All MCP-01 tool count tests now pass — the bats fixtures were updated in commit `9ae6d9a` to reflect the new tool count of 9.

## Success Criteria

- [x] `QueryEngine.logEnrichment(...)` writes to enrichment_log and returns lastInsertRowid
- [x] `QueryEngine.getEnrichmentLog(scanVersionId, opts)` reads rows; supports `enricher` filter
- [x] Both methods are no-ops on pre-016 DBs (return null / [])
- [x] `impact_audit_log` MCP tool registered with the locked name, description (per CONTEXT D-03), and Zod schema
- [x] Tool returns rows in MCP envelope format; supports `enricher` filter and `project` resolution; emits `no_scan_data` when DB is unresolvable
- [x] commands/map.md Step 3 captures `_reconciliation` field on reclassified connections
- [x] commands/map.md Step 5 calls `logEnrichment` for each reconciled connection after `endScan`
- [x] FK CASCADE on scan_versions DELETE removes orphan audit rows (verified through the JS API in Test 8)
- [x] All node tests pass (8 + 3 + 6 = 17 cases)
- [x] All MCP-01 bats tool-count tests pass with the new count of 9

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Stdio transport startup hangs the test runner**

- **Found during:** Task 2 (running `node --test worker/mcp/server.impact-audit-log.test.js` for the first time).
- **Issue:** `server.js` ends with `await server.connect(transport)` at the top level, holding stdin open for the lifetime of the imported module. Any test file that imports server.js (the new file plus pre-existing `worker/mcp/server.test.js` and `server-search.test.js`) makes the runner hang after all tests pass and exit with timeout (124).
- **Fix:** Gated the stdio transport block behind `if (!process.env.NODE_TEST_CONTEXT)`. Node's test runner sets `NODE_TEST_CONTEXT=child-v8` in the test subprocess, so production bootstrap is unaffected (the env var is empty outside `node --test`). Pre-existing tests that import server.js also benefit — they now exit cleanly without `--test-force-exit`.
- **Files modified:** `plugins/arcanon/worker/mcp/server.js`
- **Commit:** `39f7509` (bundled with the RED test commit because the fix was a prerequisite to running the new test at all).

**2. [Rule 1 — Bug] Bats `MCP-01: tools/list returns exactly 8 tools` and the matching test names**

- **Found during:** `make test` post-Task-2.
- **Issue:** The bats fixture hard-codes `tool_count = "8"`. Adding `impact_audit_log` legitimately makes the count 9, so the assertion fails. The test-name strings (`returns all 8 MCP tools`, `all 8 tools still listed when ...`) also become stale.
- **Fix:** Bumped the count constant to 9, renamed the tests, and added a partial-string assertion for `"impact_audit_log"` in both `tests/mcp-launch.bats` and `tests/mcp-chromadb-fallback.bats`. The impl was correct — the fixture was the stale data.
- **Files modified:** `tests/mcp-launch.bats`, `tests/mcp-chromadb-fallback.bats`
- **Commit:** `9ae6d9a`

### Non-issues observed (out of scope, not fixed)

- **`queryScan: returns unavailable when port file does not exist`** — pre-existing dev-machine artifact (`~/.arcanon/worker.port` exists locally because the worker has run on this machine before). Reproduces on `main` before any 111-03 commit. No action.
- **`HOK-06: p99 latency`** — the documented macOS flake the user explicitly mentioned. No action.

## Behavior Locked In

1. `enrichment_log` is the audit trail for ANY post-scan field-level change. Phase 111 only writes `enricher='reconciliation'` rows, but the schema and `logEnrichment` API are designed for `'codeowners'`, `'auth-db'`, etc. in future phases (CONTEXT D-04).
2. **`logEnrichment` does NOT pre-validate `target_kind` in JS.** A bad `target_kind` throws via the SQL CHECK constraint. Callers must pass `'service'` or `'connection'` exactly (the lock from migration 016).
3. **Reconciliation audit reason format is locked:** `'target matches known service: <service_name>'`. Future filtering / dashboarding can grep this string. Test 1 in `query-engine.reconciliation-audit.test.js` asserts the exact format.
4. **`_reconciliation` is a transient field.** It does NOT belong in `connections`, `services`, or any persisted table — it lives only on the in-memory finding object during the slash-command flow. Step 5 reads it after `endScan` and never persists it directly; the audit-log row IS the persistent record.
5. **The MCP tool description is locked from CONTEXT D-03 verbatim.** Any rewording must update the planner doc first.
6. **Stdio transport startup is gated behind `NODE_TEST_CONTEXT`.** Production users see no behavior change. Test files importing server.js no longer hang.

## Files Created / Modified

| File | Purpose | Lines (added/total) |
| ---- | ------- | -------------------- |
| `plugins/arcanon/worker/db/query-engine.js` | logEnrichment + getEnrichmentLog + 3 prepared statements | +112 |
| `plugins/arcanon/worker/db/query-engine.enrichment-log.test.js` | 8 unit tests | 243 (new) |
| `plugins/arcanon/worker/db/query-engine.reconciliation-audit.test.js` | 3 integration tests | 247 (new) |
| `plugins/arcanon/worker/mcp/server.js` | handleImpactAuditLog handler + tool registration + NODE_TEST_CONTEXT gate | +85 |
| `plugins/arcanon/worker/mcp/server.impact-audit-log.test.js` | 6 MCP tool tests | 187 (new) |
| `plugins/arcanon/commands/map.md` | Step 3 _reconciliation capture + Step 5 audit-log writer | +51 |
| `tests/mcp-launch.bats` | Bumped tool count to 9; added impact_audit_log assertion | +5 |
| `tests/mcp-chromadb-fallback.bats` | Bumped test name + assertion | +6 |

## Commits

| Hash      | Type | Subject                                                                              |
| --------- | ---- | ------------------------------------------------------------------------------------ |
| `1377fc0` | test | add failing tests for QueryEngine.logEnrichment + getEnrichmentLog                   |
| `56d7d42` | feat | add QueryEngine.logEnrichment + getEnrichmentLog                                     |
| `39f7509` | test | add failing tests for impact_audit_log MCP tool (+ NODE_TEST_CONTEXT gate, Rule 3)   |
| `badb932` | feat | register impact_audit_log MCP tool + handleImpactAuditLog handler                    |
| `4a7d95c` | feat | wire reconciliation audit-log writes into /arcanon:map                               |
| `9ae6d9a` | test | bump MCP tool count from 8 to 9 in bats fixtures                                     |

TDD gates intact: each Task has a preceding `test(...)` RED commit followed by a `feat(...)` GREEN commit. Task 3 (the slash-command instrumentation) ships its integration test alongside the feat commit because the test exercises the same JS verbatim as the patched map.md — separating them would have produced an unnecessary double-commit cycle for the same conceptual change.

## Self-Check: PASSED

- File `plugins/arcanon/worker/db/query-engine.js`: FOUND (modified)
- File `plugins/arcanon/worker/db/query-engine.enrichment-log.test.js`: FOUND
- File `plugins/arcanon/worker/db/query-engine.reconciliation-audit.test.js`: FOUND
- File `plugins/arcanon/worker/mcp/server.js`: FOUND (modified)
- File `plugins/arcanon/worker/mcp/server.impact-audit-log.test.js`: FOUND
- File `plugins/arcanon/commands/map.md`: FOUND (modified)
- File `tests/mcp-launch.bats`: FOUND (modified)
- File `tests/mcp-chromadb-fallback.bats`: FOUND (modified)
- Commit `1377fc0`: FOUND (test RED logEnrichment / getEnrichmentLog)
- Commit `56d7d42`: FOUND (feat GREEN logEnrichment / getEnrichmentLog)
- Commit `39f7509`: FOUND (test RED impact_audit_log)
- Commit `badb932`: FOUND (feat GREEN impact_audit_log)
- Commit `4a7d95c`: FOUND (feat reconciliation wiring + integration tests)
- Commit `9ae6d9a`: FOUND (test bats tool-count bump)

## Phase 111 Closure

This plan completes Phase 111 (TRUST-05, TRUST-06, TRUST-13, TRUST-14). The Phase 111 verification document tying the three plans together is at `.planning/phases/111-quality-score-and-audit-trail/111-VERIFICATION.md`.
