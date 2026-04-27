---
phase: 117-scan-overrides-persistence-layer-migration-apply-hook
plan: 01
subsystem: worker/db (persistence layer)
tags: [scan-overrides, migration-017, query-engine, persistence, CORRECT-01, CORRECT-02]
requirements_satisfied: [CORRECT-01, CORRECT-02]
dependency_graph:
  requires:
    - migrations 001..016 (existing chain)
    - QueryEngine class shape (constructor + try/catch fallback pattern from mig 016)
  provides:
    - scan_overrides table (8 columns + 2 indexes)
    - QueryEngine.upsertOverride / getPendingOverrides / markOverrideApplied
  affects:
    - Plan 117-02 (apply-hook) — consumes all three helpers + the migration
    - Plan 118-01 (/arcanon:correct) — consumes upsertOverride
    - Plan 118-02 (/rescan) — consumes the apply-hook (transitive)
    - Plan 119-01 (shadow scan) — reuses overrides via the apply-hook (transitive)
tech_stack:
  added: []
  patterns:
    - "try/catch-arming prepared statements for optional tables (mirrors mig 016)"
    - "Polymorphic target_id with no FK; CHECK on `kind` is the discriminant (mirrors enrichment_log)"
    - "JSON-stringified payload at write; JSON.parse deferred to apply-hook"
    - "Per-override apply granularity via markOverrideApplied(id, scan_version_id)"
key_files:
  created:
    - plugins/arcanon/worker/db/migrations/017_scan_overrides.js
    - plugins/arcanon/worker/db/migration-017.test.js
    - plugins/arcanon/worker/db/query-engine.scan-overrides.test.js
  modified:
    - plugins/arcanon/worker/db/query-engine.js
    - plugins/arcanon/CHANGELOG.md
decisions:
  - "Migration 017 idempotency via CREATE TABLE/INDEX IF NOT EXISTS (no PRAGMA guard)"
  - "Helpers no-op (null/[]/null) on pre-017 db via constructor try/catch — downgrade-safe"
  - "No JS pre-validation of kind/action — SQL CHECK is single source of truth"
  - "FK ON DELETE SET NULL on applied_in_scan_version_id (not CASCADE) — preserves operator audit trail across scan_versions cleanup; rows re-enter pending set on parent deletion"
metrics:
  duration_minutes: ~12
  tasks_completed: 5
  files_created: 3
  files_modified: 2
  tests_added: 19
  tests_passing: 37
  completed_date: 2026-04-25
---

# Phase 117 Plan 01: scan_overrides Persistence Layer Summary

**One-liner:** Ships migration 017 (`scan_overrides` table + 2 indexes) and three additive `QueryEngine` helpers (`upsertOverride`, `getPendingOverrides`, `markOverrideApplied`) that the apply-hook (Plan 117-02) and `/arcanon:correct` (Phase 118) will both consume — no writes to existing tables, downgrade-safe via constructor try/catch fallback.

## What Shipped

1. **Migration 017** — new `scan_overrides` table (8 columns: `override_id` PK, `kind` CHECK, `target_id`, `action` CHECK, `payload` TEXT/JSON default `'{}'`, `created_at`, `applied_in_scan_version_id` FK with `ON DELETE SET NULL`, `created_by` default `'system'`) + two indexes (`idx_scan_overrides_kind_target`, `idx_scan_overrides_pending`). Idempotent via `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.

2. **Three QueryEngine helpers** added after `getEnrichmentLog`:
   - `upsertOverride({kind, target_id, action, payload?, created_by?}) → override_id` (JSON-stringifies payload; defaults `payload={}`, `created_by='system'`)
   - `getPendingOverrides() → rows[]` (filters `applied_in_scan_version_id IS NULL`; sorts `created_at ASC, override_id ASC`)
   - `markOverrideApplied(overrideId, scanVersionId) → changes` (per-override granularity)

3. **Constructor block** — three new prepared-statement slots arm in a try/catch so a pre-mig-017 DB cleanly disables the helpers (statements stay `null`; helpers no-op with `null`/`[]`/`null`).

4. **19 new tests across 2 files** — 9 migration schema/idempotency tests + 10 QueryEngine round-trip / fallback / SQL-CHECK / FK-SET-NULL tests. All 37 plan-scope tests pass (the 19 new + 8 enrichment-log + 10 quality-score regression checks).

5. **CHANGELOG entry** — single line under Unreleased / Added: "scan_overrides table (migration 017) for staged operator corrections (CORRECT-01)."

## Discuss-Phase Questions Resolved

This phase originally carried `requires_discuss: true`. The discuss-phase was skipped per user choice. The plan author resolved every decision inline against RESEARCH.md Section 5; the resolutions baked into Plan 117-01 are listed here for traceability:

| # | Question | Resolution | Rationale |
|---|----------|-----------|-----------|
| D-01 | Timestamp format for `created_at`? | TEXT ISO-string via `datetime('now')` default | Uniform with every other table in the schema; SQLite-native |
| D-02 | Conflict resolution if a finding overlaps an override? | Override wins — handled by Plan 117-02 (apply-hook runs AFTER persistFindings) | Operator intent supersedes scanner output |
| D-03 | Apply granularity: per-override or per-batch? | Per-override (`markOverrideApplied(id, scan_version_id)` signature) | Partial-failure visibility; enables future re-try of failed individual overrides |
| D-04 | Dangling `target_id` (target row deleted)? | Schema does NOT constrain; apply-hook (Plan 117-02) logs+skips at apply time | Same approach as `enrichment_log.target_id` (mig 016); avoids polymorphic FK gymnastics |
| D-05 | Polymorphic target FK enforcement? | NOT enforced — `kind` CHECK is the discriminant; `target_id` is bare INTEGER | SQLite has no polymorphic FK support; CHECK + apply-time validation is the canonical workaround |
| D-06 | `payload` JSON shape per action? | Documented in RESEARCH §5; NOT validated at SQL layer (apply-hook validates at apply time) | Schema validation belongs at the boundary that knows the per-action contract; SQL CHECK on a JSON blob is brittle |
| D-07 | `applied_in_scan_version_id` FK behavior on parent delete? | `ON DELETE SET NULL` (NOT CASCADE) | Preserves operator audit trail across scan_versions cleanup; row re-enters pending set on parent deletion (verified by Test 8) |
| D-08 | `created_by` default? | `'system'` | Future authentication work will populate operator identity; `'system'` is the safe default for the v0.1.4 unauthenticated baseline |
| D-09 | Allowed `action` values? | `delete`, `update`, `rename`, `set-base-path` (CHECK-enforced) | Covers the four operations `/arcanon:correct` will surface in Phase 118; new actions = new migration |
| D-10 | Allowed `kind` values? | `connection`, `service` (CHECK-enforced) | The two override-able row types in v0.1.4; future kinds (e.g., `actor`) = new migration |
| D-11 | Hook signature (for Plan 117-02)? | `(qe, scanVersionId) → {applied, skipped, errors}` (signature locked in 117-01's interface contract; implemented by 117-02) | Clean separation: 117-01 ships the helpers; 117-02 ships the orchestrator that calls them |

All eleven decisions are now durable in the migration DDL, the helper signatures, and the test contracts.

## Deviations from Plan

**None — plan executed exactly as written.**

The plan added 5 extra coverage tests beyond the 5 required (defaults, FK SET NULL semantics, both CHECK constraints exercised independently). Each is additive and matches the plan's verification intent.

## Key Architectural Notes Carried Forward

- **Pre-mig-017 fallback is the downgrade contract.** A newer codebase running against an older DB (the rollback scenario) loads `QueryEngine`, the three statements fail to arm, and every helper returns the documented null/[]/null sentinel. No code path crashes. Plan 117-02 must preserve this contract when it adds its apply-hook.
- **`payload` is opaque TEXT at the SQL layer.** Plan 117-02 owns shape validation; introducing a JSON SQL CHECK now would lock in a shape before the apply-hook is even written.
- **No `target_id` FK.** Plan 117-02's apply-hook is the single point that resolves `(kind, target_id)` against the live tables and decides whether to apply, skip-with-log, or surface as an error.
- **`manager.js` was not touched.** Plan 117-02 is the first plan to write into the persist→apply→endScan bracket; this plan's threat model + scope explicitly excluded `manager.js`.

## Verification Summary

| Gate | Expected | Actual |
|------|----------|--------|
| `node --test worker/db/migration-017.test.js` | 9 pass | 9 pass |
| `node --test worker/db/query-engine.scan-overrides.test.js` | ≥5 pass | 10 pass |
| `node --test worker/db/query-engine.enrichment-log.test.js` | unchanged (8 pass) | 8 pass |
| `node --test worker/db/query-engine.quality-score.test.js` | unchanged (10 pass) | 10 pass |
| `grep -c "scan_overrides" query-engine.js` | ≥4 | 6 |
| `grep -c "export const version = 17"` mig file | 1 | 1 |
| `grep -c "scan_overrides table (migration 017)"` CHANGELOG | 1 | 1 |
| `manager.js` untouched in this plan's commits | 0 changes | 0 |

## Commits (5)

| # | Hash    | Message |
|---|---------|---------|
| 1 | 64b18b2 | feat(117-01): add migration 017 scan_overrides table (CORRECT-01) |
| 2 | ade3ada | test(117-01): add migration 017 schema + idempotency tests |
| 3 | 22fff6e | feat(117-01): wire scan_overrides helpers on QueryEngine (CORRECT-02) |
| 4 | 4241538 | test(117-01): add round-trip tests for scan_overrides QueryEngine helpers |
| 5 | affa252 | docs(117-01): add CHANGELOG entry for scan_overrides table (CORRECT-01) |

## Self-Check: PASSED

- FOUND: plugins/arcanon/worker/db/migrations/017_scan_overrides.js
- FOUND: plugins/arcanon/worker/db/migration-017.test.js
- FOUND: plugins/arcanon/worker/db/query-engine.scan-overrides.test.js
- FOUND: commit 64b18b2 (mig file)
- FOUND: commit ade3ada (mig test)
- FOUND: commit 22fff6e (query-engine wiring)
- FOUND: commit 4241538 (query-engine test)
- FOUND: commit affa252 (CHANGELOG)
- All 37 plan-scope tests pass; all 4 grep gates pass; manager.js untouched (0 changes).
