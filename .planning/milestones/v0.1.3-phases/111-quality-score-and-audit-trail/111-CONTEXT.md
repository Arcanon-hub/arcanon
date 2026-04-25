---
phase: 111-quality-score-and-audit-trail
type: context
created: 2026-04-25
source: orchestrator (Linear THE-1022 items #14 + #15)
---

# Phase 111: Quality Score + Reconciliation Audit Trail — Context

## Phase Goal

Every scan now produces a quality score visible to the user, and the post-scan reconciliation step (external → cross-service downgrades) writes an audit row per change — both surfaced via the database and a new `impact_audit_log` MCP tool.

## Requirements Covered

- **TRUST-05** — Migration 015 (`scan_versions.quality_score REAL`); `endScan()` computes score; surface in `/arcanon:status` AND end of `/arcanon:map` output
- **TRUST-06** — Migration 016 (`enrichment_log` table); reconciliation writes rows; new `impact_audit_log` MCP tool
- **TRUST-13** — Node test: quality_score populated by `endScan()`, readable via `getQualityScore(scan_version_id)`
- **TRUST-14** — Node test: `enrichment_log` table created by migration; reconciliation writes one row per crossing-value change

## Migration Numbering (CRITICAL)

Sequential migration numbering is enforced. Current state at start of Phase 111:

- Migrations 001–011: applied (latest in repo = `011_services_boundary_entry.js`)
- Phase 109 (preceding): introduces **migration 012** (`connections.path_template`)
- Phase 110 (preceding): introduces **migration 013** (`services.base_path`)
- **Phase 111 (this phase): introduces migrations 015 (`scan_versions.quality_score`) AND 015 (`enrichment_log`)**

Note: ROADMAP.md success-criterion text mentions migrations "014 (`scan_versions.quality_score REAL`) and 015 (`enrichment_log` table)" — this is the authoritative numbering and matches the orchestrator's directive. Both migrations land in this phase, in numeric order. 014 must apply before 015 because 015 has a foreign key to `scan_versions(id)` (no schema dependency on 014's new column, but they ship together as the Phase 111 schema bundle).

## Decisions

### D-01: `prose_evidence_warnings` counter — return 0 placeholder for v0.1.3

The TRUST-05 success-format string mentions `"3 prose-evidence warnings"`. The TRUST-02 evidence-rejection logic (Phase 109) logs rejections to stderr but does NOT persist a count anywhere queryable.

**Decision:** For Phase 111, `getScanQualityBreakdown()` returns `prose_evidence_warnings: 0` if no counter exists. The display still renders the suffix (e.g., `"Scan quality: 87% high-confidence, 0 prose-evidence warnings"`) so the format string is stable. A future ticket (out of scope for v0.1.3) can add a `scan_versions.prose_evidence_warnings INTEGER` column populated by `persistFindings`.

**Implication:** Plan 111-02 does NOT block on adding a persistent counter. Code MUST include a TODO comment at the call site of `prose_evidence_warnings` referencing the future ticket so we don't lose the thread.

**Format string locked:**
- `/arcanon:map` end-of-output: `"Scan quality: {pct}% high-confidence, {n} prose-evidence warnings"`
- `/arcanon:status`: `"Latest scan: {pct}% high-confidence ({nServices} services, {nConnections} connections)"`

### D-02: Quality score formula — high + 0.5×low / total, NULL when total=0

**Formula:** `quality_score = (high_confidence_count + 0.5 * low_confidence_count) / total_connections`

**NULL semantics:** When `total_connections == 0` (no connections in the scan), `quality_score` is `NULL` (not 0, not 1.0 — genuinely "no signal"). The display layer renders this as `"Scan quality: n/a (0 connections)"` rather than `0%`.

**Treatment of `confidence IS NULL` rows:** Rows where the agent did not emit a `confidence` field are counted in `total` but contribute **0** to the numerator (NOT treated as "low"). This is the conservative choice — it avoids inflating scores when the agent omits the field, and it keeps high/low as the only signals we trust.

**Documentation:** A code comment at the SQL site MUST state this explicitly (verbatim or close): "NULL confidence is counted in `total` but contributes 0 to the numerator — agent omissions do not count as 'low'."

**Edge cases:**
- All high → `score = 1.0`
- All low → `score = 0.5`
- Mixed (e.g., 8 high + 2 low + 0 null, total 10) → `(8 + 1) / 10 = 0.9`
- Mixed with nulls (e.g., 5 high + 2 low + 3 null, total 10) → `(5 + 1) / 10 = 0.6`

### D-03: `impact_audit_log` MCP tool — schema and description

**New MCP tool:** `impact_audit_log`

**Zod input schema:**
```js
{
  scan_version_id: z.number().int().positive().describe("Scan version ID to retrieve audit log for"),
  enricher: z.string().optional().describe("Filter to a specific enricher (e.g., 'reconciliation', 'codeowners')"),
  project: z.string().optional().describe("Absolute path to project root, 12-char project hash, or repo name. Defaults to ARCANON_PROJECT_ROOT or cwd."),
}
```

**Output:** Array of `enrichment_log` rows: `{id, scan_version_id, enricher, target_kind, target_id, field, from_value, to_value, reason, created_at}`. Empty array if no rows or table absent.

**Tool description:** "Return the enrichment audit log for a given scan version. Each row records a post-scan reconciliation or enrichment field change (e.g., crossing reclassified from external to cross-service). Use to audit how a scan's data was modified after the agent emitted it."

**Project resolution:** Mirrors existing tools — accepts `project` arg with the standard absolute-path / 12-char-hash / repo-name resolution. Falls back to `ARCANON_PROJECT_ROOT` or `cwd`.

### D-04: Reconciliation insertion point — `commands/map.md`, NOT `manager.js`

**Investigation finding:** The `external` → `cross-service` reclassification logic added in v5.7.0 (Phase 90) lives in `plugins/arcanon/commands/map.md` Step 3 (lines ~208–246), NOT in `worker/scan/manager.js`. It runs as a Claude-driven JavaScript snippet over the in-memory `allFindings` array BEFORE persistence, in the `/arcanon:map` slash-command flow.

**Implication for Plan 111-03:**
- The audit log write CANNOT happen at reclassification time in `map.md` because there is no `connection_id` yet (rows aren't persisted). The audit must be written AFTER `persistFindings`/`endScan` runs and the connection has a real DB id.
- **Two viable approaches:**
  1. **Defer-and-write approach (preferred):** In `map.md` Step 3, when a reclassification happens, attach the `from_value`/`reason` to the connection object as a transient field (e.g., `_reconciliation: { from: 'external', to: 'cross-service', reason: 'target matches known service' }`). Then in `map.md` Step 5 (after `endScan`), iterate connections that have `_reconciliation` and write audit rows by querying for the connection's DB id (lookup by `source_service_id`, `target_service_id`, `path`, `method`).
  2. **Capture-then-persist approach (alternative):** Build a side list of `{source, target, path, method, from, to, reason}` tuples during reconciliation. After `persistFindings`, query for each tuple's connection_id and write audit rows.

**Plan execution rule:** Plan 111-03 executor MUST first read `map.md` Step 3 + Step 5 in full, choose between the two approaches, and document the choice in the plan SUMMARY. The query-engine method `logEnrichment()` MUST exist as a stable API regardless of which call site uses it — multiple call sites are anticipated (codeowners enrichment, auth-db enrichment in future phases).

**Reconciliation row schema:**
- `enricher = 'reconciliation'`
- `target_kind = 'connection'`
- `target_id = <connection_id from connections table>`
- `field = 'crossing'`
- `from_value = 'external'`
- `to_value = 'cross-service'`
- `reason = 'target matches known service: <service_name>'`

### D-05: `/arcanon:status` quality-score surfacing — via HTTP endpoint

**Problem:** `/arcanon:status` is a Bash-only command (`scripts/hub.sh status`). The quality-score breakdown data lives in SQLite. Bash cannot directly call `QueryEngine.getScanQualityBreakdown()`.

**Decision:** Add a new HTTP endpoint `GET /api/scan-quality?project=<root>` that returns the latest scan's quality breakdown. The status command (or `hub.sh status`) `curl`s the endpoint when the worker is running, falls back to "Latest scan: unavailable (worker offline)" when not.

**Why this approach:** Mirrors the existing `/api/version` and `/api/readiness` pattern in `worker/server/http.js` (lines ~67–82). Keeps `/arcanon:status` shell-only (no embedded Node snippet). The endpoint returns the breakdown for the **latest** `scan_versions` row scoped to the resolved project's repos.

**Endpoint contract:**
- **Request:** `GET /api/scan-quality?project=<absolute path or omitted for default>`
- **Response 200:**
  ```json
  {
    "scan_version_id": 42,
    "completed_at": "2026-04-25T...",
    "quality_score": 0.87,
    "total_connections": 47,
    "high_confidence": 38,
    "low_confidence": 9,
    "null_confidence": 0,
    "prose_evidence_warnings": 0,
    "service_count": 12
  }
  ```
- **Response 503:** When no scan data: `{ "error": "no_scan_data" }`
- **Response 404:** When project not resolvable: `{ "error": "project_not_found" }`

**Status command consumption:** `hub.sh status` adds a section like:
```
Latest scan: 87% high-confidence (12 services, 47 connections)
```
Or when worker offline:
```
Latest scan: (worker offline — start worker for scan-quality details)
```

**Map command consumption:** `commands/map.md` end-of-Step-5 calls `getScanQualityBreakdown()` directly via the existing inline-Node pattern (Step 5 already opens a DB handle), printing:
```
Scan quality: 87% high-confidence, 0 prose-evidence warnings
```

This split (HTTP for shell-driven status, direct DB for Node-driven map) matches the existing architecture.

## Architectural Constraints

- **Migration idempotence:** 014 mirrors the `011_services_boundary_entry.js` PRAGMA `table_info` check pattern. 015 uses `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` (natively idempotent).
- **Backwards compatibility (try/catch fallback in QueryEngine):** New methods (`getQualityScore`, `getScanQualityBreakdown`, `logEnrichment`, `getEnrichmentLog`) MUST handle pre-migration databases gracefully — `try/catch` around prepared statements, returning `null` or `[]` when the column/table is absent. Mirrors the `_stmtUpsertActor`, `_stmtUpsertNodeMetadata`, `_stmtUpsertDependency` patterns in `query-engine.js` (lines ~460–527).
- **`endScan()` quality-score write is best-effort:** A failure to UPDATE `scan_versions.quality_score` MUST NOT throw or roll back the scan-bracket close. Wrap in try/catch with logger.warn.
- **No new external deps.** Pure SQLite + JS. Reuse existing zod, fastify, MCP SDK.
- **Logger:** Use the `this._logger` pattern in `QueryEngine`; use the `httpLog`/`logger` already in `worker/server/http.js` and `worker/mcp/server.js`.

## Conventions

- Commit prefix: `feat(111-NN): ...` for code, `test(111-NN): ...` for tests
- Reference requirement IDs in commit body or message: `(TRUST-05)`, `(TRUST-06)`, `(TRUST-13)`, `(TRUST-14)`
- Test files colocated with source: `*.test.js` next to the module under test
- Migration tests: `worker/db/migration-{NN}.test.js`
- Node test runner: `node --test` (existing convention — verify with `npm test` script in execution)

## Out of Scope

- Persistent `prose_evidence_warnings` counter column (deferred per D-01; out of v0.1.3)
- Surfacing the audit log in the graph UI (separate UX concern; v0.1.4+)
- Audit rows for codeowners / auth-db enrichers (only `reconciliation` writes audit rows in this phase per TRUST-06; future phases can add more enricher writers using the same `logEnrichment` API)
- Quality-score histogram or trend visualization (single scalar per scan is sufficient for v0.1.3)
- `/arcanon:verify` integration with audit log (Phase 112)
- Backfilling `quality_score` for existing pre-014 `scan_versions` rows (NULL on existing rows; populated only on new scans)

## Files To Read During Execution

**Plan 111-01:**
- `plugins/arcanon/worker/db/migrations/011_services_boundary_entry.js` (migration template — PRAGMA pattern)
- `plugins/arcanon/worker/db/migrations/010_service_dependencies.js` (CREATE TABLE pattern)

**Plan 111-02:**
- `plugins/arcanon/worker/db/query-engine.js` (lines ~404–410 `_stmtBeginScan`/`_stmtEndScan`; lines ~899–953 `endScan()` method — patch site)
- `plugins/arcanon/worker/server/http.js` (lines ~66–82 — `/api/version` route pattern)
- `plugins/arcanon/commands/map.md` Step 5 (lines ~277–305 — DB-handle Node snippet pattern)
- `plugins/arcanon/commands/status.md` (full file — Bash-only command structure)
- `plugins/arcanon/scripts/hub.sh` (locate the `status` subcommand handler — addition site for the curl call)

**Plan 111-03:**
- `plugins/arcanon/worker/db/query-engine.js` (lines ~460–527 — try/catch fallback pattern for optional tables)
- `plugins/arcanon/worker/mcp/server.js` (lines ~1252–1300 — MCP tool registration pattern; `resolveDb` helper at lines ~77–97)
- `plugins/arcanon/commands/map.md` Step 3 (lines ~208–246 — reconciliation logic)
- `plugins/arcanon/commands/map.md` Step 5 (lines ~277–305 — persistence flow; audit-log write site after `endScan`)

## Risk Notes

- **Migration ordering risk:** Phases 109 (012), 110 (013), 111 (014+015) are sequenced. If 111 ships without 109/110, the migration runner will skip 012/013 and apply 014/015 — leaving a gap. The release-ordering is governed by ROADMAP phase ordering (109 → 110 → 111 → 112 → 113). Phase 111's plans have `depends_on: []` at the **plan-graph** level (no plan-internal dependencies on 109/110 plans), but the **release order** must be honored.
- **Reconciliation insertion point investigation:** Per D-04, executor must investigate `map.md` Step 3 + Step 5 before writing the audit-log call. Two approaches are viable; the SUMMARY MUST document the choice.
- **`/arcanon:status` already calls `hub.sh status`:** Adding the curl + new endpoint MUST not break the existing status output. The new "Latest scan: ..." line appends to existing output, does not replace it.
- **MCP tool description discoverability:** The `impact_audit_log` description must be specific enough that Claude (consuming the tool list) understands when to call it. D-03's description text is the locked starting point — executor may refine for clarity but must preserve the use-case framing.
- **HTTP endpoint security:** `/api/scan-quality?project=` accepts an absolute path. Reuse the existing `getQE(request)` resolver in `http.js` which already has the path-traversal guards from Phase 80. Do NOT introduce a new path resolver.
- **Test isolation:** Quality-score test (TRUST-13) MUST construct a fresh in-memory or temp-file DB and run all migrations 001–015 to exercise the full schema. Do NOT assume migration 014 is applied to fixtures that other tests use. Same for enrichment-log test (TRUST-14).

---
