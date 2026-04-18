/**
 * Tests for Task 2: QueryEngine upsertService ON CONFLICT DO UPDATE rewrite
 * and getGraph() MAX(id) workaround removal.
 *
 * Run: node worker/db/query-engine-upsert.test.js
 */

import assert from "assert";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Helper: build a fully-migrated DB (migrations 001-004 applied)
// ---------------------------------------------------------------------------

async function buildDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Migration 001 — initial schema
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

  // Migration 004 — apply via the actual migration module
  const { up: up004 } = await import("./migrations/004_dedup_constraints.js");
  db.transaction(() => {
    up004(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  })();

  // Migration 005 — scan_versions table + scan_version_id FK columns
  const { up: up005 } = await import("./migrations/005_scan_versions.js");
  db.transaction(() => {
    up005(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(5);
  })();

  // Migration 006 — UNIQUE(path) on repos (required for ON CONFLICT(path) in QueryEngine)
  const { up: up006 } = await import("./migrations/006_dedup_repos.js");
  db.transaction(() => {
    up006(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(6);
  })();

  return db;
}

// ---------------------------------------------------------------------------
// Helper: build a DB with scan_versions support (alias of buildDb — migrations
// 001-006 already included above, which adds the scan_versions table)
// ---------------------------------------------------------------------------

async function buildDbWithScanVersions() {
  return buildDb();
}

// ---------------------------------------------------------------------------
// Test 1: upsertService — upserting same (repo_id, name) twice produces 1 row
// ---------------------------------------------------------------------------
console.log("Test 1: upsertService — two upserts with same (repo_id, name) produce 1 row");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js");
  const qe = new QueryEngine(db);

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/r1", "repo1", "single").lastInsertRowid;

  qe.upsertService({ repo_id: repoId, name: "svc-a", root_path: "/tmp", language: "node" });
  qe.upsertService({ repo_id: repoId, name: "svc-a", root_path: "/tmp", language: "node" });

  const count = db.prepare("SELECT COUNT(*) FROM services WHERE name = ?").pluck().get("svc-a");
  assert.strictEqual(count, 1, `Expected 1 row, got ${count}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 2: upsertService — both calls return the same id (id preserved)
// ---------------------------------------------------------------------------
console.log("Test 2: upsertService — both calls return the same row id");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js");
  const qe = new QueryEngine(db);

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/r2", "repo2", "single").lastInsertRowid;

  const id1 = qe.upsertService({ repo_id: repoId, name: "svc-b", root_path: "/tmp", language: "go" });
  const id2 = qe.upsertService({ repo_id: repoId, name: "svc-b", root_path: "/tmp", language: "go" });

  assert.strictEqual(id1, id2, `Expected same id (${id1}), got ${id2}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 3: upsertService — child connections survive re-upsert (no cascade-delete)
// ---------------------------------------------------------------------------
console.log("Test 3: upsertService — connections referencing service id survive re-upsert");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js");
  const qe = new QueryEngine(db);

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/r3", "repo3", "single").lastInsertRowid;

  const srcId = qe.upsertService({ repo_id: repoId, name: "svc-src", root_path: "/tmp", language: "java" });
  const tgtId = qe.upsertService({ repo_id: repoId, name: "svc-tgt", root_path: "/tmp", language: "java" });

  const connId = qe.upsertConnection({
    source_service_id: srcId,
    target_service_id: tgtId,
    protocol: "http",
  });

  // Re-upsert svc-src — should NOT delete the connection
  const newSrcId = qe.upsertService({ repo_id: repoId, name: "svc-src", root_path: "/tmp/updated", language: "java" });

  assert.strictEqual(srcId, newSrcId, "id must be preserved across re-upsert");

  const conn = db.prepare("SELECT id, source_service_id FROM connections WHERE id = ?").get(connId);
  assert.ok(conn, "Connection should still exist after re-upsert");
  assert.strictEqual(conn.source_service_id, srcId, "Connection still points to correct service id");
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 4: getGraph() — no MAX(id) GROUP BY filter in SQL source
// (We test behavioral contract: all services are returned)
// ---------------------------------------------------------------------------
console.log("Test 4: getGraph() returns all services (no MAX(id) workaround filter)");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js");
  const qe = new QueryEngine(db);

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/r4", "repo4", "single").lastInsertRowid;

  const id1 = qe.upsertService({ repo_id: repoId, name: "svc-1", root_path: "/tmp", language: "python" });
  const id2 = qe.upsertService({ repo_id: repoId, name: "svc-2", root_path: "/tmp", language: "python" });
  const id3 = qe.upsertService({ repo_id: repoId, name: "svc-3", root_path: "/tmp", language: "python" });

  const { services } = qe.getGraph();
  const ids = services.map((s) => s.id);
  assert.ok(ids.includes(id1), `getGraph should return svc-1 (id=${id1})`);
  assert.ok(ids.includes(id2), `getGraph should return svc-2 (id=${id2})`);
  assert.ok(ids.includes(id3), `getGraph should return svc-3 (id=${id3})`);
  assert.strictEqual(services.length, 3, `Expected 3 services, got ${services.length}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 5: No INSERT OR REPLACE remains for services upsert (source-level check)
// ---------------------------------------------------------------------------
console.log("Test 5: query-engine.js has no INSERT OR REPLACE for services (ON CONFLICT used instead)");
{
  const { readFileSync } = await import("fs");
  const { fileURLToPath } = await import("url");
  const { dirname, join } = await import("path");
  const __dir = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(__dir, "query-engine.js"), "utf8");

  // Must contain ON CONFLICT(repo_id, name) DO UPDATE
  assert.ok(
    src.includes("ON CONFLICT(repo_id, name) DO UPDATE"),
    "query-engine.js must use ON CONFLICT(repo_id, name) DO UPDATE for services upsert",
  );

  // Must NOT contain INSERT OR REPLACE for services
  assert.ok(
    !src.includes("INSERT OR REPLACE INTO services"),
    "query-engine.js must NOT use INSERT OR REPLACE INTO services",
  );

  // Must NOT contain the MAX(id) GROUP BY workaround
  assert.ok(
    !src.includes("SELECT MAX(id) FROM services GROUP BY name"),
    "query-engine.js must NOT contain MAX(id) GROUP BY name workaround in getGraph()",
  );
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test 6: upsertRepo returns correct id on both insert and update (ON CONFLICT)
// Regression: lastInsertRowid is 0 when ON CONFLICT triggers an UPDATE,
// which caused beginScan(0) to fail with FOREIGN KEY constraint.
// ---------------------------------------------------------------------------
console.log("Test 6: upsertRepo returns correct id on insert AND update");
{
  const db = await buildDbWithScanVersions();
  const { QueryEngine } = await import("./query-engine.js?v=T6");
  const qe = new QueryEngine(db);

  // First call — insert
  const first = qe.upsertRepo({ path: "/tmp/test-repo-6", name: "repo-6", type: "single" });
  assert.ok(first.id > 0, `upsertRepo insert must return id > 0, got ${first.id}`);

  // Second call — same path, triggers ON CONFLICT UPDATE
  const second = qe.upsertRepo({ path: "/tmp/test-repo-6", name: "repo-6-renamed", type: "single" });
  assert.strictEqual(second.id, first.id, `upsertRepo update must return same id (${first.id}), got ${second.id}`);

  // Verify beginScan works with the returned id
  const scanId = qe.beginScan(second.id);
  assert.ok(scanId > 0, `beginScan must succeed with upsertRepo id, got scanId ${scanId}`);

  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test A: endScan() removes a service with scan_version_id IS NULL for the scanned repo
// ---------------------------------------------------------------------------
console.log("Test A: endScan() removes legacy NULL scan_version_id service for the scanned repo");
{
  const db = await buildDbWithScanVersions();
  const { QueryEngine } = await import("./query-engine.js?v=A");
  const qe = new QueryEngine(db);

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rA", "repoA", "single").lastInsertRowid;

  // Insert a legacy service row with scan_version_id = NULL
  db.prepare("INSERT INTO services(repo_id, name, root_path, language, type, scan_version_id) VALUES (?,?,?,?,?,?)")
    .run(repoId, "legacy-svc", "/tmp", "node", "service", null);

  // Verify the NULL row exists before endScan
  const beforeCount = db
    .prepare("SELECT COUNT(*) FROM services WHERE repo_id = ? AND scan_version_id IS NULL")
    .pluck()
    .get(repoId);
  assert.strictEqual(beforeCount, 1, `Expected 1 NULL row before endScan, got ${beforeCount}`);

  // Run a scan bracket
  const scanId = qe.beginScan(repoId);
  qe.endScan(repoId, scanId);

  // NULL row should be gone
  const afterCount = db
    .prepare("SELECT COUNT(*) FROM services WHERE repo_id = ? AND scan_version_id IS NULL")
    .pluck()
    .get(repoId);
  assert.strictEqual(afterCount, 0, `Expected 0 NULL rows after endScan, got ${afterCount}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test B: endScan() removes a connection referencing NULL-versioned services
// ---------------------------------------------------------------------------
console.log("Test B: endScan() removes connections referencing NULL scan_version_id services");
{
  const db = await buildDbWithScanVersions();
  const { QueryEngine } = await import("./query-engine.js?v=B");
  const qe = new QueryEngine(db);

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rB", "repoB", "single").lastInsertRowid;

  // Insert two legacy services with scan_version_id = NULL
  const svc1Id = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language, type, scan_version_id) VALUES (?,?,?,?,?,?)")
    .run(repoId, "legacy-src", "/tmp", "node", "service", null).lastInsertRowid;
  const svc2Id = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language, type, scan_version_id) VALUES (?,?,?,?,?,?)")
    .run(repoId, "legacy-tgt", "/tmp", "go", "service", null).lastInsertRowid;

  // Insert a legacy connection between them
  db.prepare("INSERT INTO connections(source_service_id, target_service_id, protocol, scan_version_id) VALUES (?,?,?,?)")
    .run(svc1Id, svc2Id, "http", null);

  // Run a scan bracket
  const scanId = qe.beginScan(repoId);
  qe.endScan(repoId, scanId);

  // Connection should be deleted (connections first, FK order)
  const connCount = db.prepare("SELECT COUNT(*) FROM connections").pluck().get();
  assert.strictEqual(connCount, 0, `Expected 0 connections after endScan, got ${connCount}`);

  // NULL services should also be deleted
  const svcNullCount = db
    .prepare("SELECT COUNT(*) FROM services WHERE scan_version_id IS NULL")
    .pluck()
    .get();
  assert.strictEqual(svcNullCount, 0, `Expected 0 NULL services after endScan, got ${svcNullCount}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test B2: endScan() removes schemas referencing NULL-versioned connections
// Regression: schemas with FK to null-versioned connections caused
// SQLITE_CONSTRAINT_FOREIGNKEY when endScan deleted the connections first.
// ---------------------------------------------------------------------------
console.log("Test B2: endScan() removes schemas on NULL-versioned connections without FK error");
{
  const db = await buildDbWithScanVersions();
  const { QueryEngine } = await import("./query-engine.js?v=B2");
  const qe = new QueryEngine(db);

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rB2", "repoB2", "single").lastInsertRowid;

  // Insert two legacy services with scan_version_id = NULL
  const svc1Id = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language, type, scan_version_id) VALUES (?,?,?,?,?,?)")
    .run(repoId, "legacy-src", "/tmp", "node", "service", null).lastInsertRowid;
  const svc2Id = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language, type, scan_version_id) VALUES (?,?,?,?,?,?)")
    .run(repoId, "legacy-tgt", "/tmp", "go", "service", null).lastInsertRowid;

  // Insert a legacy connection between them
  const connId = db
    .prepare("INSERT INTO connections(source_service_id, target_service_id, protocol, scan_version_id) VALUES (?,?,?,?)")
    .run(svc1Id, svc2Id, "http", null).lastInsertRowid;

  // Insert schemas referencing the legacy connection (this is the trigger for the bug)
  db.prepare("INSERT INTO schemas(connection_id, role, name, file) VALUES (?,?,?,?)")
    .run(connId, "request", "TestSchema", "test.js");
  db.prepare("INSERT INTO schemas(connection_id, role, name, file) VALUES (?,?,?,?)")
    .run(connId, "response", "TestResponse", "test.js");

  // This must NOT throw SQLITE_CONSTRAINT_FOREIGNKEY
  const scanId = qe.beginScan(repoId);
  qe.endScan(repoId, scanId);

  const connCount = db.prepare("SELECT COUNT(*) FROM connections").pluck().get();
  assert.strictEqual(connCount, 0, `Expected 0 connections after endScan, got ${connCount}`);

  const schemaCount = db.prepare("SELECT COUNT(*) FROM schemas").pluck().get();
  assert.strictEqual(schemaCount, 0, `Expected 0 schemas after endScan, got ${schemaCount}`);

  const svcNullCount = db
    .prepare("SELECT COUNT(*) FROM services WHERE scan_version_id IS NULL")
    .pluck()
    .get();
  assert.strictEqual(svcNullCount, 0, `Expected 0 NULL services after endScan, got ${svcNullCount}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test C: endScan() on repo A does NOT delete NULL rows for repo B
// ---------------------------------------------------------------------------
console.log("Test C: endScan() on repo A does not delete NULL rows for repo B");
{
  const db = await buildDbWithScanVersions();
  const { QueryEngine } = await import("./query-engine.js?v=C");
  const qe = new QueryEngine(db);

  const repoAId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rC-A", "repoC-A", "single").lastInsertRowid;
  const repoBId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rC-B", "repoC-B", "single").lastInsertRowid;

  // Insert a legacy service with scan_version_id = NULL for repo B
  db.prepare("INSERT INTO services(repo_id, name, root_path, language, type, scan_version_id) VALUES (?,?,?,?,?,?)")
    .run(repoBId, "legacy-svc-b", "/tmp", "python", "service", null);

  // Run a scan bracket on repo A only
  const scanId = qe.beginScan(repoAId);
  qe.endScan(repoAId, scanId);

  // Repo B's NULL row should be untouched
  const repoBNullCount = db
    .prepare("SELECT COUNT(*) FROM services WHERE repo_id = ? AND scan_version_id IS NULL")
    .pluck()
    .get(repoBId);
  assert.strictEqual(repoBNullCount, 1, `Expected 1 NULL row for repo B to survive, got ${repoBNullCount}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test D: cross-repo: same-repo service preferred over foreign service with same name
// ---------------------------------------------------------------------------
console.log("Test D: cross-repo: same-repo service preferred over foreign service with same name");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js?v=D");
  const qe = new QueryEngine(db);

  const repoAId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rA-d", "repoA-D", "single").lastInsertRowid;
  const repoBId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rB-d", "repoB-D", "single").lastInsertRowid;

  // Insert "api-gateway" in repo B first (so it gets a lower id)
  const idB = qe.upsertService({ repo_id: repoBId, name: "api-gateway", root_path: "/tmp", language: "node" });
  // Insert "api-gateway" in repo A
  const idA = qe.upsertService({ repo_id: repoAId, name: "api-gateway", root_path: "/tmp", language: "node" });

  // Resolving with repoId=repoA should return idA, not idB
  const resolved = qe._resolveServiceId("api-gateway", repoAId);
  assert.strictEqual(resolved, idA, `Expected idA (${idA}), got ${resolved}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test E: cross-repo: unique foreign service name resolves without warning
// ---------------------------------------------------------------------------
console.log("Test E: cross-repo: unique foreign service name resolves without warning");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js?v=E");
  const qe = new QueryEngine(db);

  const repoAId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rA2-e", "repoA2-E", "single").lastInsertRowid;
  const repoBId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rB2-e", "repoB2-E", "single").lastInsertRowid;

  // Insert "shared-lib" only in repo B
  const idShared = qe.upsertService({ repo_id: repoBId, name: "shared-lib", root_path: "/tmp", language: "go" });

  // Stub console.warn
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a);

  // Resolving "shared-lib" from repoA's perspective — no same-repo match, only one global match
  const resolved = qe._resolveServiceId("shared-lib", repoAId);

  console.warn = origWarn;

  assert.strictEqual(resolved, idShared, `Expected idShared (${idShared}), got ${resolved}`);
  assert.strictEqual(warns.length, 0, `Expected no warnings, got ${warns.length}`);
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test F: cross-repo: ambiguous name across repos emits console.warn
// ---------------------------------------------------------------------------
console.log("Test F: cross-repo: ambiguous name across repos emits console.warn");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js?v=F");
  const qe = new QueryEngine(db);

  const repoAId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rA3-f", "repoA3-F", "single").lastInsertRowid;
  const repoBId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rB3-f", "repoB3-F", "single").lastInsertRowid;

  // Insert "collision-svc" in both repos
  qe.upsertService({ repo_id: repoAId, name: "collision-svc", root_path: "/tmp", language: "node" });
  qe.upsertService({ repo_id: repoBId, name: "collision-svc", root_path: "/tmp", language: "go" });

  // Stub console.warn
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a);

  // Call with no repoId (old call path / unknown context) — hits two rows globally
  qe._resolveServiceId("collision-svc", null);

  console.warn = origWarn;

  assert.strictEqual(warns.length, 1, `Expected 1 warning, got ${warns.length}`);
  assert.ok(
    warns[0][0].includes("Ambiguous service name"),
    `Expected warning to contain "Ambiguous service name", got: ${warns[0][0]}`
  );
  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test G: upsertNodeMetadata — insert, update, no scan_versions side-effect
// ---------------------------------------------------------------------------
console.log("Test G: upsertNodeMetadata — insert/update/no-scan-bracket");
{
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js?v=G");

  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/rG", "repoG", "single").lastInsertRowid;

  // Ensure node_metadata table exists in the in-memory db (migration 008 schema)
  const nm_ddl = `
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
  `;
  db.exec(nm_ddl);

  // Re-instantiate QueryEngine so _stmtUpsertNodeMetadata is prepared against updated schema
  const qeNm = new QueryEngine(db);

  const svcId = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language, type) VALUES(?,?,?,?,?)")
    .run(repoId, "svc-nm", "/tmp", "node", "service").lastInsertRowid;

  // Insert
  const nmRowId = qeNm.upsertNodeMetadata(svcId, "ownership", "owner", "@team-platform");
  assert.ok(typeof nmRowId === "number" && nmRowId > 0, "upsertNodeMetadata returns rowId on insert");

  // Read back
  const nmRow = db.prepare("SELECT value FROM node_metadata WHERE service_id = ? AND view = ? AND key = ?")
    .get(svcId, "ownership", "owner");
  assert.strictEqual(nmRow.value, "@team-platform", "node_metadata value written correctly");

  // ON CONFLICT DO UPDATE
  qeNm.upsertNodeMetadata(svcId, "ownership", "owner", "@team-security");
  const nmUpdated = db.prepare("SELECT value FROM node_metadata WHERE service_id = ? AND view = ? AND key = ?")
    .get(svcId, "ownership", "owner");
  assert.strictEqual(nmUpdated.value, "@team-security", "upsertNodeMetadata updates existing value");

  // Only one row (no duplicate)
  const nmCount = db.prepare("SELECT COUNT(*) FROM node_metadata WHERE service_id = ? AND view = ? AND key = ?")
    .pluck()
    .get(svcId, "ownership", "owner");
  assert.strictEqual(nmCount, 1, "upsertNodeMetadata does not create duplicate rows");

  // No scan bracket created
  const scanCount = db.prepare("SELECT COUNT(*) FROM scan_versions").pluck().get();
  assert.strictEqual(scanCount, 0, "upsertNodeMetadata does not create scan_versions rows");

  db.close();
}
console.log("  PASS");

// ---------------------------------------------------------------------------
// Test H: upsertNodeMetadata on pre-migration-008 db returns null, no throw
// ---------------------------------------------------------------------------
console.log("Test H: upsertNodeMetadata on pre-migration-008 db (no node_metadata) returns null");
{
  // Use buildDb() which includes migrations 001-006 but NOT migration 008 (no node_metadata)
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js?v=H");
  // Constructor must NOT throw even without node_metadata table
  const qe = new QueryEngine(db);

  const repoId = db.prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)").run("/tmp/rH", "repoH", "single").lastInsertRowid;
  const svcId = qe.upsertService({ repo_id: repoId, name: "svc-h", root_path: "/tmp", language: "node" });

  // Method returns null when node_metadata table is absent
  const result = qe.upsertNodeMetadata(svcId, "ownership", "owner", "@team");
  assert.strictEqual(result, null, "upsertNodeMetadata returns null when node_metadata absent");

  db.close();
}
console.log("  PASS");

console.log("\nAll query-engine upsert rewrite tests PASS");
