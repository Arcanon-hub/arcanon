---
phase: 33-data-model
plan: "01"
subsystem: database
tags: [migration, sqlite, actors, node_metadata, schema]
dependency_graph:
  requires: [migrations/001_initial_schema.js, migrations/007_expose_kind.js]
  provides: [actors table, actor_connections table, node_metadata table, connections.crossing column]
  affects: [worker/db/database.js loadMigrationsAsync, future phases 34-38]
tech_stack:
  added: []
  patterns: [CREATE TABLE IF NOT EXISTS, INSERT OR IGNORE, ON DELETE CASCADE, PRAGMA table_info for idempotent ALTER TABLE]
key_files:
  created:
    - worker/db/migrations/008_actors_metadata.js
    - worker/db/migration-008.test.js
  modified: []
decisions:
  - "ALTER TABLE idempotency via PRAGMA table_info — SQLite has no ADD COLUMN IF NOT EXISTS; checking existing columns before ALTER TABLE makes migration re-runnable"
  - "Population query uses INSERT OR IGNORE into actors so re-running migration never creates duplicate actor rows"
  - "ON DELETE CASCADE on both FKs of actor_connections ensures join rows are cleaned up when either actor or service is deleted"
metrics:
  duration: "~3 minutes"
  completed_date: "2026-03-18"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  tests_written: 14
  tests_passing: 14
---

# Phase 33 Plan 01: Migration 008 — Actors, Actor Connections, Node Metadata Summary

**One-liner:** SQLite migration 008 adds actors, actor_connections, and node_metadata tables with UNIQUE constraints, CASCADE deletes, and population SQL for external connection actors.

## What Was Built

Migration 008 establishes the database foundation for Phase 33 (v3.0 Layered Graph). Three new tables and one new column:

1. **actors** — External system actors identified by unique name. Columns: id, name, kind (default 'system'), direction (default 'outbound'), source (default 'scan'). UNIQUE(name) prevents duplicate actor rows.

2. **actor_connections** — Join table linking actors to the internal services that connect to them. Columns: id, actor_id (FK → actors ON DELETE CASCADE), service_id (FK → services ON DELETE CASCADE), direction, protocol, path.

3. **node_metadata** — Extensible key/value metadata per service per view (for STRIDE, vulnerability views, etc. without future schema migrations). Columns: id, service_id (FK → services ON DELETE CASCADE), view, key, value, source, updated_at (auto-timestamp). UNIQUE(service_id, view, key) enables upsert patterns.

4. **connections.crossing** — Nullable TEXT column distinguishing internal-to-external connections ('external') from internal-to-internal (NULL). Population SQL automatically creates actor rows from connections where crossing='external'.

## Test Coverage

14 tests in `worker/db/migration-008.test.js`:
- Version export verification
- Table creation and column count verification for all 3 new tables
- UNIQUE constraint enforcement (actors.name, node_metadata composite key)
- crossing column type and nullability
- Population query: actors created from external connections
- Population query: actor_connections rows with correct protocol and path
- ON DELETE CASCADE from actors and from services
- Migration idempotency (run twice without error)
- node_metadata upsert pattern via INSERT OR REPLACE

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed idempotency for ALTER TABLE crossing column**
- **Found during:** TDD GREEN phase — Test 13 (idempotency test)
- **Issue:** `ALTER TABLE connections ADD COLUMN crossing TEXT` throws `SQLITE_ERROR: duplicate column name: crossing` when migration runs twice. SQLite has no `ADD COLUMN IF NOT EXISTS` syntax.
- **Fix:** Added a guard using `PRAGMA table_info(connections)` to check for the crossing column before executing ALTER TABLE. Only adds the column if it doesn't already exist.
- **Files modified:** worker/db/migrations/008_actors_metadata.js
- **Commit:** ee5bbb9

## Self-Check

- [x] `worker/db/migrations/008_actors_metadata.js` exists
- [x] `worker/db/migration-008.test.js` exists
- [x] `node worker/db/migration-008.test.js` exits 0 — 14 tests PASS
- [x] `node worker/db/migrations.test.js` exits 0 — regression check passes
- [x] Commits ee5bbb9 and 0390d99 exist in git log

## Self-Check: PASSED
