/**
 * Migration 003 — Add exposed_endpoints table
 *
 * Stores what each service exposes (endpoints, topics, SDK functions).
 * Used for cross-referencing: does a consumer call an endpoint the target actually exposes?
 */

export const version = 3;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exposed_endpoints (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id  INTEGER NOT NULL REFERENCES services(id),
      method      TEXT,
      path        TEXT NOT NULL,
      handler     TEXT,
      UNIQUE(service_id, method, path)
    );
  `);
}
