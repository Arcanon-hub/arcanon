/**
 * Migration 016 — TRUST-06: creates `enrichment_log` table for post-scan
 * reconciliation audit trail.
 *
 * Each row records a field change applied AFTER the agent emitted findings
 * (e.g., crossing reclassified from 'external' to 'cross-service' because
 * the target name matches a known service). Plan 111-03 wires the writes
 * via `QueryEngine.logEnrichment()`; this migration is schema-only.
 *
 * Indexed on `scan_version_id` (for the `impact_audit_log` MCP tool's
 * primary lookup) and `enricher` (for filterable queries — e.g., show only
 * codeowners enrichment changes).
 *
 * FK with `ON DELETE CASCADE` — when a scan_versions row is deleted (during
 * stale-scan cleanup or repo removal), its audit rows go with it.
 *
 * `target_kind` is a discriminant (CHECK constrained to 'service' or
 * 'connection') so `target_id` can FK-by-convention into either the
 * `services` or `connections` table without a polymorphic FK. Phase 111
 * only writes 'connection' rows (reconciliation downgrades crossing on
 * connection rows); 'service' is reserved for future enrichers (codeowners,
 * auth-db) per CONTEXT.md decision D-04.
 *
 * Idempotent natively via `CREATE TABLE IF NOT EXISTS` and
 * `CREATE INDEX IF NOT EXISTS` — no PRAGMA guard needed (mirrors migration 010).
 *
 * Note: the db method called below is better-sqlite3's SQL execution method
 * (not Node's child_process). It runs DDL against the SQLite database — no
 * shell, no process spawning, no user input.
 */

export const version = 16;

const DDL = `
  CREATE TABLE IF NOT EXISTS enrichment_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_version_id INTEGER NOT NULL REFERENCES scan_versions(id) ON DELETE CASCADE,
    enricher        TEXT    NOT NULL,
    target_kind     TEXT    NOT NULL CHECK(target_kind IN ('service', 'connection')),
    target_id       INTEGER NOT NULL,
    field           TEXT    NOT NULL,
    from_value      TEXT,
    to_value        TEXT,
    reason          TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_enrichment_log_scan_version_id
    ON enrichment_log(scan_version_id);

  CREATE INDEX IF NOT EXISTS idx_enrichment_log_enricher
    ON enrichment_log(enricher);
`;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(DDL);
}
