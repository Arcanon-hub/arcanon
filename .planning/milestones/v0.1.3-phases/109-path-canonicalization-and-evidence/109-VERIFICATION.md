---
phase: 109-path-canonicalization-and-evidence
type: verification
phase_req_ids: [TRUST-02, TRUST-03, TRUST-10, TRUST-11]
plans_completed: ["109-01", "109-02"]
verified_date: 2026-04-25
linear_ticket: THE-1022
---

# Phase 109 — Verification

## Goal Recap

Strengthen scan-ingest trust at the database write boundary:

1. **TRUST-02** — `persistFindings` rejects connections whose `evidence` is prose with no literal substring match against the cited `source_file`. Logs warning, skips connection, does not fail the scan.
2. **TRUST-03** — `persistFindings` canonicalizes `{xxx}` template variables in `conn.path` to `{_}`. Original templates preserved (comma-joined on collapse) in a new `connections.path_template` column.

## Plans Delivered

| Plan | Subsystem | Status | Tests added | Commits |
|---|---|---|---|---|
| 109-01 | worker/db (migration 013) | Complete | 5 | `50a91a3` (RED), `4a8c06e` (GREEN) |
| 109-02 | worker/db (query-engine.js write-side guards) | Complete | 16 | `a23ad61` (RED 1), `7548d44` (GREEN 1), `04a1a42` (RED 2), `20ad760` (GREEN 2) |

Total: **2 plans, 21 new tests, 6 commits across the phase**.

## Requirements Coverage

| REQ | Plan | Status | How verified |
|---|---|---|---|
| TRUST-02 (evidence rejection at ingest) | 109-02 | Complete | 7 node tests in `query-engine-evidence.test.js`; covers happy path, prose rejection, missing-file warn, null source_file silent, empty evidence opt-in, mixed batch (one rejected, one persisted), relative path resolution. |
| TRUST-03 (path canonicalization at ingest) | 109-01 + 109-02 | Complete | 9 node tests in `query-engine-canonical.test.js` + 5 migration tests in `migration-013.test.js`; covers helper unit tests (single var, multi var, passthrough, Express-style not touched, null/empty), template-variant collapse, idempotent re-scan, non-template passthrough, three-way merge dedup. |
| TRUST-10 (node test exercises rejection path) | 109-02 | Complete | `query-engine-evidence.test.js` — 7 tests; primary rejection test asserts both row absence (count=0) and stderr warning content. |
| TRUST-11 (node test exercises canonicalization) | 109-02 | Complete | `query-engine-canonical.test.js` — 9 tests; collapse test asserts 1 row + both originals comma-joined; idempotency test asserts no duplication; passthrough test asserts non-template paths unchanged. |

## Test Suites Run

| Suite | Pre-phase | Post-phase | Net |
|---|---|---|---|
| `node --test worker/db/migration-013.test.js` | n/a | 5/5 pass | +5 (109-01) |
| `node --test worker/db/query-engine-canonical.test.js` | n/a | 9/9 pass | +9 (109-02) |
| `node --test worker/db/query-engine-evidence.test.js` | n/a | 7/7 pass | +7 (109-02) |
| `node --test worker/db/query-engine-enrich.test.js` | 19/19 | 19/19 | unchanged |
| `node --test worker/db/query-engine-search.test.js` | pass | pass | unchanged |
| `node --test worker/db/*.test.js` (full DB suite) | 86/86 | 107/107 | +21, no regressions |
| `make test` (bats) | 307/308 (HOK-06 perf flake pre-existing) | 307/308 (same flake) | unchanged |

## Decisions Honored

All six CONTEXT decisions are respected by the implementation:

- **D-01** Migration version is 13 — verified in `013_connections_path_template.js` (`export const version = 13`).
- **D-02** Canonical path in `path` column, original in `path_template` — verified in `query-engine.js` `persistFindings` connection loop.
- **D-03** Whole-file substring check (no line_start window) — verified in `_validateEvidence` (single `content.indexOf(evidence)` call).
- **D-04** Literal substring, no normalization — verified by `String.prototype.indexOf` usage with no `replace` / `trim` / regex preprocessing on `content`. `evidence.trim()` is only applied to detect empty-vs-non-empty (D-05 case 1), not to the substring needle itself.
- **D-05** Lenient on null/missing/unreadable — verified by 4 dedicated test cases (null evidence, empty evidence, null source_file, missing-on-disk source_file). All persist; only the missing-on-disk case emits a warning.
- **D-06** `{xxx}` regex only, no Express `:id`, no backfill — verified by helper unit test asserting `/api/users/:id` is unchanged, and migration 013 docstring explicitly disclaiming backfill.

## Deviations from ROADMAP / Plan

**A.** Plan 109-02 assumed a 4-col UNIQUE constraint on `connections` already existed (per CONTEXT D-02 reference to `004_dedup_constraints.js`). Reality: no such constraint existed. **Resolution:** migration 013 was extended to also create `UNIQUE INDEX uq_connections_dedup` (after deduplicating any pre-existing duplicates by MAX(id) and re-pointing schemas FKs). Rationale and full details in `109-02-SUMMARY.md` § "Deviations from Plan".

**B.** Pre-existing bug in `upsertService` (returns stale `lastInsertRowid` on `ON CONFLICT DO UPDATE` path) was exposed by TRUST-11 idempotent re-scan test. **Resolution:** `upsertService` now does an explicit `SELECT id ...` lookup after the INSERT, mirroring the existing fix in `upsertRepo`. Full details in `109-02-SUMMARY.md`.

**C.** ROADMAP Phase 109 success criterion #3 said "existing rows have `path_template` populated from `path` on first run." This was deferred per CONTEXT D-06 — backfilling triggers the dedup logic against canonicalized paths for thousands of historic rows, which can collapse legitimately-distinct rows that happen to look like template-variants. New scans populate `path_template`; historic rows stay `NULL` until re-scan. Documented as deliberate.

## Out-of-Scope / Deferred

See `deferred-items.md` for two pre-existing test failures unrelated to this phase:

1. `worker/scan/manager.test.js` incremental-scan prompt test — `queryEngine._db` undefined in stub. Predates 109-02.
2. `tests/impact-hook.bats` HOK-06 p99 latency benchmark — environment-dependent threshold (50ms tight on dev machine). Predates 109-02.

Both verified pre-existing by stashing 109-02 changes and re-running.

## Phase Status

**COMPLETE.** Both plans delivered, all 4 REQs satisfied, 21 new tests passing, 0 net regressions. Ready for Phase 110.
