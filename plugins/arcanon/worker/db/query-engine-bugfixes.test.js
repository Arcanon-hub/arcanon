/**
 * Regression tests for two bugs reported by an external script author:
 *
 *   #8 — beginScan/endScan threw "Too few parameter values were provided"
 *        when callers passed undefined / non-integer ids (often because they
 *        used upsertRepo's {id} return as the id directly).
 *
 *   #9 — persistFindings dropped every connection whose target wasn't a
 *        known service, including those tagged crossing='external' that
 *        should have become actors. Net effect: external dependencies
 *        silently never made it into actor_connections.
 *
 * Schema setup mirrors query-engine-actors.test.js so we use the same
 * fully-migrated table shape (migrations 001-008) the production worker
 * builds. Migrations 004-008 are imported dynamically so the test stays
 * in lockstep with any future schema change.
 */

import test from "node:test";
import assert from "node:assert/strict";
import Database from "./sqlite-adapter.js";

import { QueryEngine } from "./query-engine.js";

async function buildTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Migration 001 — initial schema (hand-rolled to keep the test legible).
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
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id             INTEGER NOT NULL UNIQUE REFERENCES repos(id),
      last_scanned_commit TEXT,
      last_scanned_at     TEXT
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
  db.exec(`INSERT INTO schema_versions(version) VALUES(3);`);

  // Migrations 004-008 — load real implementations
  for (const v of ["004_dedup_constraints", "005_scan_versions", "006_dedup_repos", "007_expose_kind", "008_actors_metadata"]) {
    const { up } = await import(`./migrations/${v}.js`);
    db.transaction(() => {
      up(db);
      db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(parseInt(v.slice(0, 3), 10));
    })();
  }

  return db;
}

function seedRepo(db) {
  return db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run("/tmp/repo-" + Date.now() + "-" + Math.random(), "test-repo", "single").lastInsertRowid;
}

// #8 — beginScan / endScan type guards

test("beginScan throws TypeError with a clear message when repoId is undefined", async () => {
  const db = await buildTestDb();
  const qe = new QueryEngine(db);
  assert.throws(
    () => qe.beginScan(undefined),
    (err) => {
      assert.ok(err instanceof TypeError, `expected TypeError, got ${err.constructor.name}`);
      assert.match(err.message, /repoId must be an integer/);
      return true;
    },
  );
});

test("beginScan throws TypeError when repoId is an object (not an integer)", async () => {
  const db = await buildTestDb();
  const qe = new QueryEngine(db);
  assert.throws(
    () => qe.beginScan({ id: 7 }),
    (err) => err instanceof TypeError && /repoId must be an integer/.test(err.message),
  );
});

test("beginScan succeeds when given a real integer repoId", async () => {
  const db = await buildTestDb();
  const qe = new QueryEngine(db);
  const repoId = seedRepo(db);
  const scanVersionId = qe.beginScan(repoId);
  assert.equal(typeof scanVersionId, "number");
  assert.ok(scanVersionId > 0);
});

test("endScan throws TypeError when scanVersionId is undefined", async () => {
  const db = await buildTestDb();
  const qe = new QueryEngine(db);
  const repoId = seedRepo(db);
  assert.throws(
    () => qe.endScan(repoId, undefined),
    (err) => err instanceof TypeError && /scanVersionId must be an integer/.test(err.message),
  );
});

test("upsertRepo returns the integer row id (Option B — feeds beginScan directly)", async () => {
  const db = await buildTestDb();
  const qe = new QueryEngine(db);
  const repoId = qe.upsertRepo({ path: "/tmp/r", name: "r", type: "single" });
  assert.equal(typeof repoId, "number");
  assert.ok(Number.isInteger(repoId));
  assert.ok(repoId > 0);
  // The whole point of Option B — the round-trip works without .id ceremony.
  const scanVersionId = qe.beginScan(qe.upsertRepo({ path: "/tmp/r2", name: "r2", type: "single" }));
  assert.ok(Number.isInteger(scanVersionId));
});

// #9 — persistFindings creates an actor for external targets

test("persistFindings creates an actor + actor_connection for an external target NOT in services", async () => {
  const db = await buildTestDb();
  const qe = new QueryEngine(db);
  const repoId = seedRepo(db);

  qe.persistFindings(
    repoId,
    {
      services: [
        { name: "payment-api", root_path: ".", language: "typescript", type: "service" },
      ],
      connections: [
        {
          source: "payment-api",
          target: "stripe",
          protocol: "rest",
          method: "POST",
          path: "/v1/charges",
          crossing: "external",
        },
      ],
      schemas: [],
    },
    "abc",
  );

  const actor = db.prepare("SELECT * FROM actors WHERE name = ?").get("stripe");
  assert.ok(actor, "expected an actor row for the external target 'stripe'");
  assert.equal(actor.kind, "system");
  assert.equal(actor.direction, "outbound");

  const actorConn = db
    .prepare("SELECT * FROM actor_connections WHERE actor_id = ?")
    .get(actor.id);
  assert.ok(actorConn, "expected an actor_connection row linking source to actor");
  assert.equal(actorConn.protocol, "rest");
  assert.equal(actorConn.path, "/v1/charges");
  assert.equal(actorConn.direction, "outbound");

  const connRows = db.prepare("SELECT COUNT(*) AS n FROM connections").get().n;
  assert.equal(connRows, 0, "external-target findings must not insert into connections");
});

test("persistFindings still skips connections to unknown internal targets (crossing != external)", async () => {
  const db = await buildTestDb();
  const qe = new QueryEngine(db);
  const repoId = seedRepo(db);

  qe.persistFindings(
    repoId,
    {
      services: [
        { name: "payment-api", root_path: ".", language: "typescript", type: "service" },
      ],
      connections: [
        {
          source: "payment-api",
          target: "ghost-service",
          protocol: "rest",
        },
      ],
      schemas: [],
    },
    "abc",
  );

  const actorRows = db.prepare("SELECT COUNT(*) AS n FROM actors").get().n;
  const connRows = db.prepare("SELECT COUNT(*) AS n FROM connections").get().n;
  assert.equal(actorRows, 0, "should not invent an actor for non-external misses");
  assert.equal(connRows, 0, "should still skip the connection — no target row to point at");
});

test("persistFindings inserts a regular connection row when both source and target are known services (regression)", async () => {
  const db = await buildTestDb();
  const qe = new QueryEngine(db);
  const repoId = seedRepo(db);

  qe.persistFindings(
    repoId,
    {
      services: [
        { name: "api", root_path: ".", language: "ts", type: "service" },
        { name: "db-svc", root_path: ".", language: "go", type: "service" },
      ],
      connections: [{ source: "api", target: "db-svc", protocol: "grpc" }],
      schemas: [],
    },
    "abc",
  );

  const conn = db.prepare("SELECT * FROM connections").get();
  assert.ok(conn, "expected a normal connection row");
  assert.equal(conn.protocol, "grpc");
  const actorRows = db.prepare("SELECT COUNT(*) AS n FROM actors").get().n;
  assert.equal(actorRows, 0, "internal-internal connections should not create actors");
});
