/**
 * Migration 015 — TRUST-05: adds `scan_versions.quality_score REAL` (nullable).
 *
 * Phase 111 schema bundle (part 1 of 2). The quality score is a per-scan scalar
 * computed as `(high_confidence_count + 0.5 * low_confidence_count) / total_connections`
 * (see .planning/phases/111-quality-score-and-audit-trail/111-CONTEXT.md D-02 for
 * NULL semantics and confidence-IS-NULL handling).
 *
 * Existing rows pick up NULL on first run; new scans populate via `endScan()` in
 * Plan 111-02. No backfill — historical scans retain NULL.
 *
 * Idempotent via PRAGMA table_info check (mirrors migrations 011, 014).
 *
 * Migration ordering: this is `version: 15`. Migration 014 (services.base_path)
 * shipped in Phase 110 and is unrelated; the loader (database.js:41-68) sorts
 * by exported `version` integer.
 *
 * Note: db.exec below is better-sqlite3's SQL execution method (not Node's
 * child_process.exec). It executes the ALTER TABLE statement against the
 * SQLite database — no shell, no process spawning.
 */

export const version = 15;

const ALTER_SQL = "ALTER TABLE scan_versions ADD COLUMN quality_score REAL;";

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  const hasCol = (table, col) =>
    db
      .prepare("PRAGMA table_info(" + table + ")")
      .all()
      .some((c) => c.name === col);

  if (!hasCol("scan_versions", "quality_score")) {
    db.exec(ALTER_SQL);
  }
}
