/**
 * Migration 001 — Initial schema
 *
 * Creates the 7 domain tables, FTS5 virtual tables for keyword search,
 * and triggers to keep FTS5 content tables in sync.
 */

export const version = 1;

/**
 * Applies the initial schema to the given database.
 * All statements use IF NOT EXISTS for idempotency.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    -- -----------------------------------------------------------------------
    -- Domain tables
    -- -----------------------------------------------------------------------

    CREATE TABLE IF NOT EXISTS repos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      type        TEXT    NOT NULL,
      last_commit TEXT,
      scanned_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS services (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id     INTEGER NOT NULL REFERENCES repos(id),
      name        TEXT    NOT NULL,
      root_path   TEXT    NOT NULL,
      language    TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connections (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      source_service_id INTEGER NOT NULL REFERENCES services(id),
      target_service_id INTEGER NOT NULL REFERENCES services(id),
      protocol          TEXT    NOT NULL,
      method            TEXT,
      path              TEXT,
      source_file       TEXT,
      target_file       TEXT
    );

    CREATE TABLE IF NOT EXISTS schemas (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL REFERENCES connections(id),
      role          TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      file          TEXT
    );

    CREATE TABLE IF NOT EXISTS fields (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      schema_id INTEGER NOT NULL REFERENCES schemas(id),
      name      TEXT    NOT NULL,
      type      TEXT    NOT NULL,
      required  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS map_versions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      label         TEXT,
      snapshot_path TEXT
    );

    CREATE TABLE IF NOT EXISTS repo_state (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id              INTEGER NOT NULL UNIQUE REFERENCES repos(id),
      last_scanned_commit  TEXT,
      last_scanned_at      TEXT
    );

    -- -----------------------------------------------------------------------
    -- FTS5 virtual tables (content tables — synced via triggers)
    -- -----------------------------------------------------------------------

    CREATE VIRTUAL TABLE IF NOT EXISTS connections_fts USING fts5(
      path, protocol, source_file, target_file,
      content='connections', content_rowid='id'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS services_fts USING fts5(
      name,
      content='services', content_rowid='id'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fields_fts USING fts5(
      name, type,
      content='fields', content_rowid='id'
    );

    -- -----------------------------------------------------------------------
    -- FTS5 triggers: services_fts
    -- -----------------------------------------------------------------------

    CREATE TRIGGER IF NOT EXISTS services_ai AFTER INSERT ON services BEGIN
      INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
    END;

    CREATE TRIGGER IF NOT EXISTS services_ad AFTER DELETE ON services BEGIN
      INSERT INTO services_fts(services_fts, rowid, name) VALUES ('delete', old.id, old.name);
    END;

    CREATE TRIGGER IF NOT EXISTS services_au AFTER UPDATE ON services BEGIN
      INSERT INTO services_fts(services_fts, rowid, name) VALUES ('delete', old.id, old.name);
      INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
    END;

    -- -----------------------------------------------------------------------
    -- FTS5 triggers: connections_fts
    -- -----------------------------------------------------------------------

    CREATE TRIGGER IF NOT EXISTS connections_ai AFTER INSERT ON connections BEGIN
      INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
        VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
    END;

    CREATE TRIGGER IF NOT EXISTS connections_ad AFTER DELETE ON connections BEGIN
      INSERT INTO connections_fts(connections_fts, rowid, path, protocol, source_file, target_file)
        VALUES ('delete', old.id, old.path, old.protocol, old.source_file, old.target_file);
    END;

    CREATE TRIGGER IF NOT EXISTS connections_au AFTER UPDATE ON connections BEGIN
      INSERT INTO connections_fts(connections_fts, rowid, path, protocol, source_file, target_file)
        VALUES ('delete', old.id, old.path, old.protocol, old.source_file, old.target_file);
      INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
        VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
    END;

    -- -----------------------------------------------------------------------
    -- FTS5 triggers: fields_fts
    -- -----------------------------------------------------------------------

    CREATE TRIGGER IF NOT EXISTS fields_ai AFTER INSERT ON fields BEGIN
      INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
    END;

    CREATE TRIGGER IF NOT EXISTS fields_ad AFTER DELETE ON fields BEGIN
      INSERT INTO fields_fts(fields_fts, rowid, name, type) VALUES ('delete', old.id, old.name, old.type);
    END;

    CREATE TRIGGER IF NOT EXISTS fields_au AFTER UPDATE ON fields BEGIN
      INSERT INTO fields_fts(fields_fts, rowid, name, type) VALUES ('delete', old.id, old.name, old.type);
      INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
    END;
  `);
}
