---
phase: 111-quality-score-and-audit-trail
type: verification
created: 2026-04-25
plans:
  - "111-01 — Migrations 015 + 016"
  - "111-02 — Quality-score wiring + display"
  - "111-03 — Audit-log API + impact_audit_log MCP tool + reconciliation wiring"
requirements: [TRUST-05, TRUST-06, TRUST-13, TRUST-14]
status: complete
---

# Phase 111 Verification — Quality Score & Reconciliation Audit Trail

Phase 111 closes 4 requirements across 3 sequential plans. Every scan now produces a persistent quality score visible to the user, and the post-scan reconciliation step writes one audit row per crossing reclassification — surfaced via the new `impact_audit_log` MCP tool.

## Requirements Coverage

| ID         | Description                                                                                              | Closed By  | Verification Evidence                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TRUST-05   | Migration 015 (`scan_versions.quality_score REAL`); endScan computes score; surface in /arcanon:status AND end of /arcanon:map output | 111-01, 111-02 | `migration-015.test.js` (5/5), `query-engine.quality-score.test.js` (10/10), `http.scan-quality.test.js` (5/5); /arcanon:map end-of-output line + /arcanon:status latest-scan line both rendered |
| TRUST-06   | Migration 016 (`enrichment_log` table); reconciliation writes rows; new `impact_audit_log` MCP tool       | 111-01, 111-03 | `migration-016.test.js` (7/7), `query-engine.enrichment-log.test.js` (8/8), `query-engine.reconciliation-audit.test.js` (3/3), `server.impact-audit-log.test.js` (6/6)                          |
| TRUST-13   | Node test: quality_score populated by endScan(), readable via getQualityScore(scan_version_id)            | 111-02     | `query-engine.quality-score.test.js` Tests 1, 6, 9 (mixed/all-high/all-low/per-scan-isolation)                                                                                                   |
| TRUST-14   | Node test: enrichment_log table created by migration; reconciliation writes one row per crossing-value change | 111-01, 111-03 | `migration-016.test.js` Test 4 (FK CASCADE), `query-engine.enrichment-log.test.js` Tests 1+2 (write/read), `query-engine.reconciliation-audit.test.js` Test 1 (one row per change)              |

## Plan Outcomes

### Plan 111-01 — Migrations 015 + 016 (Schema-only)

- Migration 015 adds nullable `scan_versions.quality_score REAL`. Idempotent via `PRAGMA table_info` hasCol probe.
- Migration 016 creates `enrichment_log` (10 cols, FK ON DELETE CASCADE to scan_versions, CHECK on `target_kind`, indexes on `scan_version_id` and `enricher`). Idempotent via `CREATE TABLE/INDEX IF NOT EXISTS`.
- 12 tests added (5 in `migration-015.test.js`, 7 in `migration-016.test.js`). All pass.
- Commits: `7043516`, `fecaf5e`, `cddc989`, `081fac9`.

### Plan 111-02 — Quality-score wiring + display

- `endScan()` writes `quality_score = (high + 0.5 * low) / total` (NULL when total = 0). Best-effort — failures log a warning, never roll back the bracket close.
- `getQualityScore(scanVersionId)` and `getScanQualityBreakdown(scanVersionId)` exposed on QueryEngine.
- `GET /api/scan-quality?project=<root>` HTTP endpoint added (200 with breakdown, 404 project_not_found, 503 no_scan_data).
- `/arcanon:map` prints `Scan quality: NN% high-confidence, M prose-evidence warnings` at end-of-output.
- `/arcanon:status` prints `Latest scan: NN% high-confidence (S services, C connections)` when worker running.
- 15 tests added (10 in `query-engine.quality-score.test.js` + 5 in `http.scan-quality.test.js`). All pass.

### Plan 111-03 — Audit-log API + impact_audit_log MCP tool + reconciliation wiring

- `QueryEngine.logEnrichment(...)` — stable write API for any future enricher (codeowners, auth-db). No-op on pre-016 db. SQL CHECK is the source of truth on `target_kind` (no JS pre-validation).
- `QueryEngine.getEnrichmentLog(scanVersionId, opts)` — read API with `enricher` filter and graceful empty-array fallback.
- New MCP tool `impact_audit_log` registered with the locked Zod schema and description from CONTEXT D-03. Handler factored as a top-level exported `handleImpactAuditLog(params)` for testability.
- `/arcanon:map` Step 3 captures `_reconciliation: { from, to, reason }` on each reclassified connection BEFORE mutating `crossing`. Step 5 (after `endScan` + quality-score lines) iterates and writes one audit row per change via `qe.logEnrichment`.
- 17 tests added (8 enrichment-log + 3 reconciliation integration + 6 MCP tool). All pass.
- Bats fixtures bumped to expect 9 MCP tools (was 8).

## End-to-End Verification

### Node tests scoped to Phase 111

```
$ cd plugins/arcanon
$ node --test \
    worker/db/migration-015.test.js \
    worker/db/migration-016.test.js \
    worker/db/query-engine.quality-score.test.js \
    worker/db/query-engine.enrichment-log.test.js \
    worker/db/query-engine.reconciliation-audit.test.js \
    worker/mcp/server.impact-audit-log.test.js \
    worker/server/http.scan-quality.test.js
ℹ tests 39
ℹ pass 39
ℹ fail 0
```

### Broader regression suites

```
$ node --test worker/db/query-engine*.test.js worker/mcp/server*.test.js
ℹ tests 175 — pass 174 — fail 1   (pre-existing dev-machine flake — see below)

$ make test    # bats
1..315
not ok 151 impact-hook - HOK-06: p99 latency < ${IMPACT_HOOK_LATENCY_THRESHOLD:-50}ms over 100 iterations
```

Both remaining failures are pre-existing and unrelated to Phase 111:

- **`queryScan: returns unavailable when port file does not exist`** — local dev-machine artifact (`~/.arcanon/worker.port` exists). Reproduces on `main` before any Phase 111 commit.
- **`HOK-06: p99 latency`** — documented macOS perf flake under load (latency budget intermittently exceeds 50ms).

## Behavior Locked In Across Phase 111

1. `quality_score` is nullable. NULL ≠ 0 — it means "no signal" (zero connections in scan, or scan crashed before endScan). Display layer renders `Scan quality: n/a (0 connections)` in that case.
2. The quality-score formula and NULL-confidence rule are documented at the SQL site in `query-engine.js` (lock phrase: "NULL confidence is counted in `total` but contributes 0 to the numerator — agent omissions do not count as 'low'.") and verified by source-grep test 4b.
3. `enrichment_log` is the audit trail for ANY post-scan field-level change. Phase 111 only writes `enricher='reconciliation'` rows; future enrichers (`codeowners`, `auth-db`) reuse the same `logEnrichment` API.
4. Reconciliation audit reason format is locked at `'target matches known service: <service_name>'`.
5. CASCADE on scan_versions DELETE removes orphan audit rows — audit retention is bounded by parent-scan lifetime.
6. MCP tool count: 9 (was 8 before Phase 111). The new tool is `impact_audit_log`.
7. Stdio transport startup in `worker/mcp/server.js` is gated behind `NODE_TEST_CONTEXT` — production unaffected, tests no longer hang.

## Files Touched (Phase-wide)

### Created

- `plugins/arcanon/worker/db/migrations/015_scan_versions_quality_score.js`
- `plugins/arcanon/worker/db/migrations/016_enrichment_log.js`
- `plugins/arcanon/worker/db/migration-015.test.js`
- `plugins/arcanon/worker/db/migration-016.test.js`
- `plugins/arcanon/worker/db/query-engine.quality-score.test.js`
- `plugins/arcanon/worker/db/query-engine.enrichment-log.test.js`
- `plugins/arcanon/worker/db/query-engine.reconciliation-audit.test.js`
- `plugins/arcanon/worker/mcp/server.impact-audit-log.test.js`
- `plugins/arcanon/worker/server/http.scan-quality.test.js`

### Modified

- `plugins/arcanon/worker/db/query-engine.js` (endScan write, getQualityScore, getScanQualityBreakdown, logEnrichment, getEnrichmentLog, plus prepared-statement blocks)
- `plugins/arcanon/worker/server/http.js` (`/api/scan-quality` route)
- `plugins/arcanon/worker/cli/hub.js` (`cmdStatus` latest-scan section)
- `plugins/arcanon/worker/mcp/server.js` (handleImpactAuditLog handler + tool registration + NODE_TEST_CONTEXT gate)
- `plugins/arcanon/commands/map.md` (Step 3 _reconciliation capture; Step 5 quality-score line and audit-log writer)
- `plugins/arcanon/commands/status.md` (latest-scan section)
- `tests/mcp-launch.bats` and `tests/mcp-chromadb-fallback.bats` (tool-count bump 8 → 9)

## Outstanding Items

- **Persistent `prose_evidence_warnings` counter** — deferred per CONTEXT D-01. Today the API returns `0` as a placeholder. A future ticket will add `scan_versions.prose_evidence_warnings INTEGER` populated by `persistFindings`. The format string `"Scan quality: NN% high-confidence, M prose-evidence warnings"` is stable, so adding the column later is non-breaking.
- **Audit log surfacing in the graph UI** — out of scope for v0.1.3, parked for v0.1.4+.
- **Audit rows for codeowners / auth-db enrichers** — out of scope for Phase 111. The `logEnrichment` API is ready for these writers when their phases land.
- **`/arcanon:verify` integration with audit log** — Phase 112 (TRUST-07/08/09 already shipped in 112-01/112-02; the audit-log surface is left for follow-up if needed).

## Phase Status: COMPLETE

All four requirements (TRUST-05, TRUST-06, TRUST-13, TRUST-14) are closed with passing tests, idempotent migrations, and locked behavior. The phase is ready to be marked done in ROADMAP.md and v0.1.3 milestone tracking.
