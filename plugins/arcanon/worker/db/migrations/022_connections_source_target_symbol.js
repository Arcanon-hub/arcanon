/**
 * Migration 022 — Add connections.source_symbol TEXT and connections.target_symbol TEXT.
 *
 * The contract (Phase 140, plan 140-01) now validates that source_file is a
 * filesystem path only (no :symbol suffix) and places the symbol name in the
 * separate field source_symbol. target_symbol mirrors this for target_file.
 *
 * This migration wires in the persistence side of CTR-03 (source_file / symbol
 * split):
 *
 *   source_symbol  TEXT (nullable)
 *                  Symbol or function name at the call site extracted from the
 *                  combined "path:symbol" source_file value the agent previously
 *                  emitted. Post-022 agents emit separate fields; this column
 *                  stores the result from either path.
 *
 *   target_symbol  TEXT (nullable)
 *                  Identical semantics for the target side.
 *
 * One-time data migration: existing "path:symbol" rows are split using a
 * conservative heuristic — only split when:
 *   (a) the portion before the colon contains a dot (has a file extension), AND
 *   (b) the portion after the colon contains no slash (is a symbol, not a path
 *       component on a colon-using filesystem).
 * A plain path like "src/auth.ts" (no colon) is unchanged; source_symbol stays
 * NULL. A hypothetical "src/http:client.ts" (slash after colon) is NOT split.
 *
 * Idempotency: SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so we
 * inspect PRAGMA table_info(connections) before issuing each ALTER.
 * Re-running up() on an already-migrated DB is a no-op — the PRAGMA guard skips
 * the ALTER, and the UPDATE matches no rows because already-split values no
 * longer contain the separator colon.
 *
 * Reversibility: SQLite does not support DROP COLUMN cleanly pre-3.35. Both
 * columns are TEXT NULL with no constraints or triggers, so "rollback" is
 * "stop reading from them". Existing connections rows survive with NULL values
 * for rows that had no combined source_file or were already plain paths.
 *
 * FTS5 note (Pitfall 4): the connections_au AFTER UPDATE trigger fires for every
 * connections row updated during the data migration, re-indexing source_file in
 * the connections_fts content table. This is the correct FTS5 behaviour and
 * happens once at DB upgrade time, not in a hot path.
 *
 * Note: db.exec / db.prepare are the methods of the node:sqlite adapter
 * (worker/db/sqlite-adapter.js — Phase 128 migrated this codebase to the
 * builtin node:sqlite module). They run SQL directly against the database —
 * no shell, no process spawning, no user input. The connections table is
 * created (IF NOT EXISTS) by migration 001, which always runs before 022
 * because migrations apply in filename/version order.
 */

export const version = 22;

/**
 * @param {import('../sqlite-adapter.js').default} db - node:sqlite adapter instance
 */
export function up(db) {
  const cols = db.prepare('PRAGMA table_info(connections)').all();

  const hasSourceSymbol = cols.some((c) => c.name === 'source_symbol');
  if (!hasSourceSymbol) {
    db.exec('ALTER TABLE connections ADD COLUMN source_symbol TEXT');
    // Conservative colon-split: only when:
    //   (a) portion before colon has a dot (extension), AND
    //   (b) portion after colon has no slash (symbol, not a path component).
    db.exec(`
      UPDATE connections
      SET
        source_symbol = SUBSTR(source_file, INSTR(source_file, ':') + 1),
        source_file   = SUBSTR(source_file, 1, INSTR(source_file, ':') - 1)
      WHERE source_file IS NOT NULL
        AND INSTR(source_file, ':') > 0
        AND INSTR(SUBSTR(source_file, INSTR(source_file, ':') + 1), '/') = 0
        AND INSTR(SUBSTR(source_file, 1, INSTR(source_file, ':') - 1), '.') > 0
    `);
  }

  const hasTargetSymbol = cols.some((c) => c.name === 'target_symbol');
  if (!hasTargetSymbol) {
    db.exec('ALTER TABLE connections ADD COLUMN target_symbol TEXT');
    db.exec(`
      UPDATE connections
      SET
        target_symbol = SUBSTR(target_file, INSTR(target_file, ':') + 1),
        target_file   = SUBSTR(target_file, 1, INSTR(target_file, ':') - 1)
      WHERE target_file IS NOT NULL
        AND INSTR(target_file, ':') > 0
        AND INSTR(SUBSTR(target_file, INSTR(target_file, ':') + 1), '/') = 0
        AND INSTR(SUBSTR(target_file, 1, INSTR(target_file, ':') - 1), '.') > 0
    `);
  }
}
