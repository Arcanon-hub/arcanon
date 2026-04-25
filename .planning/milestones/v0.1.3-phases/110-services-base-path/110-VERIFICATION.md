---
phase: 110-services-base-path
type: verification
created: 2026-04-25
status: complete
plans: 1
plans_complete: 1
requirements: [TRUST-04, TRUST-12]
requirements_complete: [TRUST-04, TRUST-12]
---

# Phase 110 Verification — services.base_path End-to-End

## Phase Closure Summary

Phase 110 lands the `services.base_path` feature end-to-end across the scan pipeline:

- **Schema** — Migration 014 adds `services.base_path TEXT` (idempotent, backwards-compatible)
- **Read path** — Agent prompt + schema + findings validator accept `base_path` as optional string|null
- **Write path** — `persistFindings` -> `upsertService` writes `base_path` through a 3-tier prepared-statement fallback
- **Resolution** — `detectMismatches` strips target.base_path from outbound connection paths before comparing against exposed_endpoints (D-02 target-only, D-03 segment-boundary)

## Requirements Coverage

| Requirement | Coverage | Evidence |
|-------------|----------|----------|
| TRUST-04 — Migration adds services.base_path TEXT; agent prompt emits base_path; resolution strips before path matching | COMPLETE | Migration 014 exists; agent-prompt-service.md has base_path section + example with `/api`; detectMismatches applies stripBasePath helper |
| TRUST-12 — Node tests: migration idempotence + agent prompt emission + resolution honors base_path | COMPLETE | 27 new tests across 3 test files, all green |

## Plan Inventory

| Plan | Status | Commits | Tests Added |
|------|--------|---------|-------------|
| 110-01 services.base_path end-to-end | Complete | 35e6f53, 4e24311, f45e202, cb83c58, efb031b, ba972ee | 27 |

## Test Results

### New tests (27, all green)

```
node --test \
  plugins/arcanon/worker/db/migration-014.test.js \
  plugins/arcanon/worker/db/query-engine-base-path.test.js \
  plugins/arcanon/worker/scan/findings-base-path.test.js
# tests 27, pass 27, fail 0
```

| File                                | Tests | Description                                                   |
|-------------------------------------|-------|---------------------------------------------------------------|
| migration-014.test.js               | 4     | Version export, idempotence, column shape, row preservation   |
| findings-base-path.test.js          | 7     | Validator + prompt + schema acceptance                        |
| query-engine-base-path.test.js      | 16    | Helper + write path + resolution + backcompat                 |

### Regression (pre-existing failures only)

```
node --test plugins/arcanon/worker/db/*.test.js plugins/arcanon/worker/scan/*.test.js
# tests 325, pass 324, fail 1
```

The single failure (`manager.test.js` "incremental scan prompt contains INCREMENTAL_CONSTRAINT heading") is **pre-existing**, verified by stashing the Phase 110 changes and re-running — same failure. Tracked in `.planning/STATE.md` Blockers/Concerns section as a known unrelated issue.

```
make test  # bats suite
# 307/308 pass — HOK-06 macOS p99 latency flake (pre-existing, documented in STATE.md)
```

## Decision Outcomes

| Decision | Outcome |
|----------|---------|
| D-01 backwards-compat (additive, optional) | PRESERVED — pre-110 rows have base_path = NULL; resolution falls back to literal compare; pre-014 db handled by 3-tier upsert + try/catch in detectMismatches SQL |
| D-02 strip-on-target-only | PRESERVED — stripBasePath returns null on null/empty basePath; literal-match runs first; Test 6 (regression guard) confirms `/api/users` does NOT match `/users` when target.base_path = NULL |
| D-03 multi-segment + segment-boundary | PRESERVED — Test 5 covers `/api/v1`; Test 7 confirms `/ap` is NOT stripped from `/api/users` (substring without segment boundary) |
| D-04 detectMismatches is the resolution site | CONFIRMED — verified at planning AND execution time. JS-side filter replaces the literal `AND ep.path = c.path` SQL clause |

## Migration Numbering Note

Plan text referenced "migration 013" in several places. Phase 109's `connections.path_template` already occupies version=13. Implementation uses **version=14** as documented in the user's prompt and the migration 013 docstring (lines 39–41). Each migration's `up()` is keyed on a column-existence check, so runtime ordering between 013 and 014 commutes safely.

## Files Touched

**Created (4):**
- `plugins/arcanon/worker/db/migrations/014_services_base_path.js`
- `plugins/arcanon/worker/db/migration-014.test.js`
- `plugins/arcanon/worker/scan/findings-base-path.test.js`
- `plugins/arcanon/worker/db/query-engine-base-path.test.js`

**Modified (4):**
- `plugins/arcanon/worker/db/query-engine.js` (+142/-44)
- `plugins/arcanon/worker/scan/findings.js` (+7)
- `plugins/arcanon/worker/scan/agent-schema.json` (+1)
- `plugins/arcanon/worker/scan/agent-prompt-service.md` (+24/-3)

## Phase 110 Status: CLOSED

All TRUST-04 + TRUST-12 acceptance criteria met. Phase 110 closes 2/2 requirements with 1 plan and 27 new tests. Next phase: Phase 111 (Quality Score + Reconciliation Audit Trail — TRUST-05, 06, 13, 14).
