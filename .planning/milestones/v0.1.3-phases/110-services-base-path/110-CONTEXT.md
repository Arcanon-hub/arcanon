---
phase: 110-services-base-path
type: context
created: 2026-04-21
source: orchestrator (Linear THE-1022 item #13)
---

# Phase 110: services.base_path End-to-End — Context

## Phase Goal

A new `services.base_path TEXT` column lets the scanner declare a service-level path prefix (e.g., `/api`); the agent prompt instructs services to emit it; and connection resolution strips `base_path` from frontend-to-backend matches before comparing paths — eliminating a class of false-mismatch findings caused by reverse-proxy prefix-stripping.

## Requirements Covered

- **TRUST-04** — Migration adds `services.base_path TEXT`; agent prompt emits `base_path`; connection resolution strips `base_path` before path matching
- **TRUST-12** — Node tests: migration idempotence + agent prompt emission + connection resolution honors `base_path`

## Migration Numbering (CRITICAL)

Sequential migration numbering is enforced. Current state:

- Migrations 001–011: applied (latest = `011_services_boundary_entry.js`)
- Phase 109 (preceding): introduces **migration 012** (`connections.path_template`)
- **Phase 110 (this phase): introduces migration 013 (`services.base_path`)**
- Phase 111 (next): introduces migrations 014 + 015

**Note:** The ROADMAP placeholder text for Phase 110 (success criterion #1) refers to "Migration 012" — this is a stale placeholder. The orchestrator's authoritative directive is **migration 013**. Phase 109 lands 012 first; this phase lands 013.

## Decisions

### D-01: `base_path` is optional (additive, backwards-compatible)

Existing services scanned before this phase have `base_path = NULL` and their connection resolution behavior is unchanged. No backfill; pre-existing rows pick up `base_path` only on re-scan.

**Implication:** Resolution logic MUST treat `NULL`/empty `base_path` as "no stripping" — exact path match is the default.

**Documented behavior:** Connections from a frontend service to a backend service with `base_path = NULL` continue to compare paths literally. Users who want the stripping benefit must re-scan after upgrading.

### D-02: Strip ONLY when target service has `base_path` set

Stripping is gated on the **target** (callee) service's `base_path`. We do NOT unconditionally strip prefixes from outbound paths — that would break correctness when a source service intentionally calls a fully-qualified path against a target that does not use a base prefix.

**Direction:** Outbound connection's `path` is the candidate to strip from. The target service's `base_path` is the prefix to match. If the outbound path begins with the target's `base_path`, strip it before comparing against the target's exposed endpoints.

**Example (matches):**
- Frontend service calls `path: "/api/users"`
- Backend service has `base_path: "/api"` and exposes `"GET /users"`
- Strip `/api` from `/api/users` → `/users` → matches exposed `/users` ✓

**Example (no strip — preserves correctness):**
- Source calls `path: "/api/users"`
- Target service has `base_path: NULL` and exposes `"/api/users"`
- No stripping — direct compare → matches ✓

### D-03: Multi-segment `base_path` support via literal prefix match

`base_path` can be multi-segment (e.g., `/api/v1`, `/internal/admin`). Resolution uses **literal prefix string match** — not just-first-segment match.

**Algorithm (target.base_path = `bp`, outbound path = `p`):**
1. If `bp` is null/empty → no strip; compare `p` against exposed paths literally.
2. If `p === bp` → strip yields `""` (or `"/"`); compare against exposed `"/"` or empty.
3. If `p.startsWith(bp + "/")` → strip yields `p.slice(bp.length)`; compare against exposed paths.
4. If `p.startsWith(bp)` but next char is not `/` → reject (prefix is a substring, not a path-segment boundary). Example: `bp = "/ap"` should NOT strip from `/api/users`.
5. Otherwise → no strip; compare `p` literally (handles legitimate non-prefixed paths).

**Edge cases:**
- Trailing slash on `bp` (e.g., `"/api/"`) → normalize by stripping trailing `/` before applying the algorithm.
- Empty string `bp = ""` → equivalent to NULL (no strip).

### D-04: Resolution-logic insertion point requires investigation during execution

The exact code site where path matching happens is **not predetermined**. The plan flags this as a "find and patch" task. Candidate sites in `query-engine.js`:

- **`detectMismatches()`** (lines ~1141–1203): joins `connections.path` against `exposed_endpoints.path` via `ep.path = c.path`. This is the most likely insertion point — current behavior treats `/api/users` and `/users` as a mismatch.
- **`getGraph()`** (lines ~969–1132): post-processing of connection list (less likely; getGraph already returns resolved source/target).
- **`persistFindings()`** (lines ~1227–1345): could pre-strip on write, but D-02 says strip on read — keep raw `path` in DB so audit trail is preserved.

**Plan execution rule:** First task is to read `query-engine.js` end-to-end, identify the canonical join site (almost certainly `detectMismatches`), patch in `base_path` stripping, and write a node test that exercises the join. Do NOT apply stripping at write time — keep the raw outbound path stored verbatim for audit and verify-command (Phase 112) consumption.

## Architectural Constraints

- **Backwards compatibility (try/catch fallback pattern):** `_stmtUpsertService` MUST mirror the existing migration 011 try/catch pattern in `query-engine.js` (lines ~357–379). Try-prepare with `base_path` column first; on `SqliteError`, fall back to the migration-011-shape (without `base_path`).
- **Idempotent migration:** Mirror `011_services_boundary_entry.js` pattern (PRAGMA `table_info` check before `ALTER TABLE`).
- **No new external deps.** Pure SQLite + JS.
- **Logger preference:** Use the existing `this._logger` pattern in `QueryEngine` for any warn-level diagnostic output (e.g., when stripping reveals a still-missing match — useful for future debugging).

## Conventions

- Commit prefix: `feat(110-01): ...` for code, `test(110-01): ...` for tests
- Reference requirement IDs in commits: `(TRUST-04)`, `(TRUST-12)`
- Test files colocated with source: `*.test.js` next to the module under test
- Node test runner: existing convention (likely `node --test` or `npm test` — verify in execution)

## Out of Scope

- Backfilling `base_path` on existing pre-110 service rows (per D-01)
- UI surfacing of `base_path` in the detail panel (separate UX concern; not blocking)
- Stripping outbound paths against the **source** service's own `base_path` (only target matters per D-02)
- Cross-service `base_path` inference / heuristics (agent emits explicitly, no guessing)

## Files To Read During Execution

- `plugins/arcanon/worker/db/migrations/011_services_boundary_entry.js` (migration template)
- `plugins/arcanon/worker/db/query-engine.js` (upsertService try/catch + path-matching insertion point)
- `plugins/arcanon/worker/scan/agent-prompt-service.md` (add `base_path` field instructions)
- `plugins/arcanon/worker/scan/agent-schema.json` (add per-service `base_path` field)
- `plugins/arcanon/worker/scan/findings.js` (validator — accept `base_path` as optional string)

## Risk Notes

- **Migration ordering risk:** Phase 109 ships migration 012 first. If Phase 110 ships before 109 lands, the migration sequence breaks. Phase 110 `depends_on: []` is true at the **plan-graph** level (no plan-internal dependency on 109's plans), but the **release order** is governed by ROADMAP phase ordering. Document this as a release-ordering concern, not a plan-time blocker.
- **`detectMismatches` is the join site (most likely):** If it turns out resolution actually happens elsewhere (e.g., a UI-side comparison in `web/`), the plan task explicitly says "find and patch" — investigate before writing the patch.
- **Regression guard mandatory:** A negative test (target has NO `base_path`, outbound `/api/users`, exposed `/users` → MUST NOT match) prevents over-eager stripping from silently masking real mismatches.

---
