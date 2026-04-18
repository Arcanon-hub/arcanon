/**
 * Tests for logger injection in QueryEngine._resolveServiceId().
 *
 * Run: node plugins/arcanon/worker/db/query-engine-logger.test.js
 */

import assert from "assert";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Helper: build a fully-migrated in-memory DB (mirrors query-engine-upsert.test.js)
// ---------------------------------------------------------------------------

async function buildDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Migration 001 -- initial schema
  db.exec(`
    CREATE TABLE schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE repos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      last_commit TEXT,
      scanned_at  TEXT
    );

    CREATE TABLE services (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id   INTEGER NOT NULL REFERENCES repos(id),
      name      TEXT    NOT NULL,
      root_path TEXT    NOT NULL,
      language  TEXT    NOT NULL
    );

    CREATE TABLE connections (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      source_service_id INTEGER NOT NULL REFERENCES services(id),
      target_service_id INTEGER NOT NULL REFERENCES services(id),
      protocol          TEXT    NOT NULL,
      method            TEXT,
      path              TEXT,
      source_file       TEXT,
      target_file       TEXT
    );

    CREATE TABLE schemas (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL REFERENCES connections(id),
      role          TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      file          TEXT
    );

    CREATE TABLE fields (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      schema_id INTEGER NOT NULL REFERENCES schemas(id),
      name      TEXT    NOT NULL,
      type      TEXT    NOT NULL,
      required  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE map_versions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      label         TEXT,
      snapshot_path TEXT
    );

    CREATE TABLE repo_state (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id              INTEGER NOT NULL UNIQUE REFERENCES repos(id),
      last_scanned_commit  TEXT,
      last_scanned_at      TEXT
    );

    CREATE VIRTUAL TABLE connections_fts USING fts5(
      path, protocol, source_file, target_file,
      content='connections', content_rowid='id'
    );

    CREATE VIRTUAL TABLE services_fts USING fts5(
      name,
      content='services', content_rowid='id'
    );

    CREATE VIRTUAL TABLE fields_fts USING fts5(
      name, type,
      content='fields', content_rowid='id'
    );

    CREATE TRIGGER services_ai AFTER INSERT ON services BEGIN
      INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
    END;
    CREATE TRIGGER services_ad AFTER DELETE ON services BEGIN
      INSERT INTO services_fts(services_fts, rowid, name) VALUES ('delete', old.id, old.name);
    END;
    CREATE TRIGGER services_au AFTER UPDATE ON services BEGIN
      INSERT INTO services_fts(services_fts, rowid, name) VALUES ('delete', old.id, old.name);
      INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
    END;

    CREATE TRIGGER connections_ai AFTER INSERT ON connections BEGIN
      INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
        VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
    END;
    CREATE TRIGGER connections_ad AFTER DELETE ON connections BEGIN
      INSERT INTO connections_fts(connections_fts, rowid, path, protocol, source_file, target_file)
        VALUES ('delete', old.id, old.path, old.protocol, old.source_file, old.target_file);
    END;
    CREATE TRIGGER connections_au AFTER UPDATE ON connections BEGIN
      INSERT INTO connections_fts(connections_fts, rowid, path, protocol, source_file, target_file)
        VALUES ('delete', old.id, old.path, old.protocol, old.source_file, old.target_file);
      INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
        VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
    END;

    CREATE TRIGGER fields_ai AFTER INSERT ON fields BEGIN
      INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
    END;
    CREATE TRIGGER fields_ad AFTER DELETE ON fields BEGIN
      INSERT INTO fields_fts(fields_fts, rowid, name, type) VALUES ('delete', old.id, old.name, old.type);
    END;
    CREATE TRIGGER fields_au AFTER UPDATE ON fields BEGIN
      INSERT INTO fields_fts(fields_fts, rowid, name, type) VALUES ('delete', old.id, old.name, old.type);
      INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
    END;
  `);
  db.exec(`INSERT INTO schema_versions(version) VALUES(1);`);

  // Migration 002
  db.exec(`ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'service';`);
  db.exec(`INSERT INTO schema_versions(version) VALUES(2);`);

  // Migration 003
  db.exec(`
    CREATE TABLE exposed_endpoints (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id),
      method     TEXT,
      path       TEXT NOT NULL,
      handler    TEXT,
      UNIQUE(service_id, method, path)
    );
  `);
  db.exec(`INSERT INTO schema_versions(version) VALUES(3);`);

  // Migrations 004-009 via actual migration modules
  const { up: up004 } = await import("./migrations/004_dedup_constraints.js");
  db.transaction(() => { up004(db); db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4); })();

  const { up: up005 } = await import("./migrations/005_scan_versions.js");
  db.transaction(() => { up005(db); db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(5); })();

  const { up: up006 } = await import("./migrations/006_dedup_repos.js");
  db.transaction(() => { up006(db); db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(6); })();

  const { up: up007 } = await import("./migrations/007_expose_kind.js");
  db.transaction(() => { up007(db); db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(7); })();

  const { up: up008 } = await import("./migrations/008_actors_metadata.js");
  db.transaction(() => { up008(db); db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(8); })();

  const { up: up009 } = await import("./migrations/009_confidence_enrichment.js");
  db.transaction(() => { up009(db); db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(9); })();

  return db;
}

// ---------------------------------------------------------------------------
// Helper: seed DB with two repos that share a service name (collision scenario)
// ---------------------------------------------------------------------------

function seedCollision(db) {
  const r1 = db.prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)").run("/repo-a", "repo-a", "service").lastInsertRowid;
  const r2 = db.prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)").run("/repo-b", "repo-b", "service").lastInsertRowid;
  db.prepare("INSERT INTO services(repo_id, name, root_path, language) VALUES(?,?,?,?)").run(r1, "my-service", "/repo-a/svc", "js");
  db.prepare("INSERT INTO services(repo_id, name, root_path, language) VALUES(?,?,?,?)").run(r2, "my-service", "/repo-b/svc", "js");
}

// ---------------------------------------------------------------------------
// Test A: With injected logger -- logger.warn is called, not console.warn
// ---------------------------------------------------------------------------
console.log("Test A: _resolveServiceId with injected logger calls logger.warn");
{
  const db = await buildDb();
  seedCollision(db);
  const { QueryEngine } = await import("./query-engine.js");

  const captured = [];
  const fakeLogger = { warn: (msg) => captured.push(msg) };
  const qe = new QueryEngine(db, fakeLogger);

  const id = qe._resolveServiceId("my-service");

  assert.strictEqual(captured.length, 1, "Expected logger.warn to be called exactly once");
  assert.ok(
    captured[0].includes("my-service"),
    `Expected warning message to include the service name "my-service", got: ${captured[0]}`
  );
  assert.ok(id !== null, "Expected a non-null id to be returned");
  console.log("  PASS -- logger.warn called once with message: " + captured[0].slice(0, 80));
}

// ---------------------------------------------------------------------------
// Test B: Without logger -- console.warn is called, no TypeError thrown
// ---------------------------------------------------------------------------
console.log("Test B: _resolveServiceId without logger falls back to console.warn (no TypeError)");
{
  const db = await buildDb();
  seedCollision(db);
  const { QueryEngine } = await import("./query-engine.js");

  const originalWarn = console.warn;
  const consoleCaptured = [];
  console.warn = (...args) => consoleCaptured.push(args.join(" "));

  let id;
  let threw = false;
  try {
    const qe = new QueryEngine(db);
    id = qe._resolveServiceId("my-service");
  } catch (err) {
    threw = true;
    console.error("Unexpected TypeError:", err.message);
  } finally {
    console.warn = originalWarn;
  }

  assert.strictEqual(threw, false, "Expected no TypeError when no logger is provided");
  assert.strictEqual(consoleCaptured.length, 1, "Expected console.warn to be called exactly once");
  assert.ok(
    consoleCaptured[0].includes("my-service"),
    `Expected console.warn message to include "my-service", got: ${consoleCaptured[0]}`
  );
  assert.ok(id !== null, "Expected a non-null id to be returned");
  console.log("  PASS -- console.warn called once, no TypeError. Message: " + consoleCaptured[0].slice(0, 80));
}

console.log("\nAll tests passed.");
