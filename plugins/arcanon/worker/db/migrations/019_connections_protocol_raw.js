/**
 * Migration 019 — Add connections.protocol_raw TEXT NULL column.
 *
 * connections.protocol holds the CANONICAL bucket (rest/grpc/events/db/...) used
 * for rendering and filtering. protocol_raw preserves the agent's ORIGINAL token
 * (e.g. "NATS", "PostgreSQL") so the detail panel can display the specific
 * technology, and so the scan-version diff can key on a value that is stable
 * across the #42 canonicalization migration (avoiding a one-time churn where
 * every pub/sub/DB edge would otherwise diff as removed+added).
 *
 * Idempotency: SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so we
 * inspect PRAGMA table_info(connections) before issuing the ALTER. Re-running
 * up() is a no-op.
 *
 * Reversibility: SQLite does not support `DROP COLUMN` cleanly pre-3.35. The
 * column is harmless when ignored (TEXT NULL, no constraints, no triggers), so
 * "rollback" is "stop reading from it". No data destruction.
 *
 * Note: db.exec / db.prepare are the methods of the node:sqlite adapter
 * (worker/db/sqlite-adapter.js — Phase 128 migrated this codebase to the
 * builtin node:sqlite module). They run SQL directly against the database —
 * no shell, no process spawning, no user input.
 */

export const version = 19;

/**
 * @param {import('../sqlite-adapter.js').default} db - node:sqlite adapter instance
 */
export function up(db) {
  const cols = db.prepare('PRAGMA table_info(connections)').all();
  const hasProtocolRaw = cols.some((c) => c.name === 'protocol_raw');
  if (!hasProtocolRaw) {
    db.exec('ALTER TABLE connections ADD COLUMN protocol_raw TEXT;');
  }
}
