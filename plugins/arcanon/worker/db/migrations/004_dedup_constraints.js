/**
 * Migration 004 — Add UNIQUE(repo_id, name) to services, deduplicate existing rows,
 * add canonical_name column, rebuild FTS5.
 *
 * Problem: Re-scanning a repo appends duplicate (repo_id, name) rows — unbounded
 * graph growth and incorrect impact queries.
 *
 * Strategy: In-place deduplication + UNIQUE INDEX creation (no table recreation).
 *   1. Build id remapping table: old_id → surviving MAX(id) per (repo_id, name)
 *   2. Re-point connections.source_service_id / target_service_id to surviving ids
 *   3. Re-point exposed_endpoints.service_id to surviving ids
 *   4. DELETE duplicate service rows (non-MAX(id) rows)
 *   5. CREATE UNIQUE INDEX on (repo_id, name) — now safe after dedup
 *   6. ALTER TABLE services ADD COLUMN canonical_name TEXT
 *   7. Rebuild all FTS5 indexes
 *
 * This avoids DROP TABLE / ALTER TABLE RENAME, which triggers FK schema rewriting
 * in SQLite 3.26+ and fails when foreign_keys = ON is active inside a transaction.
 *
 * IMPORTANT: Do NOT open a transaction inside up() — runMigrations() in database.js
 * already wraps each migration in db.transaction().
 */

export const version = 4;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  // Step 1 — Build id remapping table: maps every old id to the surviving MAX(id)
  // for its (repo_id, name) pair. TEMP table lives only in this connection/session.
  db.exec(`
    CREATE TEMP TABLE _svc_id_map AS
    SELECT s.id AS old_id,
           (SELECT MAX(s2.id) FROM services s2
            WHERE s2.repo_id = s.repo_id AND s2.name = s.name) AS new_id
    FROM services s;
  `);

  // Step 2a — Re-point connections.source_service_id to surviving id
  db.exec(`
    UPDATE connections
    SET source_service_id = (SELECT new_id FROM _svc_id_map WHERE old_id = source_service_id)
    WHERE source_service_id IN (SELECT old_id FROM _svc_id_map WHERE old_id != new_id);
  `);

  // Step 2b — Re-point connections.target_service_id to surviving id
  db.exec(`
    UPDATE connections
    SET target_service_id = (SELECT new_id FROM _svc_id_map WHERE old_id = target_service_id)
    WHERE target_service_id IN (SELECT old_id FROM _svc_id_map WHERE old_id != new_id);
  `);

  // Step 3 — Re-point exposed_endpoints.service_id to surviving id
  // Guard: exposed_endpoints may not exist if migration 003 was never applied
  const hasExposedEndpoints = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='exposed_endpoints'",
    )
    .get();
  if (hasExposedEndpoints) {
    db.exec(`
      UPDATE exposed_endpoints
      SET service_id = (SELECT new_id FROM _svc_id_map WHERE old_id = service_id)
      WHERE service_id IN (SELECT old_id FROM _svc_id_map WHERE old_id != new_id);
    `);
  }

  // Step 4 — Delete duplicate service rows (all non-MAX(id) rows per pair)
  db.exec(`
    DELETE FROM services
    WHERE id IN (SELECT old_id FROM _svc_id_map WHERE old_id != new_id);
  `);

  // Step 5 — Drop remapping temp table (no longer needed)
  db.exec(`DROP TABLE _svc_id_map;`);

  // Step 6 — Create UNIQUE INDEX on (repo_id, name) — safe now that duplicates removed
  db.exec(`
    CREATE UNIQUE INDEX uq_services_repo_name ON services(repo_id, name);
  `);

  // Step 7 — Add canonical_name column (TEXT, nullable, no default)
  db.exec(`
    ALTER TABLE services ADD COLUMN canonical_name TEXT;
  `);

  // Step 8 — Rebuild all FTS5 indexes (must be last, inside same transaction)
  db.exec(`
    INSERT INTO services_fts(services_fts) VALUES('rebuild');
    INSERT INTO connections_fts(connections_fts) VALUES('rebuild');
    INSERT INTO fields_fts(fields_fts) VALUES('rebuild');
  `);
}
