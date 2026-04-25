---
phase: 111-quality-score-and-audit-trail
plan: 02
subsystem: worker/db, worker/server, worker/cli, commands
tags: [quality-score, trust, http-endpoint, slash-commands, tdd]
requirements: [TRUST-05, TRUST-13]
dependency-graph:
  requires:
    - "scan_versions.quality_score column (migration 015 — landed by 111-01)"
    - "connections.confidence column (migration 009 — already shipped)"
  provides:
    - "QueryEngine.getQualityScore(scanVersionId) — read persisted scalar"
    - "QueryEngine.getScanQualityBreakdown(scanVersionId) — full breakdown object"
    - "endScan() now writes scan_versions.quality_score on every successful close"
    - "GET /api/scan-quality?project=<root> — latest scan's breakdown (HTTP)"
    - "/arcanon:map prints `Scan quality: NN% high-confidence, M prose-evidence warnings` at end-of-output"
    - "/arcanon:status prints `Latest scan: NN% high-confidence (S services, C connections)` (when worker running)"
  affects:
    - "All future endScan() callers — they now persist a score alongside completed_at"
    - "/arcanon:status JSON output gains a `latest_scan` field"
    - "111-03 may build on logEnrichment patterns established here (none introduced — kept narrow to TRUST-05/13)"
tech-stack:
  added: []
  patterns:
    - "PRAGMA table_info column probe for prepared-statement gating (mirrors _stmtUpsertNodeMetadata, _hasBasePath)"
    - "Best-effort write inside endScan — try/catch + logger.warn fallback, never blocks bracket close"
    - "Single-SQL aggregate breakdown via CASE WHEN per confidence band"
    - "fastify route handler reusing getQE(request) — no new path resolver"
    - "AbortController 2-second timeout for the worker fetch in cmdStatus (matches worker-client.sh worker_running)"
key-files:
  created:
    - "plugins/arcanon/worker/db/query-engine.quality-score.test.js"
    - "plugins/arcanon/worker/server/http.scan-quality.test.js"
  modified:
    - "plugins/arcanon/worker/db/query-engine.js"
    - "plugins/arcanon/worker/server/http.js"
    - "plugins/arcanon/worker/cli/hub.js"
    - "plugins/arcanon/commands/map.md"
    - "plugins/arcanon/commands/status.md"
decisions:
  - "Status surface implementation moved from `scripts/hub.sh` to `worker/cli/hub.js cmdStatus` because hub.sh is a thin Node wrapper — the JS function is the actual extension point (Rule 3 deviation, see Deviations below)"
  - "PRAGMA-based column probe added on top of try/catch for the quality_score statements — the SELECT and breakdown SQL succeed even on a pre-015 db (no reference to quality_score) so a runtime probe is needed to gate the UPDATE"
  - "404 vs 503 disambiguation in /api/scan-quality: ?project= present + resolver returns null → 404 project_not_found; resolver returns QE but no scan rows → 503 no_scan_data; no project arg + no static QE → 503 (test-only fallback)"
  - "Lock-phrase comment kept on a single line in query-engine.js so the source-grep test (Test 4b) can verify the D-02 phrasing verbatim"
  - "/arcanon:status latest-scan fetch is best-effort with a 2-second timeout — silently omits the line on any error so the status command never blocks waiting for an offline worker"
metrics:
  duration: "~13 minutes"
  tasks-completed: 3
  tests-added: 15 (10 in query-engine.quality-score.test.js + 5 in http.scan-quality.test.js)
  tests-passing: "169/169 (worker/db + worker/server suites); 307/308 bats (HOK-06 macOS perf flake unchanged, pre-existing)"
  completed: "2026-04-25"
---

# Phase 111 Plan 02: Quality Score Wiring + Display Summary

Wires `scan_versions.quality_score` (column landed by 111-01) into the running
system: `endScan()` now computes and persists the score on every successful
bracket close, two new `QueryEngine` methods expose it for read paths, a new
HTTP endpoint serves the latest breakdown to shell-driven status commands, and
both `/arcanon:map` and `/arcanon:status` surface a quality line to the user.
TDD throughout — RED commits precede GREEN for both Task 1 and Task 2.

## What Shipped

### QueryEngine wiring (Task 1)
- `endScan()` computes `(high + 0.5 * low) / total` and writes
  `scan_versions.quality_score` between the bracket-close UPDATE and the stale-row
  cleanup. `total = 0` → score is `NULL`. NULL-confidence rows count toward
  `total` but contribute 0 to the numerator (D-02). The write is best-effort:
  any failure logs to `this._logger?.warn ?? console.warn` and the bracket close
  proceeds.
- `getQualityScore(scanVersionId)` returns the persisted scalar or `null`.
- `getScanQualityBreakdown(scanVersionId)` returns
  `{scan_version_id, total, high, low, null_count, prose_evidence_warnings,
  service_count, quality_score, completed_at}`. `prose_evidence_warnings = 0`
  is a D-01 placeholder for v0.1.3.
- Pre-015 DB safety: PRAGMA `table_info(scan_versions)` probe in the constructor
  gates the prepared statements. If `quality_score` is absent, the statements are
  nulled and `endScan` silently skips persistence — no throw.

### HTTP endpoint (Task 2)
- `GET /api/scan-quality?project=<root>` placed adjacent to `/api/version` in
  `worker/server/http.js`. Reuses the existing `getQE(request)` resolver — no
  new path validation introduced.
- 200 returns the contract shape locked in CONTEXT D-05:
  `{scan_version_id, completed_at, quality_score, total_connections,
  high_confidence, low_confidence, null_confidence, prose_evidence_warnings,
  service_count}`.
- 503 `{error: "no_scan_data"}` when QE resolves but no completed scan exists
  (also catches pre-015 dbs).
- 404 `{error: "project_not_found"}` when `?project=` is supplied and the
  resolver returns null.
- Latest-scan selection: `ORDER BY completed_at DESC, id DESC LIMIT 1`.

### Surface tweaks (Task 3)
- `commands/map.md` Step 5: extends the inline-Node DB snippet so AFTER
  `endScan()` it calls `qe.getScanQualityBreakdown(scanVersionId)` and prints
  the format string locked in CONTEXT D-01:
  `Scan quality: NN% high-confidence, M prose-evidence warnings`.
  When `quality_score === null` (zero-connection scan) it prints
  `Scan quality: n/a (0 connections)` instead.
- `worker/cli/hub.js cmdStatus`: appends a `Latest scan: NN% high-confidence
  (S services, C connections)` line, fetched from `/api/scan-quality` with a
  2-second `AbortController` timeout. Falls back silently to null on any
  failure (worker offline, old worker without endpoint, network error). JSON
  output (`--json`) gets a `latest_scan` field with the full breakdown.
- `commands/status.md`: extended the bullet list with "Latest scan quality
  (when worker has graph data) — TRUST-05" and added a closing paragraph
  explaining what the percentage represents.

## Verification

### Test runs

```
$ cd plugins/arcanon && node --test worker/db/query-engine.quality-score.test.js worker/server/http.scan-quality.test.js
✔ QueryEngine quality-score wiring (Plan 111-02 / TRUST-05, TRUST-13) — 10/10
✔ GET /api/scan-quality (TRUST-05, D-05) — 5/5

$ cd plugins/arcanon && node --test worker/db/query-engine*.test.js worker/server/http*.test.js
ℹ tests 138, pass 138, fail 0

$ cd plugins/arcanon && node --test worker/db/query-engine*.test.js worker/server/http*.test.js worker/db/migration-*.test.js worker/db/migrations.test.js
ℹ tests 169, pass 169, fail 0

$ make test
1..308
ok 1..150, 152..308       (307 passing)
not ok 151 impact-hook - HOK-06: p99 latency < 50ms (pre-existing macOS perf flake — unchanged by this plan)
```

### Sample outputs

`/arcanon:map` end-of-output (10 connections, 8 high + 2 low):
```
saved
Scan quality: 90% high-confidence, 0 prose-evidence warnings
```

`/arcanon:status` (worker running with the same scan):
```
Arcanon v0.1.3-dev
  project:      ligamen
  credentials:  ✗ missing (/arcanon:login)
  auto-sync:    disabled
  queue:        0 pending, 0 dead
  data dir:     /Users/ravichillerega/.arcanon
  Latest scan: 90% high-confidence (2 services, 10 connections)
```

`/arcanon:status` JSON output:
```json
{
  "plugin_version": "0.1.3-dev",
  "...": "...",
  "latest_scan": {
    "scan_version_id": 1,
    "completed_at": "2026-04-25T13:23:10.949Z",
    "quality_score": 0.9,
    "total_connections": 10,
    "high_confidence": 8,
    "low_confidence": 2,
    "null_confidence": 0,
    "prose_evidence_warnings": 0,
    "service_count": 2
  }
}
```

### NULL-confidence comment (verbatim, single-line — verified by Test 4b)

```
// NULL confidence is counted in `total` but contributes 0 to the numerator — agent omissions do not count as 'low'.
```

### Pre-015 DB best-effort confirmation

Test 8 in `query-engine.quality-score.test.js` constructs a DB with migrations
001..014 only (no 015 → no `quality_score` column). It seeds a service + a
connection and calls `endScan()`. Assertions:
- `endScan` does NOT throw.
- `scan_versions.completed_at` IS set (bracket close succeeded).
- `getQualityScore(scanVersionId)` returns `null`.
- `getScanQualityBreakdown(scanVersionId)` returns `null`.

## Success Criteria

- [x] `endScan()` computes and persists `quality_score` per `(high + 0.5*low) / total`, NULL when total=0
- [x] NULL confidence counts in `total` but contributes 0 to numerator (Test 4)
- [x] `getQualityScore(id)` and `getScanQualityBreakdown(id)` return correct values; null for missing/pre-015
- [x] `endScan` does NOT throw on pre-015 DBs (Test 8)
- [x] `GET /api/scan-quality` returns the latest scan's breakdown in the documented shape
- [x] 503 for no-scan-data, 404 for project-not-found
- [x] `/arcanon:map` Step 5 prints `Scan quality: NN% high-confidence, M prose-evidence warnings`
- [x] `/arcanon:status` prints `Latest scan: NN% high-confidence (S services, C connections)` when worker running
- [x] All node tests pass (15/15 new + 169/169 affected suites)
- [x] `make test` shows only the pre-existing HOK-06 macOS perf flake (307/308 — unchanged)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Status surface insertion site moved from `scripts/hub.sh` to `worker/cli/hub.js cmdStatus`**

- **Found during:** Task 3 setup
- **Issue:** The plan prescribed adding a status_cmd() / curl block to
  `plugins/arcanon/scripts/hub.sh`. Reading the file showed it is a 15-line
  thin Node wrapper that does `exec node "$HUB_CLI" "$@"` — there is no
  `status_cmd` function, no shell-driven status output. The actual `status`
  subcommand is `cmdStatus` in `plugins/arcanon/worker/cli/hub.js`.
- **Fix:** Implemented the latest-scan fetch + format in `cmdStatus` directly
  using a new `_fetchLatestScanLine(projectRoot)` helper that uses Node's
  `fetch` + `AbortController` (no shell, no curl). Mirrors the existing
  `cmdVerify` pattern for worker-port resolution.
- **Files modified:** `plugins/arcanon/worker/cli/hub.js`
- **Commit:** `9ade02c`

**2. [Rule 1 — Bug] Lock-phrase comment line wrapping broke source-grep test**

- **Found during:** Task 1 GREEN — Test 4b failed after the initial implementation
- **Issue:** Test 4b reads `query-engine.js` and asserts the literal phrase
  `"NULL confidence is counted in \`total\` but contributes 0 to the numerator"`
  is present. My initial multi-line comment broke the phrase across two lines,
  so the substring match failed.
- **Fix:** Extracted the lock-phrase to a single un-wrapped comment line with a
  preceding explanatory note ("kept on a single line so the source-grep test
  can verify it"). The phrase is now grep-able verbatim.
- **Files modified:** `plugins/arcanon/worker/db/query-engine.js`
- **Commit:** `65c77b2` (folded into the GREEN commit since the GREEN gate was
  not yet open when the fix was applied)

**3. [Rule 2 — Critical] PRAGMA column probe added to gate UPDATE on pre-015 DBs**

- **Found during:** Task 1 implementation review
- **Issue:** The plan's prescribed implementation wraps the SELECT/UPDATE
  prepares in try/catch. But on a pre-015 DB the SELECT statements (which do
  NOT reference `quality_score`) prepare successfully. Only the UPDATE references
  the column, and the prepare succeeds even on pre-015 — better-sqlite3 defers
  column validation to run() time. Without an explicit column probe, `endScan`
  would throw `SqliteError: no such column: quality_score` on a pre-015 DB,
  violating the "best-effort" must-have.
- **Fix:** Added a `PRAGMA table_info(scan_versions)` check after the prepares;
  if `quality_score` is absent, all three statements are nulled. This makes
  the gate explicit and Test 8 (pre-015 best-effort) passes.
- **Files modified:** `plugins/arcanon/worker/db/query-engine.js`
- **Commit:** `65c77b2`

### Non-issues observed (out of scope, not fixed)

**HOK-06 bats perf test fails on macOS** — `not ok 151 impact-hook latency p99
144ms exceeds threshold 50ms`. Pre-existing flake on macOS hardware (the
threshold is tuned for Linux CI). Not introduced by this plan; not in scope.

## Behavior Locked In

1. **Score formula and NULL semantics** — `(high + 0.5 * low) / total`, NULL
   when `total == 0`. Future changes to this formula MUST update both the SQL
   in `_stmtSelectQualityBreakdown` AND the documentation in CONTEXT D-02.
2. **Format strings** — `Scan quality: NN% high-confidence, M prose-evidence
   warnings` (map) and `Latest scan: NN% high-confidence (S services, C
   connections)` (status). Locked in CONTEXT D-01 — agents/UIs may parse them.
3. **Endpoint contract** — `GET /api/scan-quality` returns 200 / 404 / 503
   only. Adding new fields is allowed but renaming or removing existing fields
   is breaking.
4. **Best-effort policy** — `endScan` MUST NOT throw on quality_score write
   failure. Tests Test 8 + Test 9 lock this. Future refactors that move the
   write outside the try/catch will break the contract.

## Files Created / Modified

| File                                                                  | Change   | Lines |
| --------------------------------------------------------------------- | -------- | ----- |
| `plugins/arcanon/worker/db/query-engine.quality-score.test.js`        | created  | +289  |
| `plugins/arcanon/worker/server/http.scan-quality.test.js`             | created  | +325  |
| `plugins/arcanon/worker/db/query-engine.js`                           | modified | +146  |
| `plugins/arcanon/worker/server/http.js`                               | modified | +85   |
| `plugins/arcanon/worker/cli/hub.js`                                   | modified | +85   |
| `plugins/arcanon/commands/map.md`                                     | modified | +12   |
| `plugins/arcanon/commands/status.md`                                  | modified | +6    |

## Commits

| Hash      | Type | Subject                                                                          |
| --------- | ---- | -------------------------------------------------------------------------------- |
| `c1964e7` | test | add failing tests for QueryEngine quality-score wiring (TRUST-13)                |
| `65c77b2` | feat | wire quality_score in endScan + add getQualityScore/getScanQualityBreakdown      |
| `e84d36a` | test | add failing tests for GET /api/scan-quality (TRUST-05, D-05)                     |
| `1f4c0f7` | feat | add GET /api/scan-quality endpoint (TRUST-05, D-05)                              |
| `9ade02c` | feat | surface scan quality in /arcanon:map and /arcanon:status (TRUST-05, D-01)       |

TDD gates intact for both Task 1 and Task 2: each has a preceding `test(...)`
RED commit followed by a `feat(...)` GREEN commit. No REFACTOR step needed.
Task 3 is a non-TDD surface task (no behavior to test beyond the two
underlying API contracts already exercised by Tasks 1 & 2).

## Self-Check: PASSED

- File `plugins/arcanon/worker/db/query-engine.quality-score.test.js`: FOUND
- File `plugins/arcanon/worker/server/http.scan-quality.test.js`: FOUND
- Modified `plugins/arcanon/worker/db/query-engine.js`: FOUND
- Modified `plugins/arcanon/worker/server/http.js`: FOUND
- Modified `plugins/arcanon/worker/cli/hub.js`: FOUND
- Modified `plugins/arcanon/commands/map.md`: FOUND
- Modified `plugins/arcanon/commands/status.md`: FOUND
- Commit `c1964e7`: FOUND (test RED query-engine wiring)
- Commit `65c77b2`: FOUND (feat GREEN query-engine wiring)
- Commit `e84d36a`: FOUND (test RED endpoint)
- Commit `1f4c0f7`: FOUND (feat GREEN endpoint)
- Commit `9ade02c`: FOUND (feat surface tweaks)

## Next Plans

- **Plan 111-03** wires reconciliation in `commands/map.md` Step 3/5 to write
  `enrichment_log` rows via `logEnrichment()`, exposes `getEnrichmentLog()` on
  QueryEngine, and registers the `impact_audit_log` MCP tool (TRUST-06,
  TRUST-14, plus D-03/D-04 from CONTEXT). Independent of Plan 111-02 — no
  shared code paths beyond the constructor pattern.
