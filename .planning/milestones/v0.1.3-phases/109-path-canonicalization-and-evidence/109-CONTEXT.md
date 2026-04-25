---
phase: 109-path-canonicalization-and-evidence
type: context
phase_req_ids: [TRUST-02, TRUST-03, TRUST-10, TRUST-11]
created: 2026-04-25
linear_ticket: THE-1022
---

# Phase 109 — Context: Path Canonicalization + Evidence at Ingest

## Phase Goal

The scan ingest pipeline rejects evidence that does not literally appear in the cited source file, and connections whose only difference is a template variable name collapse to a single canonical row — strengthening data trust at the write boundary.

Two writes-side hardening changes shipped in one phase because both flow through `persistFindings`:
1. **TRUST-02** — Evidence-substring guard (write-time validation).
2. **TRUST-03** — Path canonicalization (`{var}` → `{_}`) with original templates preserved in a new `connections.path_template` column.

## Decisions

### D-01: Migration number is **013** for `connections.path_template`

Per ROADMAP.md Phase 109 success criterion #3 and Phase 110 success criterion #1, the v0.1.3 migration assignment is:

| Migration | Phase | Column / Table |
|-----------|-------|----------------|
| 012 | Phase 110 | `services.base_path` |
| 013 | Phase 109 (this phase) | `connections.path_template` |
| 014 | Phase 111 | `scan_versions.quality_score` |
| 015 | Phase 111 | `enrichment_log` table |

Rationale: ROADMAP.md was authored with this ordering. The migrations loader (`database.js:41-68`) sorts migrations by the exported `version: number`, not by filename — so shipping `013_*.js` in Phase 109 before `012_*.js` ships in Phase 110 is safe at runtime. Filename alphabetical sort also yields the same final order once 012 lands.

**Implication:** This phase's migration file is `013_connections_path_template.js` with `export const version = 13;`. Phase 110 will add `012_services_base_path.js` with `export const version = 12;`. **No** "012" file exists in this phase.

### D-02: Canonical path stored in existing `path` column; original template(s) in new `path_template` column

Two storage options were considered:
- (a) Add `path_canonical TEXT` and keep raw template in `path` (dual-column).
- (b) **CHOSEN** — Store canonical (`/api/users/{_}`) in the existing `path` column; store the original template(s) (`/api/users/{user_id}`) in the new `path_template` column.

Rationale for (b):
- API surface unchanged — readers (`getGraph()`, `enrichImpactResult`) already select `path` and don't need rewiring.
- Dedup key (`UNIQUE(source_service_id, target_service_id, protocol, path)` per `004_dedup_constraints.js`) automatically collapses template-variants once `path` holds the canonical form — no schema-level UNIQUE migration needed.
- `path_template` is purely additive metadata for display.

**Display semantics for `path_template`:**
- New row → `path_template = original conn.path` (e.g., `/api/users/{user_id}`).
- Re-upsert with same canonical but different template → comma-join: `"/api/users/{user_id},/api/users/{name}"`.
- Re-upsert with same template (re-scan idempotency) → no duplicate; left untouched.

### D-03: Evidence-rejection window is **whole `source_file` content**, not ±3 lines around `line_start`

The original TRUST-02 spec (REQUIREMENTS.md) and Phase 109 goal (ROADMAP.md) say "literal substring match against the contents of `source_file` at ±3 lines of `line_start`."

**Reality of the agent schema** (`worker/scan/agent-schema.json`, `worker/scan/findings.js`): connections have `source_file` (string|null) and `evidence` (string ≤3 lines), but **no `line_start` / `line_end` field**. The agent never reports a line number.

**Decision:** Implement the substring check against the **entire `source_file` content** (not a windowed ±3-line slice — there's no `line_start` to slice around). Code intent is identical: agent's evidence must literally appear in the cited file. The "±3 lines" wording in REQUIREMENTS.md becomes accurate only after a future ticket adds `connections.line_start` / `line_end` (out of scope here).

This is a faithful implementation of the **trust intent** (evidence must be verifiable against source) while honestly matching the **available data**. Documented here so future readers don't think the planner silently widened the rule.

The `/arcanon:verify` command in Phase 112 will read `source_file` and search for `evidence`. Same intent, same implementation — no `line_start` available.

### D-04: Evidence is treated as a **literal substring** (no regex, no normalization)

If the agent emits `evidence: "this is just a paragraph with no code"` against a real-code source file, the literal substring `"this is just a paragraph with no code"` won't be found in the file → connection skipped + `logger.warn(...)` to stderr.

**Out of scope:**
- Whitespace normalization (collapsing multiple spaces, tab/space). If the agent decorates evidence with leading line numbers (e.g. `"32: const x = 5"`) or extra indentation that doesn't match the file, it's the agent prompt's job to emit raw code, not this validator's job to normalize. A future TRUST follow-up can address agent-prompt drift if it surfaces in real scans.
- Regex / fuzzy match. Substring-only — the simplest, most defensible rule.

### D-05: When `source_file` is **missing** or **null**, **skip the rejection check** (do not fail the scan)

Three skip cases for evidence rejection:
1. `conn.evidence` is `null`, empty, or only whitespace → no-op (agent didn't claim evidence; nothing to verify).
2. `conn.source_file` is `null` → no-op (no file to read against; warn already emitted by `findings.js` validateFindings).
3. `conn.source_file` is set but the file does not exist on disk (relative path resolved against repo root, file missing) → log `"cannot validate evidence: source_file '<path>' does not exist"` at warn level, **persist the connection anyway**.

Reason for (3): persistFindings runs after the scan; file-system races (rebase, gitignore artifacts, scan-during-checkout) shouldn't kill connection persistence. The `/arcanon:verify` command (Phase 112) is the authoritative recheck.

**Symmetric behavior:** if source_file resolves but is unreadable (permissions, encoding error) → same warning, persist anyway. Don't throw.

### D-06: Path canonicalization regex — `{xxx}` style only this phase

Regex: `/\{[^/}]+\}/g` → replace with `{_}`.

| Input path | Canonical | Notes |
|---|---|---|
| `/runtime/streams/{stream_id}` | `/runtime/streams/{_}` | TRUST-03 primary case |
| `/runtime/streams/{name}` | `/runtime/streams/{_}` | Collapses with above |
| `/api/users/{id}/posts/{post_id}` | `/api/users/{_}/posts/{_}` | Multi-template |
| `/api/users/:id` | `/api/users/:id` | **Not** canonicalized — Express style is a separate ticket |
| `/api/users` | `/api/users` | No template, no change |
| `null` / `""` | unchanged (passthrough) | Don't mint a `{_}` for null/empty paths |

**Out of scope:** Express `:id`, OpenAPI `(?<id>...)`, regex named groups, JAX-RS `{id:[0-9]+}` (constraint-suffix style). All future TRUST tickets if needed.

**Backfill:** Existing `connections` rows have `path_template = NULL` after migration 013. Do **not** backfill historic rows with this migration (would require re-canonicalizing thousands of existing path values, and on conflict-collapse would silently delete data). New scans populate `path_template`. Documented as known behavior.

## Deferred Ideas

(Not in scope for Phase 109 — explicitly out, future TRUST tickets if needed)

- Express-style `:id` path canonicalization (D-06 explicit).
- Whitespace / line-prefix normalization for evidence-substring match (D-04 explicit).
- Backfill of `path_template` on historic rows (D-06 explicit).
- Adding `connections.line_start` / `line_end` columns so the ±3-line window becomes possible (D-03 explicit).
- A rejection-rate quality metric (Phase 111 owns the broader quality score; counting prose-evidence-rejected here is fine but the metric surface lives there).
- `/arcanon:verify` command (Phase 112 — same intent, read-side; this phase is write-side only).

## Claude's Discretion

- Test file location: prefer `worker/db/migration-013.test.js` (mirror Phase 81's `migration-010.test.js` pattern) and `worker/scan/findings-evidence.test.js` + `worker/scan/findings-canonical.test.js` for the persistFindings tests, but co-locating in a single `worker/db/query-engine-canonical.test.js` is also acceptable if tests share fixtures.
- Logger choice — use the structured worker logger (`logger.warn` from `worker/lib/logger.js`) where available; fall back to `console.warn` if persistFindings runs in a context without an injected logger (mirror existing pattern in `query-engine.js`).
- The `path_template` comma-join algorithm:
  - **Recommendation:** When upserting an existing row, read current `path_template`, split on `,`, dedupe, append the new template if absent, re-join with `,`. If null/empty, set to current template.
  - Acceptable alternative: store as JSON array `["{stream_id}", "{name}"]` if simpler — but justify the deviation in the plan.
  - Either way, downstream readers (graph UI, MCP tools) get the raw column unchanged this phase; rendering polish lives in Phase 112+.

## Source Coverage Audit

| Source | Item | Plan |
|---|---|---|
| GOAL (ROADMAP) | Migration 013 adds `connections.path_template TEXT` idempotently | 109-01 |
| GOAL (ROADMAP) | Existing rows have `path_template` populated from `path` on first run | **Deferred** — see D-06 backfill decision (not in this phase, documented as known behavior; rejected silent backfill on safety grounds) |
| GOAL (ROADMAP) | persistFindings skips connection on prose evidence + warns | 109-02 |
| GOAL (ROADMAP) | Two template-variant connections collapse to one row, both templates in `path_template` | 109-02 |
| GOAL (ROADMAP) | Node test exercises persistFindings rejection path | 109-02 |
| REQ | TRUST-02 evidence rejection | 109-02 |
| REQ | TRUST-03 path canonicalization | 109-02 (logic) + 109-01 (column) |
| REQ | TRUST-10 node test for evidence rejection | 109-02 |
| REQ | TRUST-11 node test for path canonicalization | 109-02 |
| CONTEXT | D-01 migration 013 | 109-01 |
| CONTEXT | D-02 path-column reuse + path_template addition | 109-01 + 109-02 |
| CONTEXT | D-03 whole-file evidence window | 109-02 |
| CONTEXT | D-04 literal substring (no regex/normalize) | 109-02 |
| CONTEXT | D-05 missing source_file → skip+persist | 109-02 |
| CONTEXT | D-06 `{xxx}` regex only, no backfill | 109-01 + 109-02 |

**Note on backfill deviation from ROADMAP success criterion #3:** Phase 109 success criterion #3 in ROADMAP.md says "existing rows have `path_template` populated from `path` on first run." On planner reflection, this is unsafe — backfilling triggers the dedup logic against the new canonical form for thousands of historic rows, which can collapse legitimately-distinct rows that happen to look like template-variants but were never re-canonicalized. **D-06 overrides** the backfill bullet — new scans populate `path_template`; historic rows stay `NULL` until they're re-scanned. This is a deliberate, documented deviation; please flag if you disagree before plan execution.

## Conventions

- Commit prefix: `feat(109-01): ...`, `feat(109-02): ...`, `test(109-02): ...`, `docs(109-NN): ...`
- Reference REQs in commit body trailers: `(TRUST-NN)`
- Test file: `worker/db/migration-013.test.js`, `worker/scan/findings-evidence.test.js`, `worker/scan/findings-canonical.test.js` (or planner discretion per above)
- Run order: 109-01 must complete before 109-02 (109-02 reads/writes the `path_template` column added by 109-01)

## Test Plan Summary (cross-plan)

| Test | Plan | Asserts |
|---|---|---|
| Migration 013 idempotency | 109-01 | `up()` runs twice, second is no-op, `PRAGMA table_info(connections)` shows `path_template TEXT` |
| TRUST-10 prose-evidence rejection | 109-02 | Mock source_file with real code; agent emits `evidence: "this is just a paragraph"` → connection absent from DB, warning logged |
| TRUST-10 happy path | 109-02 | Mock source_file containing the evidence snippet → connection persists |
| TRUST-10 missing source_file | 109-02 | source_file path doesn't exist on disk → connection persists, warning logged |
| TRUST-11 template-variant collapse | 109-02 | Two connections, paths `/runtime/streams/{stream_id}` + `/runtime/streams/{name}` → 1 DB row, `path` = `/runtime/streams/{_}`, `path_template` contains both |
| TRUST-11 idempotent re-scan | 109-02 | Re-scan with same templates → still 1 row, `path_template` not duplicated |
| TRUST-11 non-template path passthrough | 109-02 | path `/api/health` → row stored unchanged in `path`, `path_template` = `/api/health` |
