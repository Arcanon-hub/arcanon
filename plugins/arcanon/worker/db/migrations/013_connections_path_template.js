/**
 * Migration 013 — Add connections.path_template column + UNIQUE dedup index.
 *
 * Phase 109 (TRUST-03): connections whose only difference is a template variable
 * name (e.g. /runtime/streams/{stream_id} vs /runtime/streams/{name}) need to
 * collapse to a single canonical row. The canonical form ({_} placeholder) is
 * stored in the existing `path` column. The original template(s) — what the
 * agent actually emitted — are stored in the new `path_template` column for
 * display.
 *
 * Two physical changes:
 *   1. ALTER TABLE connections ADD COLUMN path_template TEXT
 *   2. CREATE UNIQUE INDEX uq_connections_dedup ON connections
 *        (source_service_id, target_service_id, protocol, method, path)
 *      so that INSERT OR REPLACE in upsertConnection actually collapses
 *      template-variants to a single row. Pre-013 the table had no UNIQUE
 *      constraint on connections, so re-scans appended duplicates instead
 *      of replacing — the path canonicalization story would be a no-op
 *      without this index. (Mirrors migration 004's pattern of "dedup
 *      duplicates first, then create UNIQUE index".)
 *
 * On collapse of multiple variants, persistFindings (Plan 109-02) stores
 * templates comma-joined (e.g. "/runtime/streams/{stream_id},/runtime/streams/{name}").
 *
 * Idempotent via PRAGMA table_info / index_list checks — safe to re-run.
 *
 * Existing rows are NOT backfilled with canonicalized paths. They retain
 * `path_template = NULL` until a re-scan touches the row. See
 * .planning/phases/109-path-canonicalization-and-evidence/109-CONTEXT.md D-06
 * for the safety rationale (silent canonicalization of historic data could
 * incorrectly collapse legitimately-distinct rows).
 *
 * Pre-existing duplicate rows (same source/target/protocol/method/path) are
 * deduped here BEFORE the UNIQUE index is created — otherwise the CREATE
 * UNIQUE INDEX statement would fail. We keep MAX(id) per group (most recent
 * upsert wins) and reassign FK references via the schemas table.
 *
 * Migration numbering: this is `version: 13`. Phase 110 ships `version: 12`
 * (services.base_path) later in the v0.1.3 train. The loader (database.js:41-68)
 * sorts by exported `version` integer, so 013 runs after 012 once 012 lands —
 * shipping 013 first is safe at runtime.
 */

export const version = 13;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  const hasCol = (table, col) =>
    db
      .prepare("PRAGMA table_info(" + table + ")")
      .all()
      .some((c) => c.name === col);
  const hasIndex = (name) =>
    db
      .prepare("PRAGMA index_list(connections)")
      .all()
      .some((i) => i.name === name);

  // Step 1 — Add path_template column (idempotent)
  if (!hasCol("connections", "path_template")) {
    db.exec("ALTER TABLE connections ADD COLUMN path_template TEXT;");
  }

  // Step 2 — Add UNIQUE dedup index (idempotent). Pre-existing duplicates
  // must be removed first or CREATE UNIQUE INDEX fails.
  if (!hasIndex("uq_connections_dedup")) {
    // Step 2a — Build remap table: each duplicate group → MAX(id) survivor.
    // method/path are nullable → use IFNULL coalesce so NULLs group together.
    db.exec(`
      CREATE TEMP TABLE _conn_id_map AS
      SELECT c.id AS old_id,
             (SELECT MAX(c2.id) FROM connections c2
              WHERE c2.source_service_id = c.source_service_id
                AND c2.target_service_id = c.target_service_id
                AND c2.protocol = c.protocol
                AND IFNULL(c2.method, '') = IFNULL(c.method, '')
                AND IFNULL(c2.path,   '') = IFNULL(c.path,   '')) AS new_id
      FROM connections c;
    `);

    // Step 2b — Re-point schemas.connection_id to surviving id (FK)
    const hasSchemas = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schemas'")
      .get();
    if (hasSchemas) {
      db.exec(`
        UPDATE schemas
        SET connection_id = (SELECT new_id FROM _conn_id_map WHERE old_id = connection_id)
        WHERE connection_id IN (SELECT old_id FROM _conn_id_map WHERE old_id != new_id);
      `);
    }

    // Step 2c — Delete duplicate rows (all non-MAX(id) per group)
    db.exec(`
      DELETE FROM connections
      WHERE id IN (SELECT old_id FROM _conn_id_map WHERE old_id != new_id);
    `);

    // Step 2d — Drop the remap temp table
    db.exec("DROP TABLE _conn_id_map;");

    // Step 2e — Create the UNIQUE dedup index. NULLs in method/path are
    // distinct under SQLite UNIQUE semantics, but the table-level INSERT OR
    // REPLACE in upsertConnection does the right thing because callers
    // always pass identical (source, target, protocol, method, path) shape
    // for the same logical connection. Same caveat as services.canonical_name.
    db.exec(`
      CREATE UNIQUE INDEX uq_connections_dedup
        ON connections(source_service_id, target_service_id, protocol, method, path);
    `);
  }
}
