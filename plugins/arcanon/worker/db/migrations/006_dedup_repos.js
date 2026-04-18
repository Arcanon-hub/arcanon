/**
 * Migration 006 — Add UNIQUE(path) to repos, deduplicate existing rows.
 *
 * Problem: repos table has no UNIQUE constraint on path. Re-scanning creates
 * duplicate repo rows, which in turn create duplicate services (different repo_id,
 * same service name). Migration 004 fixed services but not the root cause.
 *
 * Strategy: Same in-place dedup as migration 004 but for repos.
 *   1. Build id remapping: old_id → surviving MAX(id) per path
 *   2. Re-point services.repo_id, repo_state.repo_id to surviving ids
 *   3. Delete duplicate repo rows
 *   4. Re-dedup services after repo merge (same name may now share repo_id)
 *   5. CREATE UNIQUE INDEX on repos(path)
 */

export const version = 6;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  // Step 0 — Drop services UNIQUE index (migration 004) so re-pointing repo_ids
  // doesn't violate the constraint when two repos merge into one
  db.exec(`DROP INDEX IF EXISTS uq_services_repo_name;`);

  // Step 1 — Build repo id remapping
  db.exec(`
    CREATE TEMP TABLE _repo_id_map AS
    SELECT r.id AS old_id,
           (SELECT MAX(r2.id) FROM repos r2 WHERE r2.path = r.path) AS new_id
    FROM repos r;
  `);

  // Step 2a — Re-point services.repo_id
  db.exec(`
    UPDATE services
    SET repo_id = (SELECT new_id FROM _repo_id_map WHERE old_id = repo_id)
    WHERE repo_id IN (SELECT old_id FROM _repo_id_map WHERE old_id != new_id);
  `);

  // Step 2b — Re-point repo_state.repo_id
  // Delete duplicate repo_state rows first (keep the one referencing surviving repo)
  db.exec(`
    DELETE FROM repo_state
    WHERE repo_id IN (SELECT old_id FROM _repo_id_map WHERE old_id != new_id);
  `);

  // Step 3 — Delete duplicate repo rows
  db.exec(`
    DELETE FROM repos
    WHERE id IN (SELECT old_id FROM _repo_id_map WHERE old_id != new_id);
  `);

  // Step 4 — Drop temp table
  db.exec(`DROP TABLE _repo_id_map;`);

  // Step 5 — After merging repos, services may now have duplicate (repo_id, name).
  // UNIQUE index already dropped in Step 0. Re-dedup services.
  db.exec(`
    CREATE TEMP TABLE _svc_id_map2 AS
    SELECT s.id AS old_id,
           (SELECT MAX(s2.id) FROM services s2
            WHERE s2.repo_id = s.repo_id AND s2.name = s.name) AS new_id
    FROM services s;
  `);

  // Re-point connections
  db.exec(`
    UPDATE connections
    SET source_service_id = (SELECT new_id FROM _svc_id_map2 WHERE old_id = source_service_id)
    WHERE source_service_id IN (SELECT old_id FROM _svc_id_map2 WHERE old_id != new_id);
  `);
  db.exec(`
    UPDATE connections
    SET target_service_id = (SELECT new_id FROM _svc_id_map2 WHERE old_id = target_service_id)
    WHERE target_service_id IN (SELECT old_id FROM _svc_id_map2 WHERE old_id != new_id);
  `);

  // Re-point exposed_endpoints if exists
  const hasEE = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='exposed_endpoints'")
    .get();
  if (hasEE) {
    db.exec(`
      UPDATE exposed_endpoints
      SET service_id = (SELECT new_id FROM _svc_id_map2 WHERE old_id = service_id)
      WHERE service_id IN (SELECT old_id FROM _svc_id_map2 WHERE old_id != new_id);
    `);
  }

  // Delete duplicate services
  db.exec(`
    DELETE FROM services
    WHERE id IN (SELECT old_id FROM _svc_id_map2 WHERE old_id != new_id);
  `);

  db.exec(`DROP TABLE _svc_id_map2;`);

  // Recreate the services UNIQUE index (dropped above for re-dedup)
  db.exec(`CREATE UNIQUE INDEX uq_services_repo_name ON services(repo_id, name);`);

  // Step 6 — Create UNIQUE INDEX on repos(path)
  db.exec(`
    CREATE UNIQUE INDEX uq_repos_path ON repos(path);
  `);

  // Step 7 — Rebuild FTS5 indexes (service row ids changed)
  db.exec(`
    INSERT INTO services_fts(services_fts) VALUES('rebuild');
    INSERT INTO connections_fts(connections_fts) VALUES('rebuild');
  `);
}
