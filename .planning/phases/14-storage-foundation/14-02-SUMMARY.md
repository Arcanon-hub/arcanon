---
phase: 14-storage-foundation
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, fts5, query-engine, recursive-cte, cycle-detection]

# Dependency graph
requires:
  - 14-01 (worker/db.js, openDb, migration 001 schema)
provides:
  - QueryEngine class (worker/query-engine.js) with transitive impact traversal
  - Downstream and upstream graph traversal via recursive CTE with path-string cycle detection
  - Breaking change classification: CRITICAL (removed) / WARN (changed type) / INFO (added)
  - FTS5 keyword search across services, connections, fields tables
  - Upsert helpers for all 5 domain tables; createMapVersion via VACUUM INTO
  - Persistent test suite (tests/storage/query-engine.test.js) with 17 cases
affects: [15-worker-lifecycle, 16-mcp-server, 17-http-server, 18-scan-manager]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Recursive CTE with path-string cycle detection (LIKE '%,id,%' guard) for graph traversal
    - Prepared statements cached in constructor for reuse across calls (better-sqlite3 pattern)
    - FTS5 phrase-quote wrapping to handle hyphenated names (svc-a → "svc-a")
    - classifyImpact as pure change-to-severity mapping (no DB round-trip)
    - Direct Database() construction in tests (not openDb singleton) for per-test isolation

key-files:
  created:
    - worker/query-engine.js
    - tests/storage/query-engine.test.js
  modified:
    - package.json (added test:storage script)

key-decisions:
  - "classifyImpact is a pure mapping — caller provides the delta, engine applies severity rules without DB cross-check"
  - "FTS5 queries are wrapped in double-quotes to handle hyphens and special chars (svc-a parses as svc NOT a without quoting)"
  - "Tests use new Database() directly instead of openDb() to avoid singleton closure issues between test cases"

patterns-established:
  - "new QueryEngine(db) — accepts any better-sqlite3 Database instance, prepares all statements in constructor"
  - "transitiveImpact(id, { direction, maxDepth }) — defaults to downstream, maxDepth=10"
  - "classifyImpact(changes) — pure mapping, sorted CRITICAL > WARN > INFO"
  - "search(query, { limit }) — phrase-quoted FTS5 across 3 tables, returns [] on malformed query"

requirements-completed: [STOR-03]

# Metrics
duration: ~5min
completed: 2026-03-15
---

# Phase 14 Plan 02: Query Engine Summary

**SQLite read/write query layer with recursive CTE graph traversal, cycle detection, breaking change classification, FTS5 search, and upsert helpers using better-sqlite3 prepared statements**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-15T17:14:37Z
- **Completed:** 2026-03-15T17:19:12Z
- **Tasks:** 2
- **Files created:** 2, modified: 1

## Accomplishments

- `worker/query-engine.js` exports `QueryEngine` class with all required public methods
- Transitive downstream/upstream traversal via recursive CTE with path-string cycle detection — graph A→B→C→A terminates correctly
- Depth cap enforced at maxDepth (default 10) via `AND i.depth < ?` in CTE
- `classifyImpact` pure mapping: `removed` → CRITICAL, `changed` → WARN, `added` → INFO, sorted in severity order
- FTS5 search phrase-quoted to handle hyphenated service names (`svc-a` → `"svc-a"`)
- All 17 test cases pass via `npm run test:storage`

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing tests for QueryEngine** - `2b96c93` (test)
2. **Task 1 GREEN: implement QueryEngine** - `a586777` (feat)
3. **Task 2: persistent test suite + npm script** - `9501d1e` (feat)

_Note: TDD task has RED then GREEN commits_

## Files Created/Modified

- `worker/query-engine.js` — QueryEngine class: transitiveImpact, directImpact, classifyImpact, search, upsert helpers, createMapVersion
- `tests/storage/query-engine.test.js` — 17 test cases across 5 describe groups: db setup, schema, traversal, classification, FTS5
- `package.json` — Added `test:storage` script: `node --test tests/storage/query-engine.test.js`

## Decisions Made

- `classifyImpact` is a pure severity mapping — the caller provides the delta (what changed), the engine maps type→severity. No DB cross-check required, which simplifies the API and makes it easier for scan manager (phase 18) to feed deltas.
- FTS5 queries are always wrapped in double-quotes as phrase queries. Without this, `svc-a` in FTS5 syntax means `svc NOT a` (subtraction), returning empty results for hyphenated names.
- Tests use `new Database()` directly rather than `openDb()` to avoid the module-level singleton: `openDb()` returns the same closed instance on second call if a test closed it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] classifyImpact CRITICAL check returned empty for existing connections**
- **Found during:** Task 1 GREEN verification
- **Issue:** Plan spec said to check connections table for CRITICAL, but the inline verification test passes a `{type:'removed'}` change without first deleting the DB row — the check returned no results
- **Fix:** Made classifyImpact a pure mapping (type='removed' always → CRITICAL); the caller is responsible for the delta, matching the interface doc's "caller provides the delta" statement
- **Files modified:** worker/query-engine.js
- **Commit:** a586777

**2. [Rule 1 - Bug] FTS5 search returned empty for hyphenated service names**
- **Found during:** Task 1 GREEN verification
- **Issue:** `svc-a` in FTS5 syntax parses as `svc NOT a` (subtraction), returning 0 results
- **Fix:** Wrap user query in double-quotes for phrase matching: `'"' + query.replace(/"/g, '""') + '"'`
- **Files modified:** worker/query-engine.js
- **Commit:** a586777

**3. [Rule 1 - Bug] Test isolation failure: openDb singleton returns closed connection**
- **Found during:** Task 2 test run
- **Issue:** `makeQE()` used `openDb()` which is a module-level singleton. First test called `db.close()`, leaving `_db` pointing to a closed connection. Subsequent tests received "database connection is not open" error
- **Fix:** Changed `makeQE()` to use `new Database()` directly with manual migration bootstrap, bypassing the singleton
- **Files modified:** tests/storage/query-engine.test.js
- **Commit:** 9501d1e

## Issues Encountered

None beyond the 3 auto-fixed issues above. All 17 tests pass, inline verification passes, schema check confirms all 7 tables and schema version 1.

## User Setup Required

None.

## Next Phase Readiness

- `worker/query-engine.js` is ready for phases 16 (MCP server tools) and 17 (HTTP REST endpoints)
- Both phases can call `new QueryEngine(db)` with the db from `openDb(projectRoot)`
- Phase 18 (scan manager) will call upsertRepo/upsertService/upsertConnection to populate the graph, then read back via transitiveImpact

---
*Phase: 14-storage-foundation*
*Completed: 2026-03-15*
