---
phase: 30-storage-correctness
plan: "02"
subsystem: database
tags: [sqlite, better-sqlite3, query-engine, migrations, tdd, node-test]

# Dependency graph
requires:
  - phase: 30-storage-correctness/30-01
    provides: "kind column on exposed_endpoints (migration 007) + malformed-row purge"
provides:
  - "Type-conditional dispatch in persistFindings() — service/library/sdk/infra each write correct kind value"
  - "Full function signatures and resource refs stored without whitespace-split garbling"
  - "NULL-safe UNIQUE index on exposed_endpoints — dedup works for method=NULL rows"
affects:
  - "30-storage-correctness/30-03"
  - "Phase 32: library/infra detail panels — panels can now SELECT by kind='export' or kind='resource'"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD with node:test built-in runner — RED commit, then GREEN commit"
    - "SQLite COALESCE in UNIQUE index to treat NULL values as equal for deduplication"

key-files:
  created:
    - tests/storage/query-engine-upsert.test.js
  modified:
    - worker/db/query-engine.js
    - worker/db/migrations/007_expose_kind.js

key-decisions:
  - "COALESCE(method, '') in UNIQUE index on exposed_endpoints — SQLite NULL != NULL in UNIQUE constraints; without COALESCE, library/infra re-scans would insert duplicate rows instead of deduplicating"
  - "Migration 007 table recreation strategy — ALTER TABLE cannot drop inline UNIQUE constraints in SQLite; must recreate table to replace UNIQUE(service_id, method, path) with the COALESCE index"

patterns-established:
  - "Type dispatch in persistFindings(): check svc.type before splitting — service splits METHOD PATH, library/sdk stores raw string with kind=export, infra stores raw string with kind=resource"

requirements-completed:
  - STORE-03

# Metrics
duration: 15min
completed: 2026-03-17
---

# Phase 30 Plan 02: Type-Conditional persistFindings() Dispatch Summary

**persistFindings() now dispatches on svc.type — library/sdk exports and infra resources stored as raw strings with kind='export'/'resource', service endpoints split METHOD/PATH with kind='endpoint', and a COALESCE unique index prevents NULL-method duplicate rows on re-scan**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-17T15:25:00Z
- **Completed:** 2026-03-17T15:40:00Z
- **Tasks:** 1 (TDD: RED + GREEN commits)
- **Files modified:** 3

## Accomplishments

- Replaced whitespace-split-only loop in `persistFindings()` with type-conditional dispatch — library/sdk/infra exposes no longer garbled
- Added 7 test cases covering all three node kinds, path-only service endpoints, a v1-path regression case, and idempotent re-scan dedup
- Fixed SQLite NULL-equality dedup bug in migration 007 — `UNIQUE(service_id, COALESCE(method, ''), path)` index replaces the table-level `UNIQUE(service_id, method, path)` constraint

## Task Commits

Each task was committed atomically (TDD):

1. **RED — Failing tests for STORE-03** - `cb76280` (test)
2. **GREEN — Type-conditional dispatch + migration 007 COALESCE index** - `ae65c68` (feat)

## Files Created/Modified

- `tests/storage/query-engine-upsert.test.js` — 7 test cases for STORE-03 kind dispatch across service/library/sdk/infra types (314 lines)
- `worker/db/query-engine.js` — Replaced exposes loop in `persistFindings()` (lines 796-815): added type-conditional dispatch on `svc.type`, updated INSERT to include `kind` column
- `worker/db/migrations/007_expose_kind.js` — Added table recreation + COALESCE unique index to fix NULL-method dedup (auto-fix, Rule 1)

## Decisions Made

- **COALESCE unique index** — SQLite treats NULL != NULL in UNIQUE constraints, so `INSERT OR IGNORE` on a row with `method=NULL` was always inserting a new row (never ignoring). Fixed by replacing the inline `UNIQUE(service_id, method, path)` with `CREATE UNIQUE INDEX ... ON exposed_endpoints(service_id, COALESCE(method, ''), path)`.
- **Table recreation in migration 007** — SQLite's `ALTER TABLE` cannot drop inline UNIQUE constraints. Only way to replace the constraint is to recreate the table. Data is preserved via `INSERT INTO ... SELECT`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed NULL-method dedup: SQLite UNIQUE constraint ignores NULL equality**
- **Found during:** Task 1 GREEN phase (dedup test)
- **Issue:** `UNIQUE(service_id, method, path)` in migration 003 (table-level constraint) treats two NULL method values as distinct — SQLite's `IS DISTINCT FROM` semantics. Every call to `persistFindings()` for a library/infra service would insert new duplicate rows rather than ignoring them.
- **Fix:** Updated migration 007 to recreate `exposed_endpoints` table without the inline UNIQUE constraint and add `CREATE UNIQUE INDEX uq_exposed_endpoints ON exposed_endpoints(service_id, COALESCE(method, ''), path)`. COALESCE maps NULL → '' so two rows with method=NULL and same path are considered duplicate.
- **Files modified:** `worker/db/migrations/007_expose_kind.js`
- **Verification:** Dedup test passes (7/7 green). Migration-007 suite still passes (11/11).
- **Committed in:** `ae65c68` (GREEN phase commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in schema constraint)
**Impact on plan:** Auto-fix was essential for correctness — the dedup requirement in the plan spec cannot be met without the COALESCE index. No scope creep; both files (migration + query-engine) are in the plan's file list.

## Issues Encountered

- Pre-existing failures in `tests/storage/query-engine.test.js` (16/17 fail) — these regressions existed before this plan and are out of scope. The plan's full-phase verification command `migration-007.test.js + query-engine-upsert.test.js` passes 18/18.

## Next Phase Readiness

- `exposed_endpoints.kind` column is now populated correctly for all three node types — Phase 32 library/infra panels can query `SELECT ... WHERE kind = 'export'` or `WHERE kind = 'resource'`
- The COALESCE unique index is in place — re-scans are idempotent for all node types
- No blockers for Phase 30 Plan 03 or Phase 32

---
*Phase: 30-storage-correctness*
*Completed: 2026-03-17*
