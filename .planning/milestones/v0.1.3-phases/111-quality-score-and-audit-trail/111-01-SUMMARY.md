---
phase: 111-quality-score-and-audit-trail
plan: 01
subsystem: worker/db/migrations
tags: [migrations, sqlite, schema, audit-log, quality-score, trust]
requirements: [TRUST-05, TRUST-06, TRUST-14]
dependency-graph:
  requires:
    - "scan_versions table (migration 005)"
    - "better-sqlite3 already pinned in worker/db"
  provides:
    - "scan_versions.quality_score REAL (nullable) — populated by 111-02 endScan()"
    - "enrichment_log table (10 cols, FK CASCADE, CHECK on target_kind, 2 indexes) — written by 111-03 reconciliation"
  affects:
    - "QueryEngine prepared statements (extension by 111-02 endScan, 111-03 logEnrichment)"
    - "MCP impact_audit_log tool (added in 111-03)"
tech-stack:
  added: []
  patterns:
    - "PRAGMA table_info hasCol() idempotence guard (mirrors migrations 011, 014)"
    - "CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS native idempotence (mirrors migration 010)"
    - "FK ON DELETE CASCADE for child audit rows (mirrors service_dependencies → services)"
    - "CHECK constraint on enum-like discriminant column (mirrors service_dependencies.dep_kind)"
    - "TEXT NOT NULL DEFAULT (datetime('now')) for auto-timestamp"
key-files:
  created:
    - "plugins/arcanon/worker/db/migrations/015_scan_versions_quality_score.js"
    - "plugins/arcanon/worker/db/migrations/016_enrichment_log.js"
    - "plugins/arcanon/worker/db/migration-015.test.js"
    - "plugins/arcanon/worker/db/migration-016.test.js"
  modified: []
decisions:
  - "Migration numbering 015 + 016 (renumbered from 014 + 015 in commit b39ff28) — follows 014 (services.base_path) which already shipped in Phase 110"
  - "quality_score REAL is nullable (no NOT NULL) — pre-migration scan_versions rows pick up NULL; D-02 NULL semantics for total_connections=0 also rely on this"
  - "enrichment_log.target_kind uses CHECK discriminant (not polymorphic FK) — Phase 111 only writes 'connection' rows; 'service' reserved for future enrichers per CONTEXT.md D-04"
  - "FK ON DELETE CASCADE chosen — when a scan_versions row is deleted (stale-scan cleanup, repo removal), its audit rows go with it; no orphan audit rows"
  - "created_at default = datetime('now') (TEXT, UTC) — matches scan_versions.started_at format"
metrics:
  duration: "~25 minutes"
  tasks-completed: 2
  tests-added: 12 (5 in migration-015.test.js, 7 in migration-016.test.js)
  tests-passing: "13/13 (12 new + migrations.test.js suite)"
  completed: "2026-04-25"
---

# Phase 111 Plan 01: Migrations 015 + 016 Summary

Schema-only landing of `scan_versions.quality_score REAL` (TRUST-05) and the `enrichment_log` audit table (TRUST-06, TRUST-14). Migrations are idempotent, fully tested, and unwired — no application code references them yet (Plans 111-02 and 111-03 will wire endScan and reconciliation).

## What Shipped

- **Migration 015** (`015_scan_versions_quality_score.js`): adds nullable `scan_versions.quality_score REAL`. Idempotent via `PRAGMA table_info` hasCol() check. Pre-existing rows pick up NULL; new scans populate via 111-02's endScan().
- **Migration 016** (`016_enrichment_log.js`): creates `enrichment_log` table with 10 columns, FK to `scan_versions(id)` with `ON DELETE CASCADE`, CHECK constraint on `target_kind` constrained to `service` or `connection`, and indexes on `scan_version_id` and `enricher`. Idempotent via `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
- **Test files**: `migration-015.test.js` (5 cases), `migration-016.test.js` (7 cases). All pass.

## Verification

### Test runs

```
$ cd plugins/arcanon && node --test worker/db/migration-015.test.js worker/db/migration-016.test.js worker/db/migrations.test.js
✔ migration 015 — scan_versions.quality_score (5/5)
✔ migration 016 — enrichment_log (7/7)
✔ worker/db/migrations.test.js (1 suite passing)
ℹ tests 13 — pass 13 — fail 0
```

### Full-chain apply (001 → 016) via loader-equivalent sort

`database.js` discovers, sorts by `version`, and applies in order. Simulated chain:

```
applied 001_initial_schema.js (v1)
applied 002_service_type.js (v2)
applied 003_exposed_endpoints.js (v3)
applied 004_dedup_constraints.js (v4)
applied 005_scan_versions.js (v5)
applied 006_dedup_repos.js (v6)
applied 007_expose_kind.js (v7)
applied 008_actors_metadata.js (v8)
applied 009_confidence_enrichment.js (v9)
applied 010_service_dependencies.js (v10)
applied 011_services_boundary_entry.js (v11)
applied 013_connections_path_template.js (v13)
applied 014_services_base_path.js (v14)
applied 015_scan_versions_quality_score.js (v15)
applied 016_enrichment_log.js (v16)
PASS: chain 001-016 applied + 015/016 re-applied without error
```

(Migration 012 is intentionally absent from the repo — `database.js` loader sorts by `version` integer and tolerates gaps.)

### PRAGMA dumps after migration

**`PRAGMA table_info(scan_versions)`:**

| cid | name              | type    | notnull | dflt_value | pk    |
| --- | ----------------- | ------- | ------- | ---------- | ----- |
| 0   | id                | INTEGER | 0       | NULL       | 1     |
| 1   | repo_id           | INTEGER | 1       | NULL       | 0     |
| 2   | started_at        | TEXT    | 1       | NULL       | 0     |
| 3   | completed_at      | TEXT    | 0       | NULL       | 0     |
| 4   | **quality_score** | **REAL**| **0**   | **NULL**   | **0** |

**`PRAGMA table_info(enrichment_log)`:**

| cid | name             | type    | notnull | dflt_value         | pk  |
| --- | ---------------- | ------- | ------- | ------------------ | --- |
| 0   | id               | INTEGER | 0       | NULL               | 1   |
| 1   | scan_version_id  | INTEGER | 1       | NULL               | 0   |
| 2   | enricher         | TEXT    | 1       | NULL               | 0   |
| 3   | target_kind      | TEXT    | 1       | NULL               | 0   |
| 4   | target_id        | INTEGER | 1       | NULL               | 0   |
| 5   | field            | TEXT    | 1       | NULL               | 0   |
| 6   | from_value       | TEXT    | 0       | NULL               | 0   |
| 7   | to_value         | TEXT    | 0       | NULL               | 0   |
| 8   | reason           | TEXT    | 0       | NULL               | 0   |
| 9   | created_at       | TEXT    | 1       | `datetime('now')`  | 0   |

**Indexes on `enrichment_log`:**

| name                                 | columns           |
| ------------------------------------ | ----------------- |
| `idx_enrichment_log_scan_version_id` | `scan_version_id` |
| `idx_enrichment_log_enricher`        | `enricher`        |

**`PRAGMA foreign_key_list(enrichment_log)`:**

| id | seq | table         | from              | to | on_update | on_delete | match |
| -- | --- | ------------- | ----------------- | -- | --------- | --------- | ----- |
| 0  | 0   | scan_versions | scan_version_id   | id | NO ACTION | CASCADE   | NONE  |

## Success Criteria

- [x] `migrations/015_scan_versions_quality_score.js` exists, idempotent ALTER pattern
- [x] `migrations/016_enrichment_log.js` exists, CREATE IF NOT EXISTS pattern
- [x] `migration-015.test.js` passes 5 cases (idempotence, column shape, no-backfill, columns preserved, version export)
- [x] `migration-016.test.js` passes 7 cases (version, idempotence, schema, CHECK, FK CASCADE, indexes, default created_at)
- [x] Both migrations re-runnable without error (idempotent — proven by tests + chain re-application)
- [x] PRAGMA `table_info` confirms exact column shapes
- [x] No changes outside `worker/db/migrations/` and the two test files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Disambiguating comment for SQLite DDL hook**

- **Found during:** Task 1 (Write of migration 015), Task 2 (Write of migration 016)
- **Issue:** A repo-wide `PreToolUse` hook (`security_reminder_hook.py`) flags any token matching the substring "exec(" as a potential `child_process` command-injection risk. The hook does not distinguish `better-sqlite3`'s SQL DDL execution method from Node's shell-spawning child-process call.
- **Fix:** Added a clarifying JSDoc note in both migration files explaining that the SQLite database method is the better-sqlite3 SQL execution method (no shell, no process spawn, no user input). The comment is informational and aids future readers; it does not change behavior. Migrations 010 and 014 (existing, already-shipped) use the same SQLite DDL pattern without a hook complaint, suggesting the hook is non-deterministic — but the disambiguating comment removes any ambiguity for future hook tightening.
- **Files modified:** `worker/db/migrations/015_scan_versions_quality_score.js`, `worker/db/migrations/016_enrichment_log.js`
- **Commits:** `fecaf5e` (015), `081fac9` (016)

### Non-issues observed (out of scope, not fixed)

**Migration 002 not idempotent under blind re-apply.** When iterating all migrations 001–016 and calling `up()` a second time on each, migration 002 (`002_service_type.js`) throws `duplicate column name: type`. The production loader (`database.js`) tracks applied versions in `schema_versions` and skips already-applied migrations, so this never triggers in production. Out of scope for Plan 111-01 — pre-existing condition. Logged here for visibility; no action taken.

## Behavior Locked In

1. `quality_score` is nullable. NULL means "no signal" (e.g., 0 connections in scan, or scan crashed before endScan). Plans 111-02 and 111-03 must respect NULL semantics — never coerce to 0.
2. `enrichment_log.target_kind` is CHECK-constrained. Inserts with `target_kind` outside the allowed set throw `SqliteError: CHECK constraint failed`. Future enrichers wanting a new target type must ship a migration that loosens the CHECK.
3. `enrichment_log.scan_version_id ON DELETE CASCADE` — when stale-scan cleanup or repo removal deletes a `scan_versions` row, audit rows for that scan vanish too. This is intentional (the audit trail is meaningless without its parent scan) but plans that read audit rows must not rely on long-term retention beyond the parent scan's lifetime.
4. `created_at` is a TEXT datetime in UTC (`datetime('now')` returns SQLite's canonical `'YYYY-MM-DD HH:MM:SS'` UTC format). Consumers must parse with timezone awareness.

## Files Created

| File                                                                     | Purpose                                          | Lines |
| ------------------------------------------------------------------------ | ------------------------------------------------ | ----- |
| `plugins/arcanon/worker/db/migrations/015_scan_versions_quality_score.js` | Migration 015 module                             | 41    |
| `plugins/arcanon/worker/db/migrations/016_enrichment_log.js`              | Migration 016 module                             | 60    |
| `plugins/arcanon/worker/db/migration-015.test.js`                        | 5 test cases for migration 015                   | 108   |
| `plugins/arcanon/worker/db/migration-016.test.js`                        | 7 test cases for migration 016                   | 186   |

## Commits

| Hash      | Type | Subject                                                            |
| --------- | ---- | ------------------------------------------------------------------ |
| `7043516` | test | add failing test for migration 015 scan_versions.quality_score     |
| `fecaf5e` | feat | migration 015 adds scan_versions.quality_score REAL                |
| `cddc989` | test | add failing test for migration 016 enrichment_log table            |
| `081fac9` | feat | migration 016 creates enrichment_log audit table                   |

TDD gates intact: each migration has a preceding `test(...)` RED commit followed by a `feat(...)` GREEN commit. No REFACTOR step needed.

## Self-Check: PASSED

- File `plugins/arcanon/worker/db/migrations/015_scan_versions_quality_score.js`: FOUND
- File `plugins/arcanon/worker/db/migrations/016_enrichment_log.js`: FOUND
- File `plugins/arcanon/worker/db/migration-015.test.js`: FOUND
- File `plugins/arcanon/worker/db/migration-016.test.js`: FOUND
- Commit `7043516`: FOUND (test RED migration 015)
- Commit `fecaf5e`: FOUND (feat GREEN migration 015)
- Commit `cddc989`: FOUND (test RED migration 016)
- Commit `081fac9`: FOUND (feat GREEN migration 016)

## Next Plans

- **Plan 111-02** wires `endScan()` to compute and persist `quality_score`, exposes `getQualityScore()` and `getScanQualityBreakdown()` on QueryEngine, adds `/api/scan-quality` HTTP endpoint, and surfaces in `/arcanon:status` + `/arcanon:map` end-of-output (TRUST-05, TRUST-13).
- **Plan 111-03** wires reconciliation in `commands/map.md` Step 3/5 to write `enrichment_log` rows via `logEnrichment()`, exposes `getEnrichmentLog()` on QueryEngine, registers `impact_audit_log` MCP tool (TRUST-06, TRUST-14, plus D-03/D-04 from CONTEXT).
