---
phase: 30-storage-correctness
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, migrations, exposed_endpoints]

# Dependency graph
requires: []
provides:
  - "Migration 007: kind TEXT NOT NULL DEFAULT 'endpoint' column on exposed_endpoints"
  - "Migration 007: DELETE purge of malformed rows (method IS NULL AND path NOT LIKE '/%')"
  - "11 automated tests proving STORE-01 and STORE-02 correctness"
affects: [30-02, 31-graph-embedding, 32-detail-panels]

# Tech tracking
tech-stack:
  added: []
  patterns: ["TDD: RED test-import-fails, GREEN migration-passes, no REFACTOR needed"]

key-files:
  created:
    - worker/db/migrations/007_expose_kind.js
    - tests/storage/migration-007.test.js
  modified: []

key-decisions:
  - "DELETE predicate validated: method IS NULL AND path NOT LIKE '/%' correctly targets malformed library/infra rows while preserving valid null-method REST rows (e.g. /health)"
  - "kind column is NOT NULL DEFAULT 'endpoint' — enforces discriminant presence while backfilling all existing rows to 'endpoint' implicitly via ALTER TABLE default"

patterns-established:
  - "Migration pattern: export const version = N; export function up(db) using db.exec()"
  - "Test pattern: makeTestDb() runs migrations 001-N, seed data inserted before final migration, db.close() after each test"

requirements-completed: [STORE-01, STORE-02]

# Metrics
duration: 2min
completed: 2026-03-17
---

# Phase 30 Plan 01: Storage Correctness — Migration 007 Summary

**SQLite migration adding `kind TEXT NOT NULL DEFAULT 'endpoint'` to exposed_endpoints and purging malformed library/infra rows via `DELETE WHERE method IS NULL AND path NOT LIKE '/%'`**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-17T15:20:46Z
- **Completed:** 2026-03-17T15:22:21Z
- **Tasks:** 1 (TDD: 2 commits — test then migration)
- **Files modified:** 2

## Accomplishments
- Migration 007 adds the `kind` discriminant column required for all v2.3 type-specific data
- Malformed rows from broken library/infra scans purged — `INSERT OR IGNORE` no longer silently blocks correct rows on re-scan
- 11 automated tests confirm STORE-01 (column existence, default, backfill) and STORE-02 (purge predicate, valid-row survival) behaviors

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing test for migration-007** - `bb5f5da` (test)
2. **Task 1 GREEN: implement migration 007** - `4f53fbe` (feat)

_Note: TDD task had 2 commits (test RED → feat GREEN). No REFACTOR needed._

## Files Created/Modified
- `worker/db/migrations/007_expose_kind.js` - Migration 007: adds kind column (STORE-01), purges malformed rows (STORE-02)
- `tests/storage/migration-007.test.js` - 11 unit tests covering column PRAGMA, default value, row insert, REST survival, malformed purge, valid-null-method survival, COUNT=0 assertion

## Decisions Made
- DELETE predicate confirmed: `method IS NULL AND path NOT LIKE '/%'` is the correct boundary. Validated against: malformed library rows (`ClientConfig):`, function signatures), malformed infra rows (`→`), and valid null-method REST endpoints (`/health`) which must survive.
- `NOT NULL DEFAULT 'endpoint'` chosen over nullable: enforces discriminant presence on all future inserts, and ALTER TABLE default silently backfills all existing rows to 'endpoint' without an UPDATE sweep.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Migration 007 is complete and tested. Plan 30-02 can now land the fixed parser that tags rows with `kind='library'` or `kind='infra'` and re-inserts previously blocked rows.
- The `exposed_endpoints` table UNIQUE(service_id, method, path) constraint is now clean — no malformed occupants to block re-scan inserts.
- Blocker from STATE.md resolved: DELETE predicate `method IS NULL AND path NOT LIKE '/%'` confirmed correct at test time.

---
*Phase: 30-storage-correctness*
*Completed: 2026-03-17*

## Self-Check: PASSED

- FOUND: worker/db/migrations/007_expose_kind.js
- FOUND: tests/storage/migration-007.test.js
- FOUND: .planning/phases/30-storage-correctness/30-01-SUMMARY.md
- FOUND commit: bb5f5da (test RED)
- FOUND commit: 4f53fbe (feat GREEN)
- FOUND commit: 650c12f (docs metadata)
