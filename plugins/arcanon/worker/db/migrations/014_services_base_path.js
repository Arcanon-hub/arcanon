/**
 * Migration 014 — Add services.base_path column.
 *
 * Phase 110 (TRUST-04): services may declare a path prefix that reverse
 * proxies / ingress controllers strip before forwarding (e.g., `/api`).
 * Connection resolution uses base_path to strip the prefix from outbound
 * paths before matching against exposed_endpoints, eliminating a class of
 * false-mismatch findings.
 *
 * Backwards-compatible (D-01): the column is optional. Pre-110 rows have
 * base_path = NULL and resolution behavior is unchanged for them — they
 * pick up base_path only on re-scan.
 *
 * Idempotent via PRAGMA table_info check — safe to re-run.
 *
 * Migration ordering: this is `version: 14`. Phase 109 shipped migration 013
 * (connections.path_template) first; Phase 110 ships 14 here. The loader
 * (database.js:41-68) sorts by exported `version` integer.
 *
 * Note: db.exec below is better-sqlite3's SQL execution (not child_process).
 */

export const version = 14;

const ALTER_SQL = "ALTER TABLE services ADD COLUMN base_path TEXT;";

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  const hasCol = (table, col) =>
    db
      .prepare("PRAGMA table_info(" + table + ")")
      .all()
      .some((c) => c.name === col);

  if (!hasCol("services", "base_path")) {
    db.exec(ALTER_SQL);
  }
}
