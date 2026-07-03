/**
 * Migration 023 — Add services.source_file TEXT column.
 *
 * Phase 141 (plan 141-01) requires deleting services whose defining source file
 * was deleted or renamed during an incremental scan (_deleteDeletedFileFindings).
 * The agent emits `source_file` on each service to identify which file defines
 * that service; this migration persists it so the PIPE-04 delete predicate can
 * target `WHERE source_file = ?` with a bound parameter.
 *
 * The column is nullable: agents that pre-date this field or services with no
 * identifiable source file store NULL. Null-source_file services are never
 * matched by _deleteDeletedFileFindings (intentional — cannot attribute them to
 * a specific deleted file without a source_file value).
 *
 * Idempotent via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — SQLite supports
 * this form since 3.37.0 (Node floor >= 22.13 ships SQLite >= 3.43).
 *
 * Note: db.exec is the sqlite-adapter bulk-SQL execution method (wraps
 * node:sqlite DatabaseSync.exec). It runs DDL against the SQLite database
 * directly — no shell, no process spawning, no user input.
 */

export const version = 23;

/**
 * @param {import('../sqlite-adapter.js').default} db
 */
export function up(db) {
  const hasCol = db.prepare('PRAGMA table_info(services)').all().some(c => c.name === 'source_file');
  if (!hasCol) {
    db.exec('ALTER TABLE services ADD COLUMN source_file TEXT');
  }
}
