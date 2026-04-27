/**
 * Migration 017 - CORRECT-01: creates `scan_overrides` table for staged
 * operator corrections that the next scan applies idempotently.
 *
 * Phase 117 schema. Each override row stages a single mutation against
 * `connections` or `services`. The apply-hook (worker/scan/overrides.js,
 * Plan 117-02) reads pending rows BETWEEN persistFindings and endScan,
 * applies each via direct UPDATE/DELETE on the target table, and stamps
 * `applied_in_scan_version_id` so already-applied rows are skipped on
 * subsequent scans (idempotent re-application).
 *
 * Polymorphic target: `target_id` references either `connections.id` or
 * `services.id` based on `kind`. SQLite has no polymorphic FK support; the
 * apply-hook validates target existence at apply time and logs+skips dangling
 * rows. Same approach as `enrichment_log.target_id` (mig 016).
 *
 * Two indexes:
 *   - idx_scan_overrides_kind_target: future "is there an override for this
 *     row?" lookups (Phase 118 /arcanon:correct will use this).
 *   - idx_scan_overrides_pending: speeds the `WHERE applied_in_scan_version_id
 *     IS NULL` filter that getPendingOverrides() runs on every scan.
 *
 * Idempotent natively via `CREATE TABLE IF NOT EXISTS` and
 * `CREATE INDEX IF NOT EXISTS` - no PRAGMA guard needed (mirrors mig 016).
 *
 * Note: db.exec below is better-sqlite3's bulk-SQL execution method (not the
 * Node process-spawning API of similar name). It runs DDL against the SQLite
 * database directly - no shell, no process spawning, no user input.
 */

export const version = 17;

const DDL = `
  CREATE TABLE IF NOT EXISTS scan_overrides (
    override_id                INTEGER PRIMARY KEY AUTOINCREMENT,
    kind                       TEXT    NOT NULL CHECK(kind IN ('connection', 'service')),
    target_id                  INTEGER NOT NULL,
    action                     TEXT    NOT NULL CHECK(action IN ('delete', 'update', 'rename', 'set-base-path')),
    payload                    TEXT    NOT NULL DEFAULT '{}',
    created_at                 TEXT    NOT NULL DEFAULT (datetime('now')),
    applied_in_scan_version_id INTEGER REFERENCES scan_versions(id) ON DELETE SET NULL,
    created_by                 TEXT    NOT NULL DEFAULT 'system'
  );

  CREATE INDEX IF NOT EXISTS idx_scan_overrides_kind_target
    ON scan_overrides(kind, target_id);

  CREATE INDEX IF NOT EXISTS idx_scan_overrides_pending
    ON scan_overrides(applied_in_scan_version_id);
`;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(DDL);
}
