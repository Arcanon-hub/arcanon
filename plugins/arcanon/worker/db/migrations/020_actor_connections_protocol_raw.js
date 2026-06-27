/**
 * Migration 020 — Add actor_connections.protocol_raw TEXT NULL column.
 *
 * actor_connections.protocol holds the CANONICAL bucket (rest/grpc/events/db/...)
 * used for rendering and filtering external-actor edges. protocol_raw preserves
 * the agent's ORIGINAL external-actor token (e.g. "NATS", "PostgreSQL") so the
 * detail panel can surface the specific technology for external/actor edges —
 * exactly like connection edges. This is the #42 headline gap that migration 019
 * (which added protocol_raw to the `connections` table only) left open: actor
 * edges canonicalized their protocol but dropped the raw token, starving the
 * detail panel's protocol-raw badge.
 *
 * Idempotency: SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so we
 * inspect PRAGMA table_info(actor_connections) before issuing the ALTER.
 * Re-running up() is a no-op.
 *
 * Reversibility: SQLite does not support `DROP COLUMN` cleanly pre-3.35. The
 * column is harmless when ignored (TEXT NULL, no constraints, no triggers), so
 * "rollback" is "stop reading from it". No data destruction — existing
 * actor_connections rows survive with protocol_raw = NULL.
 *
 * Note: db.exec / db.prepare are the methods of the node:sqlite adapter
 * (worker/db/sqlite-adapter.js — Phase 128 migrated this codebase to the
 * builtin node:sqlite module). They run SQL directly against the database —
 * no shell, no process spawning, no user input. The actor_connections table is
 * created (IF NOT EXISTS) by migration 008, which always runs before 020 because
 * migrations apply in filename/version order.
 */

export const version = 20;

/**
 * @param {import('../sqlite-adapter.js').default} db - node:sqlite adapter instance
 */
export function up(db) {
  const cols = db.prepare('PRAGMA table_info(actor_connections)').all();
  const hasProtocolRaw = cols.some((c) => c.name === 'protocol_raw');
  if (!hasProtocolRaw) {
    db.exec('ALTER TABLE actor_connections ADD COLUMN protocol_raw TEXT;');
  }
}
