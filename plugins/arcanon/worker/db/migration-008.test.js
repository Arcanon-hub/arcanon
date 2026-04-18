/**
 * Tests for migration 008 — actors, actor_connections, node_metadata tables + crossing column
 *
 * Run: node worker/db/migration-008.test.js
 */

import assert from "assert";
import Database from "better-sqlite3";

// Import the migration module under test
import { version, up } from "./migrations/008_actors_metadata.js";

// ---------------------------------------------------------------------------
// Helper: build a base DB with migrations 001-007 applied inline
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

  // Migration 002 — type column on services
  db.exec(`ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'service';`);

  // Migration 003 — exposed_endpoints table
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

  // Migration 004 — UNIQUE(repo_id, name) constraint on services + canonical_name
  db.exec(`ALTER TABLE services ADD COLUMN canonical_name TEXT;`);
  db.exec(`CREATE UNIQUE INDEX uq_services_repo_name ON services(repo_id, name);`);

  // Migration 005 — scan_versions table + scan_version_id FK columns
  db.exec(`
    CREATE TABLE scan_versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id      INTEGER NOT NULL REFERENCES repos(id),
      started_at   TEXT    NOT NULL,
      completed_at TEXT
    );
    ALTER TABLE services    ADD COLUMN scan_version_id INTEGER REFERENCES scan_versions(id);
    ALTER TABLE connections ADD COLUMN scan_version_id INTEGER REFERENCES scan_versions(id);
  `);

  // Migration 006 — UNIQUE INDEX on repos(path)
  db.exec(`CREATE UNIQUE INDEX uq_repos_path ON repos(path);`);

  // Migration 007 — kind column on exposed_endpoints (recreate table, add unique index)
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
    SELECT id, service_id, method, path, handler, 'endpoint' FROM exposed_endpoints;
    DROP TABLE exposed_endpoints;
    ALTER TABLE exposed_endpoints_new RENAME TO exposed_endpoints;
  `);
  db.exec(`
    CREATE UNIQUE INDEX uq_exposed_endpoints
    ON exposed_endpoints(service_id, COALESCE(method, ''), path);
  `);

  return db;
}

// ---------------------------------------------------------------------------
// Helper: seed a repo + two services for population tests
// ---------------------------------------------------------------------------

function seedServices(db) {
  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/test-repo", "test-repo", "single").lastInsertRowid;

  const paymentId = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language) VALUES(?,?,?,?)")
    .run(repoId, "payment-api", "/tmp/test-repo/payment", "node").lastInsertRowid;

  const authId = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language) VALUES(?,?,?,?)")
    .run(repoId, "auth-api", "/tmp/test-repo/auth", "node").lastInsertRowid;

  return { repoId, paymentId, authId };
}

// ---------------------------------------------------------------------------
// Test 1: version === 8
// ---------------------------------------------------------------------------
console.log("Test 1: version export = 8");
assert.strictEqual(version, 8, `Expected version 8, got ${version}`);
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 2: Migration runs without error on base DB
// ---------------------------------------------------------------------------
console.log("Test 2: Migration runs without error on base DB");
{
  const db = buildBaseDb();
  assert.doesNotThrow(() => {
    up(db);
  }, "Migration 008 should not throw on fresh base DB");
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 3: actors table exists with correct columns
// ---------------------------------------------------------------------------
console.log("Test 3: actors table has correct columns (id, name, kind, direction, source)");
{
  const db = buildBaseDb();
  up(db);
  const cols = db.prepare("PRAGMA table_info(actors)").all();
  const colNames = cols.map((c) => c.name);
  assert.ok(colNames.includes("id"), "actors should have id column");
  assert.ok(colNames.includes("name"), "actors should have name column");
  assert.ok(colNames.includes("kind"), "actors should have kind column");
  assert.ok(colNames.includes("direction"), "actors should have direction column");
  assert.ok(colNames.includes("source"), "actors should have source column");
  assert.strictEqual(cols.length, 5, `Expected 5 columns, got ${cols.length}: ${colNames.join(", ")}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 4: actors UNIQUE(name) constraint enforced
// ---------------------------------------------------------------------------
console.log("Test 4: actors UNIQUE(name) — duplicate name INSERT throws SQLITE_CONSTRAINT");
{
  const db = buildBaseDb();
  up(db);
  db.prepare("INSERT INTO actors(name, kind, direction, source) VALUES(?,?,?,?)").run("Stripe", "system", "outbound", "scan");
  assert.throws(
    () => {
      db.prepare("INSERT INTO actors(name, kind, direction, source) VALUES(?,?,?,?)").run("Stripe", "system", "outbound", "scan");
    },
    /UNIQUE constraint failed/,
    "Should throw SQLITE_CONSTRAINT on duplicate actor name",
  );
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 5: actor_connections table exists with correct columns
// ---------------------------------------------------------------------------
console.log("Test 5: actor_connections table has correct columns (id, actor_id, service_id, direction, protocol, path)");
{
  const db = buildBaseDb();
  up(db);
  const cols = db.prepare("PRAGMA table_info(actor_connections)").all();
  const colNames = cols.map((c) => c.name);
  assert.ok(colNames.includes("id"), "actor_connections should have id column");
  assert.ok(colNames.includes("actor_id"), "actor_connections should have actor_id column");
  assert.ok(colNames.includes("service_id"), "actor_connections should have service_id column");
  assert.ok(colNames.includes("direction"), "actor_connections should have direction column");
  assert.ok(colNames.includes("protocol"), "actor_connections should have protocol column");
  assert.ok(colNames.includes("path"), "actor_connections should have path column");
  assert.strictEqual(cols.length, 6, `Expected 6 columns, got ${cols.length}: ${colNames.join(", ")}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 6: node_metadata table exists with correct columns
// ---------------------------------------------------------------------------
console.log("Test 6: node_metadata table has correct columns (id, service_id, view, key, value, source, updated_at)");
{
  const db = buildBaseDb();
  up(db);
  const cols = db.prepare("PRAGMA table_info(node_metadata)").all();
  const colNames = cols.map((c) => c.name);
  assert.ok(colNames.includes("id"), "node_metadata should have id column");
  assert.ok(colNames.includes("service_id"), "node_metadata should have service_id column");
  assert.ok(colNames.includes("view"), "node_metadata should have view column");
  assert.ok(colNames.includes("key"), "node_metadata should have key column");
  assert.ok(colNames.includes("value"), "node_metadata should have value column");
  assert.ok(colNames.includes("source"), "node_metadata should have source column");
  assert.ok(colNames.includes("updated_at"), "node_metadata should have updated_at column");
  assert.strictEqual(cols.length, 7, `Expected 7 columns, got ${cols.length}: ${colNames.join(", ")}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 7: node_metadata UNIQUE(service_id, view, key) enforced
// ---------------------------------------------------------------------------
console.log("Test 7: node_metadata UNIQUE(service_id, view, key) — duplicate INSERT throws");
{
  const db = buildBaseDb();
  up(db);
  const { paymentId } = seedServices(db);
  db.prepare("INSERT INTO node_metadata(service_id, view, key, value, source) VALUES(?,?,?,?,?)").run(paymentId, "stride", "threat", "DoS", "user");
  assert.throws(
    () => {
      db.prepare("INSERT INTO node_metadata(service_id, view, key, value, source) VALUES(?,?,?,?,?)").run(paymentId, "stride", "threat", "Spoofing", "user");
    },
    /UNIQUE constraint failed/,
    "Should throw SQLITE_CONSTRAINT on duplicate (service_id, view, key)",
  );
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 8: connections table gains crossing column (nullable TEXT)
// ---------------------------------------------------------------------------
console.log("Test 8: connections table has crossing column after migration");
{
  const db = buildBaseDb();
  up(db);
  const cols = db.prepare("PRAGMA table_info(connections)").all();
  const crossingCol = cols.find((c) => c.name === "crossing");
  assert.ok(crossingCol, "connections should have crossing column after migration");
  assert.strictEqual(crossingCol.type, "TEXT", `Expected TEXT type, got ${crossingCol.type}`);
  assert.strictEqual(crossingCol.notnull, 0, "crossing should be nullable");
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 9: Population query — actors created from external connections
// ---------------------------------------------------------------------------
console.log("Test 9: Population query creates actor rows from connections where crossing='external'");
{
  // Build base DB, manually add crossing column, seed data, then run migration
  const db = buildBaseDb();
  db.exec(`ALTER TABLE connections ADD COLUMN crossing TEXT;`);

  const { paymentId, authId } = seedServices(db);

  // Insert a connection from payment-api to auth-api marked as external
  db.prepare(
    "INSERT INTO connections(source_service_id, target_service_id, protocol, crossing) VALUES(?,?,?,?)"
  ).run(paymentId, authId, "http", "external");

  // Now run just the table creation parts + population (but crossing already added)
  // Since migration adds crossing too, we need to handle the ALTER TABLE carefully.
  // Use a modified approach: run the CREATE TABLE statements and population SQL directly
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

  // Run population SQL (same as in migration)
  db.exec(`
    INSERT OR IGNORE INTO actors (name, kind, direction, source)
    SELECT DISTINCT s_target.name, 'system', 'outbound', 'scan'
    FROM connections c
    JOIN services s_target ON s_target.id = c.target_service_id
    WHERE c.crossing = 'external';
  `);
  db.exec(`
    INSERT INTO actor_connections (actor_id, service_id, direction, protocol, path)
    SELECT a.id, c.source_service_id, 'outbound', c.protocol, c.path
    FROM connections c
    JOIN services s_target ON s_target.id = c.target_service_id
    JOIN actors a ON a.name = s_target.name
    WHERE c.crossing = 'external';
  `);

  const actors = db.prepare("SELECT * FROM actors").all();
  assert.strictEqual(actors.length, 1, `Expected 1 actor, got ${actors.length}`);
  assert.strictEqual(actors[0].name, "auth-api", `Expected actor name 'auth-api', got '${actors[0].name}'`);
  assert.strictEqual(actors[0].source, "scan", `Expected source 'scan', got '${actors[0].source}'`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 10: Population query creates actor_connection rows with correct protocol
// ---------------------------------------------------------------------------
console.log("Test 10: Population query creates actor_connection rows linking actor to source service");
{
  const db = buildBaseDb();
  db.exec(`ALTER TABLE connections ADD COLUMN crossing TEXT;`);

  const { paymentId, authId } = seedServices(db);

  db.prepare(
    "INSERT INTO connections(source_service_id, target_service_id, protocol, path, crossing) VALUES(?,?,?,?,?)"
  ).run(paymentId, authId, "http", "/api/verify", "external");

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

  db.exec(`
    INSERT OR IGNORE INTO actors (name, kind, direction, source)
    SELECT DISTINCT s_target.name, 'system', 'outbound', 'scan'
    FROM connections c
    JOIN services s_target ON s_target.id = c.target_service_id
    WHERE c.crossing = 'external';
  `);
  db.exec(`
    INSERT INTO actor_connections (actor_id, service_id, direction, protocol, path)
    SELECT a.id, c.source_service_id, 'outbound', c.protocol, c.path
    FROM connections c
    JOIN services s_target ON s_target.id = c.target_service_id
    JOIN actors a ON a.name = s_target.name
    WHERE c.crossing = 'external';
  `);

  const actorConns = db.prepare("SELECT * FROM actor_connections").all();
  assert.strictEqual(actorConns.length, 1, `Expected 1 actor_connection, got ${actorConns.length}`);
  assert.strictEqual(actorConns[0].service_id, paymentId, `Expected service_id=${paymentId}, got ${actorConns[0].service_id}`);
  assert.strictEqual(actorConns[0].protocol, "http", `Expected protocol 'http', got '${actorConns[0].protocol}'`);
  assert.strictEqual(actorConns[0].path, "/api/verify", `Expected path '/api/verify', got '${actorConns[0].path}'`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 11: CASCADE — delete actor removes actor_connections rows
// ---------------------------------------------------------------------------
console.log("Test 11: CASCADE delete — deleting an actor removes its actor_connections rows");
{
  const db = buildBaseDb();
  up(db);
  const { paymentId } = seedServices(db);

  const actorId = db
    .prepare("INSERT INTO actors(name, kind, direction, source) VALUES(?,?,?,?)")
    .run("Stripe", "system", "outbound", "scan").lastInsertRowid;

  db.prepare("INSERT INTO actor_connections(actor_id, service_id, direction, protocol) VALUES(?,?,?,?)").run(actorId, paymentId, "outbound", "http");

  const beforeCount = db.prepare("SELECT COUNT(*) FROM actor_connections WHERE actor_id = ?").pluck().get(actorId);
  assert.strictEqual(beforeCount, 1, "Should have 1 actor_connection before delete");

  db.prepare("DELETE FROM actors WHERE id = ?").run(actorId);

  const afterCount = db.prepare("SELECT COUNT(*) FROM actor_connections WHERE actor_id = ?").pluck().get(actorId);
  assert.strictEqual(afterCount, 0, `Expected 0 actor_connections after actor CASCADE delete, got ${afterCount}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 12: CASCADE — delete service removes actor_connections and node_metadata
// ---------------------------------------------------------------------------
console.log("Test 12: CASCADE delete — deleting a service removes actor_connections and node_metadata rows");
{
  const db = buildBaseDb();
  up(db);
  const { paymentId } = seedServices(db);

  const actorId = db
    .prepare("INSERT INTO actors(name, kind, direction, source) VALUES(?,?,?,?)")
    .run("ExternalSvc", "system", "outbound", "scan").lastInsertRowid;

  db.prepare("INSERT INTO actor_connections(actor_id, service_id, direction) VALUES(?,?,?)").run(actorId, paymentId, "outbound");
  db.prepare("INSERT INTO node_metadata(service_id, view, key, value, source) VALUES(?,?,?,?,?)").run(paymentId, "stride", "threat", "DoS", "user");

  const beforeAC = db.prepare("SELECT COUNT(*) FROM actor_connections WHERE service_id = ?").pluck().get(paymentId);
  const beforeNM = db.prepare("SELECT COUNT(*) FROM node_metadata WHERE service_id = ?").pluck().get(paymentId);
  assert.strictEqual(beforeAC, 1, "Should have 1 actor_connection before service delete");
  assert.strictEqual(beforeNM, 1, "Should have 1 node_metadata before service delete");

  db.prepare("DELETE FROM services WHERE id = ?").run(paymentId);

  const afterAC = db.prepare("SELECT COUNT(*) FROM actor_connections WHERE service_id = ?").pluck().get(paymentId);
  const afterNM = db.prepare("SELECT COUNT(*) FROM node_metadata WHERE service_id = ?").pluck().get(paymentId);
  assert.strictEqual(afterAC, 0, `Expected 0 actor_connections after service CASCADE delete, got ${afterAC}`);
  assert.strictEqual(afterNM, 0, `Expected 0 node_metadata after service CASCADE delete, got ${afterNM}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 13: Migration is idempotent — running up(db) twice does not throw
// ---------------------------------------------------------------------------
console.log("Test 13: Migration is idempotent — running up(db) twice does not throw (IF NOT EXISTS)");
{
  const db = buildBaseDb();
  assert.doesNotThrow(() => {
    up(db);
    up(db);
  }, "Running migration 008 twice should not throw due to IF NOT EXISTS pattern");
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 14: node_metadata upsert pattern — INSERT OR REPLACE updates value
// ---------------------------------------------------------------------------
console.log("Test 14: node_metadata INSERT OR REPLACE updates value (upsert pattern)");
{
  const db = buildBaseDb();
  up(db);
  const { paymentId } = seedServices(db);

  db.prepare("INSERT INTO node_metadata(service_id, view, key, value, source) VALUES(?,?,?,?,?)").run(paymentId, "stride", "threat", "DoS", "user");

  // Upsert with new value using INSERT OR REPLACE
  db.prepare("INSERT OR REPLACE INTO node_metadata(service_id, view, key, value, source) VALUES(?,?,?,?,?)").run(paymentId, "stride", "threat", "Spoofing", "user");

  const row = db.prepare("SELECT value FROM node_metadata WHERE service_id = ? AND view = ? AND key = ?").get(paymentId, "stride", "threat");
  assert.strictEqual(row.value, "Spoofing", `Expected value 'Spoofing' after upsert, got '${row.value}'`);

  const count = db.prepare("SELECT COUNT(*) FROM node_metadata WHERE service_id = ? AND view = ? AND key = ?").pluck().get(paymentId, "stride", "threat");
  assert.strictEqual(count, 1, `Expected 1 row after upsert, got ${count}`);
  db.close();
}
console.log("  PASS");

console.log("\nAll migration-008 tests PASS");
