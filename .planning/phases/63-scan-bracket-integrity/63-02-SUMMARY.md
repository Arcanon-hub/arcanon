---
phase: 63-scan-bracket-integrity
plan: "02"
subsystem: worker/db
tags: [scan-versions, garbage-collection, query-engine, sqlite, testing]
dependency_graph:
  requires: []
  provides: [null-scan-gc, endScan-null-cleanup]
  affects: [query-engine, scan-bracket-integrity, graph-response]
tech_stack:
  added: []
  patterns: [prepared-statement-gc, tdd-integration]
key_files:
  created: []
  modified:
    - plugins/ligamen/worker/db/query-engine.js
    - plugins/ligamen/worker/db/query-engine-upsert.test.js
decisions:
  - "Apply migrations 005 and 006 in buildDb() test helper — previously only 001-004 were applied, breaking all QueryEngine tests that rely on ON CONFLICT(path) for repos and scan_version_id columns"
  - "buildDbWithScanVersions() implemented as alias of the fixed buildDb() since migrations 005-006 are now always included"
metrics:
  duration: 139s
  completed: "2026-03-21"
  tasks_completed: 2
  files_modified: 2
---

# Phase 63 Plan 02: NULL scan_version_id Garbage Collection Summary

**One-liner:** endScan() now deletes legacy NULL scan_version_id connections then services for the given repo using two new prepared statements, with tests confirming cross-repo isolation.

## What Was Built

Added a NULL scan_version_id garbage collection step inside `endScan()` in `query-engine.js`. Pre-bracket scans left every `services`/`connections` row with `scan_version_id=NULL`. The existing `_stmtDeleteStaleServices` / `_stmtDeleteStaleConnections` filter on `IS NOT NULL`, meaning legacy NULL rows survived indefinitely. The new GC step removes these rows after the first successful bracketed scan completes.

### New Prepared Statements (constructor)

- `_stmtDeleteNullConnections` — deletes connections whose `source_service_id` or `target_service_id` refers to a service with `scan_version_id IS NULL` for the given repo
- `_stmtDeleteNullServices` — deletes services where `repo_id = ? AND scan_version_id IS NULL`

### Updated endScan() Order

1. `_stmtEndScan` (mark completed_at)
2. `_stmtDeleteStaleConnections` (delete non-null stale connections)
3. `_stmtDeleteStaleServices` (delete non-null stale services)
4. `_stmtDeleteNullConnections` (delete null-versioned connections for this repo) **[NEW]**
5. `_stmtDeleteNullServices` (delete null-versioned services for this repo) **[NEW]**
6. actor_connections orphan cleanup (existing try/catch)

Connections are deleted before services to respect the FK constraint (no CASCADE).

## Tests Added

Three new tests in `query-engine-upsert.test.js`:

- **Test A:** endScan() removes a service with scan_version_id IS NULL for the scanned repo
- **Test B:** endScan() removes connections referencing NULL-versioned services, then the services themselves
- **Test C:** endScan() on repo A does NOT delete NULL rows belonging to repo B

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed buildDb() test helper — missing migrations 005 and 006**

- **Found during:** Task 1 verification (existing tests failed before any new code ran)
- **Issue:** `buildDb()` applied migrations 001-004 only. Since migration 006 was added (UNIQUE index on `repos.path`), `QueryEngine._stmtUpsertRepo` uses `ON CONFLICT(path)` which requires that index. Without migration 006, every QueryEngine instantiation in tests throws `SqliteError: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`. All 5 existing tests were broken.
- **Fix:** Extended `buildDb()` to also apply migration 005 (scan_versions table + scan_version_id columns) and migration 006 (unique repos.path index). `buildDbWithScanVersions()` implemented as an alias since the full migration set is now always applied.
- **Files modified:** `plugins/ligamen/worker/db/query-engine-upsert.test.js`
- **Commit:** 75f3af2

## Self-Check: PASSED

- plugins/ligamen/worker/db/query-engine.js: FOUND
- plugins/ligamen/worker/db/query-engine-upsert.test.js: FOUND
- Commit 9fd1ca4 (feat): FOUND
- Commit 75f3af2 (test): FOUND
