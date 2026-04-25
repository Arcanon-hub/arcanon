---
phase: 110-services-base-path
plan: 01
subsystem: arcanon-worker (db + scan)
tags: [services.base_path, migration-014, resolution, TRUST-04, TRUST-12, phase-110]
requirements: [TRUST-04, TRUST-12]
status: complete
completed: 2026-04-25
duration_min: 13
tasks_completed: 3
files_created:
  - plugins/arcanon/worker/db/migrations/014_services_base_path.js
  - plugins/arcanon/worker/db/migration-014.test.js
  - plugins/arcanon/worker/scan/findings-base-path.test.js
  - plugins/arcanon/worker/db/query-engine-base-path.test.js
files_modified:
  - plugins/arcanon/worker/db/query-engine.js
  - plugins/arcanon/worker/scan/findings.js
  - plugins/arcanon/worker/scan/agent-schema.json
  - plugins/arcanon/worker/scan/agent-prompt-service.md
dependency_graph:
  requires:
    - "Migration 011 (services.boundary_entry) — extended by the 3-tier upsertService fallback"
    - "Migration 013 (connections.path_template) — already shipped; ordering-only dependency"
  provides:
    - "services.base_path TEXT column in DB schema"
    - "stripBasePath(connPath, basePath) helper exported from query-engine.js"
    - "detectMismatches now applies base_path stripping in JS at the join site"
    - "Agent emits base_path; validator accepts it; persistFindings writes it"
  affects:
    - "All future scans of services with reverse-proxy / framework prefix-stripping (Express app.use, Spring @RequestMapping, FastAPI prefix, NestJS @Controller, nginx /api/, k8s Ingress prefix-rewrite)"
    - "detectMismatches output (fewer false-mismatch findings post-rescan)"
tech_stack:
  added: []
  patterns:
    - "3-tier prepared-statement try/catch fallback (mirrors connections.path_template pattern)"
    - "JS-side strip-then-compare in detectMismatches (SQL-side strip would be awkward)"
    - "Idempotent ALTER TABLE via PRAGMA table_info pre-check"
key_files:
  created:
    - "plugins/arcanon/worker/db/migrations/014_services_base_path.js (40 LOC, idempotent ALTER TABLE)"
    - "plugins/arcanon/worker/db/migration-014.test.js (4 tests — version export, idempotence, column shape, pre-existing-row preservation)"
    - "plugins/arcanon/worker/scan/findings-base-path.test.js (7 tests — validator A/B/C/D/E + prompt F + schema G)"
    - "plugins/arcanon/worker/db/query-engine-base-path.test.js (16 tests — 7 stripBasePath unit + 3 write + 5 resolution + 1 backcompat)"
  modified:
    - "plugins/arcanon/worker/db/query-engine.js (+142/-44): stripBasePath helper + 3-tier upsertService fallback + base_path-aware detectMismatches"
    - "plugins/arcanon/worker/scan/findings.js (+7): warn-and-skip on bad base_path type, accepts string|null"
    - "plugins/arcanon/worker/scan/agent-schema.json (+1): declares base_path on services.items"
    - "plugins/arcanon/worker/scan/agent-prompt-service.md (+24/-3): new 'base_path Field (optional)' section with 6 framework examples + example service uses /api"
decisions:
  - "D-01 (CONTEXT) backwards-compat preserved: pre-110 service rows have base_path = NULL and resolution falls back to literal compare. No backfill."
  - "D-02 (CONTEXT) target-only stripping: stripBasePath returns null when target.base_path is absent; literal-match runs first so D-02 negative path is correct by construction."
  - "D-03 (CONTEXT) segment-boundary check: stripBasePath only strips when bp === connPath OR connPath.startsWith(bp + '/'). Substring-without-boundary case (/ap inside /api/users) returns null."
  - "D-04 (CONTEXT) confirmed: detectMismatches IS the resolution site. The original SQL `AND ep.path = c.path` was replaced with a JS loop that pulls target.base_path and tries literal-then-stripped match per row."
  - "Migration numbering corrected from 'migration 013' (plan text, stale) to migration 014. Phase 109's connections.path_template already occupies version=13."
  - "_hasBasePath flag used to delete the @base_path bind key on pre-014 dbs — mirrors the _hasPathTemplate pattern in upsertConnection."
  - "stripBasePath exported from query-engine.js (rather than module-private) so the helper unit tests can exercise the algorithm in isolation."
metrics:
  duration_min: 13
  task_count: 3
  test_count_added: 27
  file_count: 8
---

# Phase 110 Plan 01: services.base_path End-to-End Summary

**One-liner:** Land services.base_path through the full ingest pipeline — migration 014 adds the column, the agent prompt + schema + findings validator accept it, persistFindings writes it, and detectMismatches strips it from outbound paths before matching exposed endpoints, eliminating reverse-proxy false-mismatch findings.

## What Changed

### 1. Migration 014 (write-side schema)

`plugins/arcanon/worker/db/migrations/014_services_base_path.js` (40 LOC) adds `services.base_path TEXT` idempotently. Mirrors the migration 011 pattern (PRAGMA table_info pre-check, no backfill). The migration loader sorts by exported `version` integer, so 014 runs after 013 (connections.path_template, Phase 109).

### 2. Agent Read Path

- **`agent-prompt-service.md`** — new "## base_path Field (optional)" section with 6 framework examples (Express `app.use('/api', router)`, Spring `@RequestMapping("/api")`, FastAPI `prefix="/api"`, NestJS `@Controller({ path: 'api' })`, nginx `proxy_pass`, k8s Ingress prefix-rewrite) and explicit "when NOT to emit" guidance. Example service in the JSON now sets `base_path: "/api"` and the example connection uses `/api/auth/validate` to demonstrate strip behavior end-to-end.
- **`agent-schema.json`** — declares `base_path` on `properties.services.items`.
- **`findings.js`** — validator accepts `base_path` as optional `string | null`; warns + skips on bad type (mirrors `root_path` / `language` pattern). The validator's existing `{ ...obj, services: validServices }` spread preserves the field on accepted services without further change.

### 3. Persistence (write path)

- **3-tier `_stmtUpsertService` fallback** in `QueryEngine` constructor:
  - Tier 0 (newest): `boundary_entry + base_path` — post-migration-014.
  - Tier 1: `boundary_entry` only — post-migration-011, pre-014.
  - Tier 2: pre-011 plain shape.
  - `this._hasBasePath` flag drives `delete sanitized.base_path` so pre-014 dbs don't reject the extra `@base_path` named param (matches the `_hasPathTemplate` pattern).
- **`upsertService`** defaults `base_path: null` and passes it through.
- **`persistFindings`** extracts `svc.base_path` from agent findings and forwards it to `upsertService`.

### 4. Resolution (read path) — `detectMismatches`

Rewrote to apply base_path stripping in JS:

1. Pull candidate connections + their target's `base_path` in one query (with try/catch fallback for pre-014 dbs that omits the column).
2. For each row: try literal match against the target's exposed_endpoints first (preserves D-02 negative correctness and Test 8 literal-match behavior).
3. If literal misses AND `target.base_path` is set, try stripped match using the new `stripBasePath` helper.
4. Emit "endpoint_not_exposed" only when both fail.

The new **`stripBasePath(connPath, basePath)`** helper (exported) implements D-02 + D-03:

- null/empty basePath → null (no strip).
- Trailing-slash normalization on basePath.
- `connPath === bp` → returns `"/"`.
- `connPath.startsWith(bp + "/")` → returns `connPath.slice(bp.length)`.
- Substring without segment-boundary (e.g. `/ap` inside `/api/users`) → null.

## Decision References

- **D-01 (backwards-compat):** services without `base_path` continue to behave as before. The 3-tier upsert fallback proves a pre-014 db can still construct a `QueryEngine` and `upsertService` (Test 3). `detectMismatches` falls back to a SQL shape that omits the column when it doesn't exist (extra backwards-compat test).
- **D-02 (target-only):** `stripBasePath` returns null on null/empty basePath, so `detectMismatches` falls back to literal compare. Test 6 guards against over-eager stripping when target.base_path is NULL.
- **D-03 (multi-segment + segment-boundary):** Test 5 covers `/api/v1`. Test 7 guards `/ap` (substring) NOT stripping from `/api/users`.
- **D-04 (resolution-site):** Confirmed `detectMismatches` is the canonical join site. The pre-existing SQL `AND ep.path = c.path` was the literal-match line; JS now does literal-then-stripped per row.

## Test Summary

**27 new tests, all green:**

| File                                | Tests | Coverage                                                      |
| ----------------------------------- | ----- | ------------------------------------------------------------- |
| migration-014.test.js               | 4     | version export, idempotence (twice → one column), shape, preservation |
| findings-base-path.test.js          | 7     | A: accept /api, B: backwards-compat, C: null, D: bad-type warn, E: multi-segment, F: prompt content, G: schema content |
| query-engine-base-path.test.js      | 16    | 7 stripBasePath unit + 3 write + 5 resolution (T4–T8) + 1 backcompat |

**Regression check (full suite):**

- `node --test plugins/arcanon/worker/db/*.test.js plugins/arcanon/worker/scan/*.test.js` → 324/325 pass. The single failure (`manager.test.js` "incremental scan prompt") is **pre-existing** (verified by stashing my changes — same failure). Tracked in `.planning/STATE.md` as a known concern.
- `make test` (bats) → 307/308 pass. The single failure (HOK-06 p99 latency 130ms vs 50ms threshold on macOS) is **pre-existing** and explicitly documented in STATE.md as "PreToolUse hook p99 latency on macOS is 130ms vs the 50ms Linux target — documented caveat, not a regression."

## Commits

| Type | Hash    | Subject                                                                  |
| ---- | ------- | ------------------------------------------------------------------------ |
| test | 35e6f53 | test(110-01): add migration-014 idempotence test (TRUST-12)              |
| feat | 4e24311 | feat(110-01): add migration 014 services.base_path column (TRUST-04)     |
| test | f45e202 | test(110-01): add base_path validator + prompt + schema tests (TRUST-12) |
| feat | cb83c58 | feat(110-01): accept base_path on services in agent prompt + schema + validator (TRUST-04) |
| test | efb031b | test(110-01): add base_path write + resolution tests (TRUST-12)          |
| feat | ba972ee | feat(110-01): persist + apply services.base_path in resolution (TRUST-04)|

## Deviations from Plan

### Migration numbering (already accounted for in user's prompt)

The plan text and `must_haves.truths` referred to "migration 013" in several places, but Phase 109 already shipped migration 013 (connections.path_template). The user's prompt explicitly directed migration 014. Implementation uses **version=14** as the export.

**Files affected:** New migration is `014_services_base_path.js`; new test is `migration-014.test.js`. `query-engine-base-path.test.js` uses `up014` for the new path. Plan's "must_haves" reference to "migration 013" + "Phase 110 ships version: 12" in 013_connections_path_template.js docstring are stale — they reflect an earlier numbering scheme. The `_hasBasePath` runtime probe means runtime ordering between 013 and 014 is irrelevant: each migration's `up()` is keyed on a column-existence check, so they commute.

### No other deviations

The plan's task structure, TDD gates, file list, and decision rationale all matched what got implemented. Helper unit tests for `stripBasePath` were added (7 extra cases beyond the 8 detectMismatches scenarios) — kept as a separate suite for clarity, not a deviation.

## TDD Gate Compliance

Plan was authored as `tdd="true"` per task. Each task ships a `test(...)` commit (RED) followed by a `feat(...)` commit (GREEN):

| Task | RED Commit | GREEN Commit |
| ---- | ---------- | ------------ |
| 1    | 35e6f53    | 4e24311      |
| 2    | f45e202    | cb83c58      |
| 3    | efb031b    | ba972ee      |

No REFACTOR commits needed — the implementation was minimal and the tests pinned the contract.

## Threat Flags

None. No new network endpoints, no auth-path changes, no new file-access patterns. The change is internal to the scan-resolution pipeline.

## Open Follow-ups

None for Phase 110. The phase scope (TRUST-04 + TRUST-12) is fully landed.

**For future phases / milestones:**

- **UX surfacing:** `services.base_path` is not yet shown in the detail panel UI. Out of scope for Phase 110 per CONTEXT line 96. If a UI plan in v0.1.4+ wants to surface it, the data is already in `services.base_path` and `getGraph()` returns the column (verified by Test 1 readback).
- **Backfill helper:** If operators want pre-110 service rows to pick up `base_path` without a full re-scan, a one-shot backfill could be authored. Out of scope per D-01.
- **No tests are deferred or skipped.** All 27 new tests are running.

## Self-Check: PASSED

Files (8/8 found):

- plugins/arcanon/worker/db/migrations/014_services_base_path.js — FOUND
- plugins/arcanon/worker/db/migration-014.test.js — FOUND
- plugins/arcanon/worker/scan/findings-base-path.test.js — FOUND
- plugins/arcanon/worker/db/query-engine-base-path.test.js — FOUND
- plugins/arcanon/worker/db/query-engine.js — modified (verified by stripBasePath export)
- plugins/arcanon/worker/scan/findings.js — modified (verified by base_path acceptance test)
- plugins/arcanon/worker/scan/agent-schema.json — modified (verified by schema parse test)
- plugins/arcanon/worker/scan/agent-prompt-service.md — modified (verified by content test)

Commits (6/6 in git log):

- 35e6f53 — FOUND
- 4e24311 — FOUND
- f45e202 — FOUND
- cb83c58 — FOUND
- efb031b — FOUND
- ba972ee — FOUND
