---
phase: 28-scan-version-bracket
plan: "01"
subsystem: storage
tags: [migration, sqlite, scan-versioning, query-engine]
dependency_graph:
  requires: [27-01]
  provides: [scan-version-bracket-schema, beginScan, endScan, persistFindings-v2]
  affects: [worker/db/query-engine.js, worker/db/migrations/005_scan_versions.js]
tech_stack:
  added: []
  patterns: [scan-bracket-pattern, sqlite-nullable-alter-table]
key_files:
  created:
    - worker/db/migrations/005_scan_versions.js
    - tests/storage/scan-version-bracket.test.js
  modified:
    - worker/db/query-engine.js
    - tests/storage/query-engine.test.js
decisions:
  - "Migration 005 uses ALTER TABLE ADD COLUMN with no DEFAULT — nullable FK, existing rows get NULL automatically"
  - "endScan deletes connections before services (no CASCADE on FK in migration 001)"
  - "Rows with scan_version_id IS NULL are not deleted by endScan — treated as legacy pre-bracket rows"
  - "persistFindings 4th param (scanVersionId) is optional — undefined treated as null for backward compatibility"
  - "query-engine.test.js makeQE updated to run all 5 migrations (001-005) — required to prepare scan_version_id statements"
metrics:
  duration_minutes: 4
  completed_date: "2026-03-16"
  tasks_completed: 2
  files_changed: 4
---

# Phase 28 Plan 01: Scan Version Bracket Schema + QueryEngine Methods Summary

**One-liner:** Migration 005 adds `scan_versions` table + nullable `scan_version_id` FK columns on services/connections; QueryEngine gains `beginScan`/`endScan` bracket methods and stamped `persistFindings`.

## What Was Built

### Migration 005 (`worker/db/migrations/005_scan_versions.js`)
- `scan_versions` table: `(id, repo_id, started_at, completed_at)` — tracks scan lifecycle
- `ALTER TABLE services ADD COLUMN scan_version_id INTEGER REFERENCES scan_versions(id)` — nullable, existing rows get NULL
- `ALTER TABLE connections ADD COLUMN scan_version_id INTEGER REFERENCES scan_versions(id)` — same nullable pattern
- Auto-discovered by `database.js` via `version = 5`

### QueryEngine (`worker/db/query-engine.js`)
- `beginScan(repoId)` — inserts scan_versions row with `started_at = now`, returns `lastInsertRowid`
- `endScan(repoId, scanVersionId)` — marks `completed_at`, deletes stale connections (FK-safe order), then stale services
- `_stmtUpsertService` — now includes `scan_version_id` in INSERT + ON CONFLICT DO UPDATE
- `_stmtUpsertConnection` — now includes `scan_version_id` in INSERT OR REPLACE
- `persistFindings(repoId, findings, commit, scanVersionId)` — 4th param optional; stamps all upserted rows
- `upsertService` / `upsertConnection` — default `scan_version_id` to `null` when not provided

### Tests (`tests/storage/scan-version-bracket.test.js`)
15 tests covering:
- Migration 005 schema assertions (table exists, nullable columns, version=5)
- `beginScan` returns numeric ID, sets started_at, increments per call
- `endScan` sets completed_at, deletes stale services, preserves NULL rows, deletes connections first
- `persistFindings` stamps services and connections with scanVersionId, works without scanVersionId

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated query-engine.test.js makeQE to run all 5 migrations**
- **Found during:** Task 2 verification
- **Issue:** `query-engine.test.js`'s `makeQE()` only ran migrations 001+002. After adding `scan_version_id` to `_stmtUpsertService`/`_stmtUpsertConnection` prepared statements, the QueryEngine constructor failed with `SQLITE_ERROR` because the `scan_version_id` column didn't exist in the test DB schema.
- **Fix:** Updated `makeQE()` to run all 5 migrations in order (001, 002, 003, 004, 005), added imports for migration003-005.
- **Files modified:** `tests/storage/query-engine.test.js`
- **Commit:** 48fa435

## Verification

Both test suites pass (32 total tests, 0 failures):

```
node --test tests/storage/query-engine.test.js        # 17 pass
node --test tests/storage/scan-version-bracket.test.js # 15 pass
```

## Self-Check: PASSED

- [x] `worker/db/migrations/005_scan_versions.js` exists with `version = 5`
- [x] `tests/storage/scan-version-bracket.test.js` exists (15 tests)
- [x] Commits a780ac3 and 48fa435 exist
- [x] All 32 tests pass with exit 0
