/**
 * worker/db/query-engine-graph.test.js
 * Tests for getGraph() extended response: schemas_by_connection, enrichment fields.
 * Run: node --test db/query-engine-graph.test.js
 */
import assert from "assert";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { QueryEngine } from "./query-engine.js";

// ---------------------------------------------------------------------------
// Helper: build a fully-migrated in-memory DB (migrations 001-009)
// ---------------------------------------------------------------------------

async function buildTestDb({ withMigration009 = true } = {}) {
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

  // Migration 002 — services.type column
  db.exec(`ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'service';`);
  db.exec(`INSERT INTO schema_versions(version) VALUES(2);`);

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
  db.exec(`INSERT INTO schema_versions(version) VALUES(3);`);

  // Migration 004 — dedup constraints
  const { up: up004 } = await import("./migrations/004_dedup_constraints.js");
  db.transaction(() => {
    up004(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  })();

  // Migration 005 — scan_versions
  const { up: up005 } = await import("./migrations/005_scan_versions.js");
  db.transaction(() => {
    up005(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(5);
  })();

  // Migration 006 — dedup repos
  const { up: up006 } = await import("./migrations/006_dedup_repos.js");
  db.transaction(() => {
    up006(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(6);
  })();

  // Migration 007 — expose kind
  const { up: up007 } = await import("./migrations/007_expose_kind.js");
  db.transaction(() => {
    up007(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(7);
  })();

  // Migration 008 — actors, actor_connections, node_metadata, crossing column
  const { up: up008 } = await import("./migrations/008_actors_metadata.js");
  db.transaction(() => {
    up008(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(8);
  })();

  if (withMigration009) {
    // Migration 009 — confidence and evidence columns on connections
    const { up: up009 } = await import("./migrations/009_confidence_enrichment.js");
    db.transaction(() => {
      up009(db);
      db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(9);
    })();
  }

  return db;
}

// ---------------------------------------------------------------------------
// Helper: seed basic repo + two services + one connection
// Returns { repoId, svcAId, svcBId, connId }
// ---------------------------------------------------------------------------
function seedBasic(db) {
  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/test-graph-" + Date.now(), "graph-repo", "single").lastInsertRowid;

  const svcAId = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language, type) VALUES(?,?,?,?,?)")
    .run(repoId, "api-service", ".", "typescript", "service").lastInsertRowid;

  const svcBId = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language, type) VALUES(?,?,?,?,?)")
    .run(repoId, "worker-service", ".", "python", "service").lastInsertRowid;

  const connId = db
    .prepare("INSERT INTO connections(source_service_id, target_service_id, protocol, method, path) VALUES(?,?,?,?,?)")
    .run(svcAId, svcBId, "rest", "GET", "/jobs").lastInsertRowid;

  return { repoId, svcAId, svcBId, connId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getGraph() extended response", () => {
  test("Test 1: schemas_by_connection is keyed by connection_id string when schemas exist", async () => {
    const db = await buildTestDb();
    const { connId } = seedBasic(db);

    const schemaId = db
      .prepare("INSERT INTO schemas(connection_id, role, name, file) VALUES(?,?,?,?)")
      .run(connId, "request", "JobRequest", "job.schema.json").lastInsertRowid;

    db.prepare("INSERT INTO fields(schema_id, name, type, required) VALUES(?,?,?,?)")
      .run(schemaId, "job_id", "string", 1);

    const qe = new QueryEngine(db);
    const graph = qe.getGraph();

    assert.ok(
      graph.schemas_by_connection !== null && graph.schemas_by_connection !== undefined,
      "schemas_by_connection should exist in graph response"
    );
    assert.strictEqual(typeof graph.schemas_by_connection, "object", "schemas_by_connection should be an object");

    const key = String(connId);
    assert.ok(
      Array.isArray(graph.schemas_by_connection[key]),
      `schemas_by_connection["${key}"] should be an array`
    );
    assert.strictEqual(
      graph.schemas_by_connection[key].length,
      1,
      "should have 1 schema for this connection"
    );

    db.close();
  });

  test("Test 2: schemas_by_connection contains schema objects with name, role, file, and fields array", async () => {
    const db = await buildTestDb();
    const { connId } = seedBasic(db);

    const schemaId = db
      .prepare("INSERT INTO schemas(connection_id, role, name, file) VALUES(?,?,?,?)")
      .run(connId, "request", "JobRequest", "job.schema.json").lastInsertRowid;

    db.prepare("INSERT INTO fields(schema_id, name, type, required) VALUES(?,?,?,?)")
      .run(schemaId, "job_id", "string", 1);
    db.prepare("INSERT INTO fields(schema_id, name, type, required) VALUES(?,?,?,?)")
      .run(schemaId, "priority", "number", 0);

    const qe = new QueryEngine(db);
    const graph = qe.getGraph();

    const key = String(connId);
    const schema = graph.schemas_by_connection[key][0];

    assert.strictEqual(schema.name, "JobRequest", "schema name should match");
    assert.strictEqual(schema.role, "request", "schema role should match");
    assert.strictEqual(schema.file, "job.schema.json", "schema file should match");
    assert.ok(Array.isArray(schema.fields), "schema.fields should be an array");
    assert.strictEqual(schema.fields.length, 2, "should have 2 fields");

    const f = schema.fields.find((x) => x.name === "job_id");
    assert.ok(f, "job_id field should exist");
    assert.strictEqual(f.type, "string", "field type should match");
    assert.strictEqual(f.required, true, "required should be boolean true");

    db.close();
  });

  test("Test 3: getGraph() returns owner on service when node_metadata row exists", async () => {
    const db = await buildTestDb();
    const { svcAId } = seedBasic(db);

    db.prepare(
      "INSERT INTO node_metadata(service_id, view, key, value, source, updated_at) VALUES(?,?,?,?,?,?)"
    ).run(svcAId, "ownership", "owner", "team-alpha", "scan", new Date().toISOString());

    const qe = new QueryEngine(db);
    const graph = qe.getGraph();

    const svc = graph.services.find((s) => s.id === svcAId);
    assert.ok(svc, "api-service should exist in graph");
    assert.strictEqual(svc.owner, "team-alpha", "owner should be 'team-alpha'");
    assert.strictEqual(svc.auth_mechanism, null, "auth_mechanism should be null (not set)");
    assert.strictEqual(svc.db_backend, null, "db_backend should be null (not set)");

    db.close();
  });

  test("Test 4: getGraph() on a DB without confidence/evidence columns returns null for those fields (no throw)", async () => {
    const db = await buildTestDb({ withMigration009: false });
    seedBasic(db);

    const qe = new QueryEngine(db);

    let graph;
    assert.doesNotThrow(() => {
      graph = qe.getGraph();
    }, "getGraph() should not throw on pre-migration-009 DB");

    assert.ok(Array.isArray(graph.connections), "connections should be an array");
    if (graph.connections.length > 0) {
      assert.strictEqual(graph.connections[0].confidence, null, "confidence should be null on pre-migration-009 DB");
      assert.strictEqual(graph.connections[0].evidence, null, "evidence should be null on pre-migration-009 DB");
    }

    db.close();
  });

  test("Test 5: getGraph() returns confidence value on connection when column exists", async () => {
    const db = await buildTestDb({ withMigration009: true });
    const { connId } = seedBasic(db);

    db.prepare("UPDATE connections SET confidence = ?, evidence = ? WHERE id = ?")
      .run("high", "found in source code", connId);

    const qe = new QueryEngine(db);
    const graph = qe.getGraph();

    const conn = graph.connections.find((c) => c.id === connId);
    assert.ok(conn, "connection should exist in graph");
    assert.strictEqual(conn.confidence, "high", "confidence should be 'high'");
    assert.strictEqual(conn.evidence, "found in source code", "evidence should match");

    db.close();
  });

  test("Test 6: stale schema rows are deleted when their connection is removed by endScan", async () => {
    const db = await buildTestDb();
    const qe = new QueryEngine(db);

    const repoId = db
      .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
      .run("/tmp/test-stale-" + Date.now(), "stale-repo", "single").lastInsertRowid;

    // First scan: svc-a calls svc-b
    const sv1 = qe.beginScan(repoId);
    qe.persistFindings(
      repoId,
      {
        services: [
          { name: "svc-a", root_path: ".", language: "typescript", type: "service" },
          { name: "svc-b", root_path: ".", language: "python", type: "service" },
        ],
        connections: [
          {
            source: "svc-a",
            target: "svc-b",
            protocol: "rest",
            method: "POST",
            path: "/data",
            source_file: null,
            target_file: null,
            confidence: "high",
            evidence: "test",
          },
        ],
        schemas: [],
      },
      "commit-1",
      sv1
    );

    // Manually attach a schema to the connection created in scan 1
    const conn1 = db.prepare("SELECT id FROM connections").get();
    assert.ok(conn1, "connection from scan 1 should exist");

    const schemaId = db
      .prepare("INSERT INTO schemas(connection_id, role, name, file) VALUES(?,?,?,?)")
      .run(conn1.id, "request", "DataRequest", "data.schema.json").lastInsertRowid;
    db.prepare("INSERT INTO fields(schema_id, name, type, required) VALUES(?,?,?,?)")
      .run(schemaId, "payload", "string", 1);

    const schemaBefore = db.prepare("SELECT COUNT(*) AS cnt FROM schemas").get().cnt;
    assert.strictEqual(schemaBefore, 1, "should have 1 schema before endScan");

    qe.endScan(repoId, sv1);

    // Second scan: svc-a no longer calls svc-b (connection removed)
    const sv2 = qe.beginScan(repoId);
    qe.persistFindings(
      repoId,
      {
        services: [
          { name: "svc-a", root_path: ".", language: "typescript", type: "service" },
        ],
        connections: [],
        schemas: [],
      },
      "commit-2",
      sv2
    );
    qe.endScan(repoId, sv2);

    const schemaAfter = db.prepare("SELECT COUNT(*) AS cnt FROM schemas").get().cnt;
    assert.strictEqual(schemaAfter, 0, "schemas should be cleaned up after stale connection removed");

    const fieldAfter = db.prepare("SELECT COUNT(*) AS cnt FROM fields").get().cnt;
    assert.strictEqual(fieldAfter, 0, "fields should be cleaned up after stale schema removed");

    db.close();
  });
});
