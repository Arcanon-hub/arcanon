/**
 * Tests for migration 004 — UNIQUE(repo_id, name) constraint, dedup, FTS5 rebuild
 *
 * Run: node --input-type=module < worker/db/migration-004.test.js
 * Or:  node worker/db/migration-004.test.js
 */

import assert from "assert";
import Database from "better-sqlite3";

// Import the migration module under test
import { version, up } from "./migrations/004_dedup_constraints.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal DB (schema versions 1–3 applied inline)
// ---------------------------------------------------------------------------

function buildBaseDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // schema_versions table
  db.exec(`
    CREATE TABLE schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration 001 — initial schema
  db.exec(`
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

  // Migration 002 — type column
  db.exec(`ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'service';`);

  // Migration 003 — exposed_endpoints
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

  return db;
}

// ---------------------------------------------------------------------------
// Helper: seed db with 3 duplicate (repo_id, name) rows for one pair
// ---------------------------------------------------------------------------

function seedDuplicates(db) {
  // Insert a repo
  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/repo1", "repo1", "single").lastInsertRowid;

  // Insert 3 duplicates of (repoId, 'payment-service') — simulating re-scans
  // These are inserted with INCREASING ids so MAX(id) picks the last one
  const id1 = db
    .prepare(
      "INSERT INTO services(repo_id, name, root_path, language, type) VALUES(?,?,?,?,?)",
    )
    .run(repoId, "payment-service", "/tmp/repo1/pay", "node", "service")
    .lastInsertRowid;

  const id2 = db
    .prepare(
      "INSERT INTO services(repo_id, name, root_path, language, type) VALUES(?,?,?,?,?)",
    )
    .run(repoId, "payment-service", "/tmp/repo1/pay", "node", "service")
    .lastInsertRowid;

  const id3 = db
    .prepare(
      "INSERT INTO services(repo_id, name, root_path, language, type) VALUES(?,?,?,?,?)",
    )
    .run(repoId, "payment-service", "/tmp/repo1/pay", "node", "service")
    .lastInsertRowid;

  // Also insert a unique service for FTS5 check
  const uniqueId = db
    .prepare(
      "INSERT INTO services(repo_id, name, root_path, language, type) VALUES(?,?,?,?,?)",
    )
    .run(repoId, "auth-service", "/tmp/repo1/auth", "node", "service")
    .lastInsertRowid;

  // Insert a connection pointing to id1 (a duplicate that will be removed)
  const connId = db
    .prepare(
      "INSERT INTO connections(source_service_id, target_service_id, protocol) VALUES(?,?,?)",
    )
    .run(id1, uniqueId, "http").lastInsertRowid;

  return { repoId, id1, id2, id3, uniqueId, connId, survivingId: id3 };
}

// ---------------------------------------------------------------------------
// Test 1: version = 4
// ---------------------------------------------------------------------------
console.log("Test 1: version export = 4");
assert.strictEqual(version, 4, `Expected version 4, got ${version}`);
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 2: Migration runs without error against a DB with duplicate rows
// ---------------------------------------------------------------------------
console.log("Test 2: Migration runs without error on DB with duplicates");
{
  const db = buildBaseDb();
  const { repoId } = seedDuplicates(db);

  assert.doesNotThrow(() => {
    const runMigration = db.transaction(() => {
      up(db);
      db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
    });
    runMigration();
  }, "Migration should not throw");
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 3: After migration, exactly 1 row per (repo_id, name) pair
// ---------------------------------------------------------------------------
console.log("Test 3: Exactly 1 row survives per (repo_id, name) after migration");
{
  const db = buildBaseDb();
  const { repoId } = seedDuplicates(db);

  const runMigration = db.transaction(() => {
    up(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  });
  runMigration();

  const svcCount = db
    .prepare("SELECT COUNT(*) FROM services WHERE name = ?")
    .pluck()
    .get("payment-service");
  assert.strictEqual(svcCount, 1, `Expected 1 row, got ${svcCount}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 4: Surviving row is MAX(id) row
// ---------------------------------------------------------------------------
console.log("Test 4: Surviving row is the MAX(id) row (id3)");
{
  const db = buildBaseDb();
  const { survivingId } = seedDuplicates(db);

  const runMigration = db.transaction(() => {
    up(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  });
  runMigration();

  const row = db
    .prepare("SELECT id FROM services WHERE name = ?")
    .get("payment-service");
  assert.strictEqual(row.id, survivingId, `Expected id=${survivingId}, got id=${row.id}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 5: UNIQUE(repo_id, name) constraint enforced after migration
// ---------------------------------------------------------------------------
console.log("Test 5: UNIQUE(repo_id, name) enforced — second INSERT fails");
{
  const db = buildBaseDb();
  const { repoId } = seedDuplicates(db);

  const runMigration = db.transaction(() => {
    up(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  });
  runMigration();

  assert.throws(() => {
    db.prepare(
      "INSERT INTO services(repo_id, name, root_path, language, type) VALUES(?,?,?,?,?)",
    ).run(repoId, "payment-service", "/tmp/x", "node", "service");
  }, /UNIQUE constraint failed/, "Should throw SQLITE_CONSTRAINT on duplicate insert");
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 6: canonical_name column exists and is nullable
// ---------------------------------------------------------------------------
console.log("Test 6: canonical_name column exists (TEXT, nullable)");
{
  const db = buildBaseDb();
  seedDuplicates(db);

  const runMigration = db.transaction(() => {
    up(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  });
  runMigration();

  const cols = db.prepare("PRAGMA table_info(services)").all();
  const canonCol = cols.find((c) => c.name === "canonical_name");
  assert.ok(canonCol, "canonical_name column should exist");
  assert.ok(!canonCol.notnull, "canonical_name should be nullable");
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 7: FTS5 returns service name after migration
// ---------------------------------------------------------------------------
console.log("Test 7: services_fts MATCH finds service name after migration");
{
  const db = buildBaseDb();
  seedDuplicates(db);

  const runMigration = db.transaction(() => {
    up(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  });
  runMigration();

  const hits = db
    .prepare("SELECT name FROM services_fts WHERE services_fts MATCH ?")
    .pluck()
    .all('"payment"');
  assert.ok(hits.includes("payment-service"), "FTS5 should find 'payment-service' after migration");
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 8: Connections re-pointed — no orphan FK references
// ---------------------------------------------------------------------------
console.log("Test 8: Connections re-pointed to surviving service id");
{
  const db = buildBaseDb();
  const { id1, survivingId, connId } = seedDuplicates(db);
  // connId points FROM id1 (a duplicate) — should be re-pointed to survivingId

  const runMigration = db.transaction(() => {
    up(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  });
  runMigration();

  const conn = db.prepare("SELECT source_service_id FROM connections WHERE id = ?").get(connId);
  assert.strictEqual(
    conn.source_service_id,
    survivingId,
    `Connection source_service_id should be ${survivingId} (surviving id), got ${conn.source_service_id}`,
  );
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 9: No orphan FK references in connections after migration
// ---------------------------------------------------------------------------
console.log("Test 9: All connection FKs reference existing service rows");
{
  const db = buildBaseDb();
  seedDuplicates(db);

  const runMigration = db.transaction(() => {
    up(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  });
  runMigration();

  // Check FK integrity
  const integrity = db.pragma("foreign_key_check(connections)");
  assert.strictEqual(integrity.length, 0, `Expected 0 FK violations, got ${integrity.length}`);
  db.close();
}
console.log("  PASS");

console.log("\nAll migration-004 tests PASS");
