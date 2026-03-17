---
phase: 27-schema-foundation-upsert-repair
plan: "01"
subsystem: database
tags: [sqlite, better-sqlite3, migration, fts5, upsert, dedup]

# Dependency graph
requires: []
provides:
  - UNIQUE(repo_id, name) constraint on services table via UNIQUE INDEX (migration 004)
  - In-place deduplication of existing services rows (surviving MAX(id) row per pair)
  - canonical_name TEXT column on services (nullable)
  - FTS5 rebuild after dedup (services_fts, connections_fts, fields_fts)
  - ON CONFLICT(repo_id, name) DO UPDATE upsert for services (id preserved across re-scans)
  - getGraph() without MAX(id) GROUP BY name workaround
affects: [Phase 28, Phase 29, scan-manager, query-engine consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-place dedup: re-point FK refs then DELETE duplicates — avoids DROP TABLE FK constraint issues inside transactions"
    - "ON CONFLICT(repo_id, name) DO UPDATE SET excluded.* — preserves row id on upsert, safe for FK children"
    - "PRAGMA legacy_alter_table not reliable in SQLite 3.51+ — use in-place approach instead"

key-files:
  created:
    - worker/db/migrations/004_dedup_constraints.js
    - worker/db/migration-004.test.js
    - worker/db/query-engine-upsert.test.js
  modified:
    - worker/db/query-engine.js

key-decisions:
  - "In-place dedup (DELETE duplicates + CREATE UNIQUE INDEX) chosen over table-recreation — avoids FOREIGN KEY constraint failure when dropping renamed table inside an active transaction with foreign_keys=ON (SQLite 3.51+ always rewrites FK references on ALTER TABLE RENAME regardless of legacy_alter_table pragma)"
  - "ON CONFLICT DO UPDATE with excluded.* qualifier — without excluded., SET would be a no-op referencing existing row values"
  - "Migration 004 and ON CONFLICT rewrite shipped atomically in same plan — deploying UNIQUE constraint alone with INSERT OR REPLACE would cause DELETE+INSERT to cascade-wipe child rows"

patterns-established:
  - "Migration pattern: in-place dedup via temp _svc_id_map table, UPDATE child FKs, DELETE duplicates, CREATE UNIQUE INDEX"
  - "upsertService id stability contract: callers can store the returned id and expect connections/endpoints to survive re-scans"

requirements-completed: [SCAN-01, SCAN-02]

# Metrics
duration: 8min
completed: 2026-03-16
---

# Phase 27 Plan 01: Schema Foundation + Upsert Repair Summary

**Migration 004 adds UNIQUE(repo_id, name) via in-place dedup + UNIQUE INDEX; upsertService rewritten to ON CONFLICT DO UPDATE preserving row id across re-scans; getGraph() MAX(id) workaround removed**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-16T14:53:36Z
- **Completed:** 2026-03-16T15:01:36Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Migration 004 deduplicates existing services rows in-place, re-points all FK references (connections, exposed_endpoints), then creates UNIQUE INDEX on (repo_id, name) — surviving row is always MAX(id)
- upsertService rewritten from INSERT OR REPLACE (delete+insert, new id) to ON CONFLICT DO UPDATE SET (update in place, same id) — child connections and exposed_endpoints now survive re-scans
- getGraph() MAX(id) GROUP BY name workaround removed — clean data from migration 004 makes it unnecessary

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for migration 004** - `b4f5b4c` (test)
2. **Task 1 GREEN: Migration 004 implementation** - `89f976a` (feat)
3. **Task 2 RED: Failing tests for upsert rewrite** - `e5754b4` (test)
4. **Task 2 GREEN: upsertService + getGraph changes** - `c08bc87` (feat)

**Plan metadata:** (docs commit — see below)

_Note: TDD tasks have RED (failing test) and GREEN (implementation) commits_

## Files Created/Modified

- `worker/db/migrations/004_dedup_constraints.js` — Migration 004: in-place dedup, UNIQUE INDEX, canonical_name column, FTS5 rebuild
- `worker/db/migration-004.test.js` — 9 tests: version, no-error run, dedup, MAX(id) surviving, UNIQUE enforcement, canonical_name, FTS5, FK re-pointing, FK integrity
- `worker/db/query-engine-upsert.test.js` — 5 tests: 1-row idempotency, id preservation, child FK survival, getGraph completeness, source-level grep
- `worker/db/query-engine.js` — _stmtUpsertService ON CONFLICT DO UPDATE; getGraph WHERE clause removed

## Decisions Made

- **In-place dedup over table-recreation:** SQLite 3.51+ always rewrites FK references in child tables on `ALTER TABLE RENAME` — even with `PRAGMA legacy_alter_table = ON`. When you then `DROP TABLE services_old` inside a transaction with `foreign_keys = ON`, it fails with SQLITE_CONSTRAINT_FOREIGNKEY. Switching to in-place dedup (temp id map → UPDATE FKs → DELETE duplicates → CREATE UNIQUE INDEX) avoids this entirely.

- **ON CONFLICT with `excluded.*`:** The `excluded.` prefix references the incoming proposed values. Without it, `SET root_path = root_path` is a no-op that keeps the existing value — correct for this use case but misleading; `excluded.root_path` is explicit and correct.

- **Atomic shipment:** Migration 004 + ON CONFLICT rewrite shipped in the same plan as designed. If only the UNIQUE constraint were deployed first, the existing `INSERT OR REPLACE` would attempt DELETE+INSERT on conflict — triggering ON DELETE CASCADE and wiping connections, exposed_endpoints, schemas, and fields for that service.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] In-place dedup strategy to work around SQLite FK constraint inside transaction**
- **Found during:** Task 1 (migration 004 implementation)
- **Issue:** Plan specified table-recreation pattern (RENAME → CREATE → COPY → DROP). In SQLite 3.51.3, `ALTER TABLE RENAME` rewrites FK schema references even with `legacy_alter_table = ON`. Subsequent `DROP TABLE services_old` inside a `foreign_keys = ON` transaction fails with `SQLITE_CONSTRAINT_FOREIGNKEY`. `PRAGMA foreign_keys = OFF` cannot be set inside an active transaction.
- **Fix:** Replaced table-recreation with in-place dedup: temp id map → UPDATE FK references → DELETE non-MAX(id) duplicates → `CREATE UNIQUE INDEX uq_services_repo_name ON services(repo_id, name)` → `ALTER TABLE services ADD COLUMN canonical_name TEXT`
- **Files modified:** worker/db/migrations/004_dedup_constraints.js
- **Verification:** All 9 migration-004 tests pass; UNIQUE constraint enforced; FTS5 working; FK integrity confirmed
- **Committed in:** `89f976a` (Task 1 GREEN)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug: SQLite table-recreation FK constraint failure)
**Impact on plan:** Fix is a better approach than the original plan — simpler, no table drop/rename, same outcome. No scope creep.

## Issues Encountered

- SQLite 3.51.3 rewriting behavior with `ALTER TABLE RENAME` — discovered during RED→GREEN iteration, resolved with in-place strategy on first fix attempt (Rule 1).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Migration 004 is deployed — Phase 28 (agent naming normalization, SCAN-04) can proceed without schema conflicts
- Phase 29 pool.js inline migration workaround (lines 178-202) should be audited — migration 004 + ON CONFLICT rewrite make it safe to remove if it was working around the duplicate-id issue
- UNIQUE INDEX is now the authoritative constraint — no application-level dedup needed in scan-manager
