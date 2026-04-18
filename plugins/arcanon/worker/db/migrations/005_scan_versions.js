/**
 * Migration 005 — Add scan_versions table and scan_version_id FK columns
 *
 * Purpose: Provides the bracket primitives that make re-scan atomic.
 * New rows carry the new scan_version_id; stale rows from prior scans are
 * deleted by endScan() after the new scan completes successfully.
 *
 * Changes:
 *   1. CREATE TABLE scan_versions (id, repo_id, started_at, completed_at)
 *   2. ALTER TABLE services    ADD COLUMN scan_version_id (nullable FK)
 *   3. ALTER TABLE connections ADD COLUMN scan_version_id (nullable FK)
 *
 * Existing rows receive NULL for scan_version_id — they are treated as
 * legacy pre-bracket rows and are NOT deleted by endScan.
 *
 * NOTE: SQLite ALTER TABLE ADD COLUMN supports nullable columns without DEFAULT.
 * Anti-Pattern 5: never add NOT NULL without DEFAULT on existing tables.
 */

export const version = 5;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id      INTEGER NOT NULL REFERENCES repos(id),
      started_at   TEXT    NOT NULL,
      completed_at TEXT
    );

    ALTER TABLE services    ADD COLUMN scan_version_id INTEGER REFERENCES scan_versions(id);
    ALTER TABLE connections ADD COLUMN scan_version_id INTEGER REFERENCES scan_versions(id);
  `);
}
