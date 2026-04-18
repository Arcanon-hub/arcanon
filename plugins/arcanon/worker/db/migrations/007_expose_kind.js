/**
 * Migration 007 — Add kind discriminant column to exposed_endpoints, purge malformed rows.
 *
 * STORE-01: Adds `kind TEXT NOT NULL DEFAULT 'endpoint'` to exposed_endpoints.
 *   The kind column is the foundation for type-specific data in v2.3 — it lets
 *   the parser tag rows as 'endpoint', 'library', or 'infra' without a table rename.
 *
 * STORE-02: Deletes malformed rows where method IS NULL AND path NOT LIKE '/%'.
 *   Broken library/infra scans inserted function signatures (e.g. 'ClientConfig):')
 *   and Unicode arrows (e.g. '→') as path values. These rows occupy UNIQUE slots
 *   (service_id, method, path) and cause INSERT OR IGNORE to silently block correct
 *   rows on re-scan. Must be purged before the fixed parser lands in Plan 30-02.
 */

export const version = 7;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  // STORE-01: Add kind discriminant column with default 'endpoint'
  db.exec(`
    ALTER TABLE exposed_endpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'endpoint';
  `);

  // STORE-02: Purge malformed rows from broken library/infra scans.
  // Predicate: method IS NULL AND path NOT LIKE '/%'
  //   - method IS NULL: REST endpoints typically have a method; null-method rows
  //     that are valid (e.g. webhooks) always start with '/'
  //   - path NOT LIKE '/%': real REST paths start with '/'; function signatures,
  //     arrows, and other scanner artifacts do not
  db.exec(`
    DELETE FROM exposed_endpoints
    WHERE method IS NULL AND path NOT LIKE '/%';
  `);

  // STORE-03 prerequisite: The original UNIQUE(service_id, method, path) constraint
  // treats NULL != NULL in SQLite, so two rows with method=NULL and the same path are
  // considered distinct — INSERT OR IGNORE never fires for library/infra rows, causing
  // duplicate rows on re-scan. Replace the constraint with a unique index that uses
  // COALESCE(method, '') so NULL method values compare as equal.
  //
  // Strategy: SQLite cannot drop a table-level UNIQUE constraint. Recreate the table
  // without the inline UNIQUE, then add a covering index.
  db.exec(`
    CREATE TABLE exposed_endpoints_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      method     TEXT,
      path       TEXT NOT NULL,
      handler    TEXT,
      kind       TEXT NOT NULL DEFAULT 'endpoint'
    );

    INSERT INTO exposed_endpoints_new (id, service_id, method, path, handler, kind)
    SELECT id, service_id, method, path, handler, kind
    FROM exposed_endpoints;

    DROP TABLE exposed_endpoints;
    ALTER TABLE exposed_endpoints_new RENAME TO exposed_endpoints;
  `);

  // Unique index using COALESCE so NULL method values are treated as equal
  db.exec(`
    CREATE UNIQUE INDEX uq_exposed_endpoints
    ON exposed_endpoints(service_id, COALESCE(method, ''), path);
  `);
}
