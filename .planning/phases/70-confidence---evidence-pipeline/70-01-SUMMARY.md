---
phase: 70-confidence---evidence-pipeline
plan: 01
subsystem: database
tags: [better-sqlite3, sqlite, query-engine, confidence, evidence, tdd]

# Dependency graph
requires:
  - phase: 67-db-foundation
    provides: Migration 009 adds confidence TEXT and evidence TEXT columns to connections table
provides:
  - upsertConnection() writes confidence and evidence to connections table (with migration-009-aware three-tier fallback)
  - persistFindings() passes conn.confidence and conn.evidence from agent findings to upsertConnection
  - getGraph() projects c.confidence and c.evidence on every connection object (with pre-009 graceful degradation)
  - query-engine-confidence.test.js: 4-test suite covering write, null coercion, getGraph projection, pre-migration-009 degradation
affects:
  - phase 71 (schema UI)
  - /graph API consumers expecting confidence/evidence fields on connections

# Tech tracking
tech-stack:
  added: []
  patterns: [three-tier try/catch fallback for migration-gated SQL columns (migration 009 → 008 → base)]

key-files:
  created:
    - plugins/ligamen/worker/db/query-engine-confidence.test.js
  modified:
    - plugins/ligamen/worker/db/query-engine.js

key-decisions:
  - "Three-tier try/catch for _stmtUpsertConnection: outermost tries confidence+evidence (migration 009), middle tries crossing-only (migration 008), inner is pre-migration-008 fallback — consistent with established fallback pattern"
  - "confidence: null and evidence: null added to sanitizeBindings default spread in upsertConnection — maintains existing coercion contract for optional fields"
  - "getGraph() connections SELECT wrapped in try/catch: primary SELECT projects c.confidence and c.evidence; fallback omits them on pre-migration-009 DBs without throwing"
  - "Test helper includes schemas, fields, fields_fts tables (required by QueryEngine constructor _stmtFtsFields prepared statement — not guarded by try/catch)"

patterns-established:
  - "Three-tier migration fallback: when a new migration adds columns to a table that already has a fallback chain, nest the new try as the outermost block and shift existing blocks inward"
  - "getGraph() graceful degradation: wrap each enrichment column projection in try/catch with a fallback SELECT that omits those columns"

requirements-completed: [CONF-03]

# Metrics
duration: 4min
completed: 2026-03-22
---

# Phase 70 Plan 01: Confidence & Evidence Pipeline Summary

**confidence and evidence wired from agent findings through upsertConnection into the connections table and projected in getGraph(), with three-tier migration fallback and 4-test TDD coverage**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T10:53:59Z
- **Completed:** 2026-03-22T10:57:50Z
- **Tasks:** 2
- **Files modified:** 2 (query-engine.js modified, query-engine-confidence.test.js created)

## Accomplishments
- `_stmtUpsertConnection` preparation extended to three-tier try/catch: confidence+evidence (migration 009), crossing-only (migration 008), pre-008 base fallback
- `upsertConnection()` default spread includes `confidence: null` and `evidence: null` so callers omitting fields don't throw
- `persistFindings()` now passes `conn.confidence` and `conn.evidence` to close the drop gap identified in Phase 70 plan
- `getGraph()` connections SELECT projects `c.confidence, c.evidence` wrapped in try/catch for graceful pre-migration-009 degradation
- 4-test suite: write with values, write without values (null coercion), getGraph projection, pre-009 DB no-throw

## Task Commits

Each task was committed atomically:

1. **RED — Failing tests** - `8a416e6` (test)
2. **GREEN — Implementation + passing tests** - `d539a2b` (feat)

**Plan metadata:** _(pending — created in final commit)_

_Note: TDD tasks have two commits (test RED then feat GREEN)_

## Files Created/Modified
- `plugins/ligamen/worker/db/query-engine.js` - Three-tier upsert fallback, confidence/evidence defaults, persistFindings passthrough, getGraph projection with fallback
- `plugins/ligamen/worker/db/query-engine-confidence.test.js` - 4-test TDD suite for full confidence/evidence pipeline

## Decisions Made
- Three-tier migration fallback pattern: new columns go in outermost try, prior fallbacks shift inward — consistent with `_stmtUpsertActor` and `exposed_endpoints` try/catch patterns already in codebase
- Test helper requires `schemas`, `fields`, and `fields_fts` tables even though tests don't use them — the QueryEngine constructor prepares `_stmtFtsFields` unconditionally (not guarded by try/catch), so the schema must include those tables

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test helper missing fields/schemas/fields_fts tables**
- **Found during:** Task 1/2 (GREEN phase — running tests after implementation)
- **Issue:** QueryEngine constructor prepares `_stmtFtsFields` (references `fields_fts`) unconditionally — not in a try/catch. Minimal test helper omitted those tables, causing SQLITE_ERROR on `new QueryEngine(db)`.
- **Fix:** Added `schemas`, `fields`, and `fields_fts` to both `buildDb()` and `buildDbLegacy()` test helpers — matches the schema used in query-engine-upsert.test.js
- **Files modified:** plugins/ligamen/worker/db/query-engine-confidence.test.js
- **Verification:** All 4 tests pass after fix
- **Committed in:** d539a2b (GREEN task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test helper schema)
**Impact on plan:** Required to make tests runnable. No scope creep — fix stayed within test helper only.

## Issues Encountered
- QueryEngine constructor prepares FTS5 statements unconditionally — test helpers must include the full FTS virtual table set even when testing unrelated functionality. This is a documentation gap: the plan said "keep helper minimal" but minimal was not sufficient.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- confidence and evidence now flow end-to-end from agent → DB → /graph API response
- Phase 71 (schema UI) can rely on `connections[N].confidence` and `connections[N].evidence` being present on every connection object returned by getGraph()
- No blockers

---
*Phase: 70-confidence---evidence-pipeline*
*Completed: 2026-03-22*
