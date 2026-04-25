---
phase: 109-path-canonicalization-and-evidence
plan: 01
subsystem: worker/db
tags: [migration, sqlite, schema, path-canonicalization, trust-03]
requirements: [TRUST-03]
requires: []
provides:
  - "connections.path_template TEXT column"
  - "Migration 013 idempotency contract"
affects:
  - "Plan 109-02 (persistFindings canonicalization writes path_template)"
  - "Phase 112 /arcanon:verify (display layer reads path_template)"
tech-stack:
  added: []
  patterns:
    - "Idempotent ALTER TABLE ADD COLUMN via PRAGMA table_info guard (mirrors migration 011)"
key-files:
  created:
    - "plugins/arcanon/worker/db/migrations/013_connections_path_template.js"
    - "plugins/arcanon/worker/db/migration-013.test.js"
  modified: []
decisions:
  - "Migration version is 13 (D-01); 012 reserved for Phase 110 services.base_path. Loader sorts by exported version int, not filename, so out-of-order delivery is safe."
  - "Reuse existing `path` column for canonical form; new `path_template` column stores original template(s) (D-02). Preserves API surface and existing 4-col UNIQUE dedup constraint."
  - "No backfill of historic rows (D-06). Pre-migration rows retain path_template = NULL; only re-scans populate the column. Backfill would silently collapse legitimately-distinct rows that look like template-variants."
  - "No index on path_template — no read-side query filters by it this phase. Phase 112 reads it via connections.id joins."
metrics:
  duration_minutes: ~2
  tasks_completed: 1
  files_changed: 2
  tests_added: 5
  tests_passing: 5
  completed_date: 2026-04-25
---

# Phase 109 Plan 01: Migration 013 — connections.path_template Summary

Add an idempotent SQLite migration introducing `connections.path_template TEXT`, enabling Plan 109-02 to record the original (un-canonicalized) path template(s) when persistFindings collapses template-variant connections to a single canonical row.

## What Shipped

- **`013_connections_path_template.js`** — `version: 13`, idempotent `up(db)` using a `PRAGMA table_info` guard before `ALTER TABLE connections ADD COLUMN path_template TEXT`. Pattern lifted directly from migration 011.
- **`migration-013.test.js`** — 5 `node --test` cases:
  1. `version === 13` export
  2. Idempotency (running `up()` twice does not throw)
  3. Column shape — `path_template` exists with `type === 'TEXT'`, `notnull === 0`
  4. Nullability — insert without `path_template` succeeds, returns `null`
  5. No backfill (D-06) — pre-migration row's `path_template` stays `NULL` after migration; `path` column unchanged

## Verification

| Suite | Result |
|---|---|
| `node --test worker/db/migration-013.test.js` | 5/5 pass |
| `node --test worker/db/migrations.test.js` | pass (no regression in chained-migration loader test) |
| `node --test worker/db/database.test.js` | pass (no regression in `openDb()` migration application) |

## Commits

| Phase | Commit | Description |
|---|---|---|
| RED  | `50a91a3` | `test(109-01): add failing tests for connections.path_template column` |
| GREEN | `4a8c06e` | `feat(109-01): implement migration 013 connections.path_template` |

REFACTOR commit was unnecessary — the implementation is already minimal and structurally identical to migration 011.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] JSDoc comment terminator collision**

- **Found during:** Task 1 GREEN test run (immediately after writing the implementation)
- **Issue:** The original implementation comment referenced the path `.planning/phases/109-*/109-CONTEXT.md`. The `*/` substring inside that glob pattern terminated the JSDoc block early, producing `SyntaxError: Unexpected identifier 'D'` at module load.
- **Fix:** Replaced the `*` glob with the literal directory name `109-path-canonicalization-and-evidence`.
- **Files modified:** `plugins/arcanon/worker/db/migrations/013_connections_path_template.js`
- **Commit:** Folded into the GREEN commit (`4a8c06e`) — the broken state never reached `git` because the GREEN tests caught it before commit.

No other deviations. Plan executed verbatim.

## TDD Gate Compliance

- **RED gate:** `50a91a3` (`test(109-01): ...`) — 3/5 tests failed as required (column-shape, nullable insert, no-backfill); 2 trivially-passing tests (version export, idempotency-of-empty-up) are not RED concerns.
- **GREEN gate:** `4a8c06e` (`feat(109-01): ...`) — 5/5 tests pass.
- **REFACTOR gate:** None needed; implementation is already minimal.

## Out-of-Scope Items Observed

The working tree contained pre-existing untracked/modified files from prior sessions, none touched by this plan:

- `tests/install-deps.bats` (modified, prior plan)
- `CLAUDE.md` (untracked, project instruction file)
- `.planning/phases/108-update-timeout-and-deprecated-removal/108-01-SUMMARY.md` (untracked, prior plan artifact)

These were left alone per the executor's scope-boundary rule.

## Self-Check: PASSED

- File `plugins/arcanon/worker/db/migrations/013_connections_path_template.js` — FOUND
- File `plugins/arcanon/worker/db/migration-013.test.js` — FOUND
- File `.planning/phases/109-path-canonicalization-and-evidence/109-01-SUMMARY.md` — FOUND (this file)
- Commit `50a91a3` — FOUND in `git log`
- Commit `4a8c06e` — FOUND in `git log`
- 5/5 tests pass in `node --test worker/db/migration-013.test.js`
- No regression in `migrations.test.js` or `database.test.js`
