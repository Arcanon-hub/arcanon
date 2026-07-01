/**
 * Migration 021 — Add map_versions.kind TEXT and map_versions.repos_json TEXT columns.
 *
 * map_versions stores one row per project-level scan run (one snapshot per
 * /arcanon:map or /arcanon:rescan invocation). The two new columns make each
 * row self-describing for Phase 142's diff and drift consumers:
 *
 *   kind       TEXT NOT NULL DEFAULT 'map'
 *              'map'    — full multi-repo /arcanon:map run
 *              'rescan' — single-repo /arcanon:rescan run
 *              Domain constrained by the writer (createSnapshot in database.js);
 *              no CHECK constraint is added here because ALTER TABLE cannot
 *              portably add one to an existing table.
 *
 *   repos_json TEXT (nullable)
 *              JSON array of {path: string, scan_version_id: number} objects
 *              describing which repos (and their scan_versions.id) are covered
 *              by this snapshot. Pre-021 rows default to NULL; Phase 142's
 *              resolve-scan.js falls back to querying the snapshot DB directly
 *              when repos_json is absent.
 *
 * Idempotency: SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so we
 * inspect PRAGMA table_info(map_versions) before issuing each ALTER.
 * Re-running up() on an already-migrated DB is a no-op — each column guard
 * is independent so a partially-migrated DB (kind present, repos_json absent)
 * completes cleanly.
 *
 * Reversibility: SQLite does not support DROP COLUMN cleanly pre-3.35. The
 * columns are harmless when ignored (safe defaults, no triggers). "Rollback"
 * means stop reading them. No data destruction — existing map_versions rows
 * survive with kind='map' (the default) and repos_json=NULL.
 *
 * Note: db.exec / db.prepare are the methods of the node:sqlite adapter
 * (worker/db/sqlite-adapter.js — Phase 128 migrated this codebase to the
 * builtin node:sqlite module). They run SQL directly against the database —
 * no shell, no process spawning, no user input. The map_versions table is
 * created (IF NOT EXISTS) by migration 001, which always runs before 021
 * because migrations apply in filename/version order.
 */

export const version = 21;

/**
 * @param {import('../sqlite-adapter.js').default} db - node:sqlite adapter instance
 */
export function up(db) {
  const cols = db.prepare('PRAGMA table_info(map_versions)').all();

  const hasKind = cols.some((c) => c.name === 'kind');
  if (!hasKind) {
    db.exec("ALTER TABLE map_versions ADD COLUMN kind TEXT NOT NULL DEFAULT 'map'");
  }

  const hasReposJson = cols.some((c) => c.name === 'repos_json');
  if (!hasReposJson) {
    db.exec('ALTER TABLE map_versions ADD COLUMN repos_json TEXT');
  }
}
