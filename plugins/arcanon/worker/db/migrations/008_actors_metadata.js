/**
 * Migration 008 — Add actors, actor_connections, and node_metadata tables;
 * add crossing column to connections; populate actors from external connections.
 *
 * DATA-01: actors table — external system actors (identified by name, kind, direction)
 * DATA-02: actor_connections table — join table linking actors to the internal services
 *           that connect to them (with protocol/path context)
 * DATA-03: node_metadata table — extensible key/value metadata per service per view
 *           (supports STRIDE, vulnerability views, etc. without future migrations)
 * DATA-04: connections.crossing column — distinguishes internal-to-internal connections
 *           from internal-to-external (crossing = 'external')
 *
 * Population: On existing DBs the crossing column is just added as NULL, so the
 * INSERT OR IGNORE finds zero external connections — this is correct and expected.
 * On future DBs where connections already have crossing='external' set before this
 * migration runs (e.g. in CI test setups or migrations applied in order), actors
 * are automatically backfilled.
 */

export const version = 8;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  // 1. Add crossing column to connections (nullable — existing rows get NULL)
  // SQLite does not support ALTER TABLE ADD COLUMN IF NOT EXISTS, so we check
  // whether the column already exists before attempting to add it.
  const connectionsCols = db.prepare("PRAGMA table_info(connections)").all();
  const hasCrossing = connectionsCols.some((c) => c.name === "crossing");
  if (!hasCrossing) {
    db.exec(`
      ALTER TABLE connections ADD COLUMN crossing TEXT;
    `);
  }

  // 2. Create actors table
  // One row per unique external actor name. kind='system' is the default actor
  // type for v3.0 (external services). direction='outbound' means internal services
  // reach out to this actor.
  db.exec(`
    CREATE TABLE IF NOT EXISTS actors (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL,
      kind      TEXT    NOT NULL DEFAULT 'system',
      direction TEXT    NOT NULL DEFAULT 'outbound',
      source    TEXT    NOT NULL DEFAULT 'scan',
      UNIQUE(name)
    );
  `);

  // 3. Create actor_connections table
  // Join table between actors and services. ON DELETE CASCADE ensures referential
  // integrity: deleting an actor or service automatically removes join rows.
  db.exec(`
    CREATE TABLE IF NOT EXISTS actor_connections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id   INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      direction  TEXT    NOT NULL DEFAULT 'outbound',
      protocol   TEXT,
      path       TEXT
    );
  `);

  // 4. Create node_metadata table
  // Stores extensible per-service metadata keyed by (service_id, view, key).
  // UNIQUE(service_id, view, key) enables upsert patterns via INSERT OR REPLACE.
  // updated_at defaults to datetime('now') — auto-timestamps on insert.
  // ON DELETE CASCADE ensures metadata is removed when the service is deleted.
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_metadata (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      view       TEXT    NOT NULL,
      key        TEXT    NOT NULL,
      value      TEXT,
      source     TEXT,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_id, view, key)
    );
  `);

  // 5. Populate actors from existing connections where crossing = 'external'
  //
  // On existing DBs, crossing was just added as NULL so this query finds zero rows.
  // This is correct — no phantom actors are created from pre-migration data.
  //
  // INSERT OR IGNORE is used so re-running the migration is safe (IF NOT EXISTS
  // on the table + OR IGNORE on actors = fully idempotent).
  db.exec(`
    INSERT OR IGNORE INTO actors (name, kind, direction, source)
    SELECT DISTINCT s_target.name, 'system', 'outbound', 'scan'
    FROM connections c
    JOIN services s_target ON s_target.id = c.target_service_id
    WHERE c.crossing = 'external';
  `);

  db.exec(`
    INSERT OR IGNORE INTO actor_connections (actor_id, service_id, direction, protocol, path)
    SELECT a.id, c.source_service_id, 'outbound', c.protocol, c.path
    FROM connections c
    JOIN services s_target ON s_target.id = c.target_service_id
    JOIN actors a ON a.name = s_target.name
    WHERE c.crossing = 'external';
  `);
}
