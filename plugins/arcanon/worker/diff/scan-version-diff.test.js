/**
 * Tests for the scan-version diff engine (, Task 2).
 *
 * Run: node --test plugins/arcanon/worker/diff/scan-version-diff.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import Database from "../db/sqlite-adapter.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  diffScanVersions,
  loadServices,
  loadConnections,
} from "./scan-version-diff.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function buildDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE repos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      last_commit TEXT,
      scanned_at  TEXT
    );

    CREATE TABLE scan_versions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id       INTEGER NOT NULL REFERENCES repos(id),
      started_at    TEXT NOT NULL,
      completed_at  TEXT,
      quality_score REAL
    );

    CREATE TABLE services (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id         INTEGER NOT NULL REFERENCES repos(id),
      name            TEXT    NOT NULL,
      root_path       TEXT    NOT NULL,
      language        TEXT    NOT NULL,
      type            TEXT    NOT NULL DEFAULT 'service',
      scan_version_id INTEGER REFERENCES scan_versions(id),
      owner           TEXT,
      auth_mechanism  TEXT,
      db_backend      TEXT,
      boundary_entry  TEXT,
      base_path       TEXT
    );

    CREATE TABLE connections (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      source_service_id INTEGER NOT NULL REFERENCES services(id),
      target_service_id INTEGER NOT NULL REFERENCES services(id),
      protocol          TEXT    NOT NULL,
      protocol_raw      TEXT,
      method            TEXT,
      path              TEXT,
      source_file       TEXT,
      target_file       TEXT,
      scan_version_id   INTEGER REFERENCES scan_versions(id),
      crossing          TEXT,
      confidence        TEXT,
      evidence          TEXT,
      path_template     TEXT
    );
  `);
  return db;
}

/**
 * Build a pre-019 DB whose connections table LACKS the protocol_raw column, to
 * exercise loadConnections' graceful-degradation fallback.
 */
function buildDbPre019() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL,
      name TEXT NOT NULL, type TEXT NOT NULL, last_commit TEXT, scanned_at TEXT
    );
    CREATE TABLE scan_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL REFERENCES repos(id),
      started_at TEXT NOT NULL, completed_at TEXT, quality_score REAL
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL REFERENCES repos(id),
      name TEXT NOT NULL, root_path TEXT NOT NULL, language TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'service', scan_version_id INTEGER REFERENCES scan_versions(id),
      owner TEXT, auth_mechanism TEXT, db_backend TEXT, boundary_entry TEXT, base_path TEXT
    );
    CREATE TABLE connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_service_id INTEGER NOT NULL REFERENCES services(id),
      target_service_id INTEGER NOT NULL REFERENCES services(id),
      protocol TEXT NOT NULL, method TEXT, path TEXT, source_file TEXT, target_file TEXT,
      scan_version_id INTEGER REFERENCES scan_versions(id),
      crossing TEXT, confidence TEXT, evidence TEXT, path_template TEXT
    );
  `);
  return db;
}

function seedRepo(db, name = "repo-a") {
  return db
    .prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, 'monorepo')")
    .run(`/tmp/${name}`, name).lastInsertRowid;
}

function seedScan(db, repoId, completedAt = "2026-04-20T10:00:00Z") {
  return db
    .prepare(
      "INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (?, ?, ?)"
    )
    .run(repoId, "2026-04-20T09:00:00Z", completedAt).lastInsertRowid;
}

function insertService(db, scanVersionId, repoId, name, fields = {}) {
  const row = {
    root_path: fields.root_path ?? `/svc/${name}`,
    language: fields.language ?? "javascript",
    type: fields.type ?? "service",
    owner: fields.owner ?? null,
    auth_mechanism: fields.auth_mechanism ?? null,
    db_backend: fields.db_backend ?? null,
    boundary_entry: fields.boundary_entry ?? null,
    base_path: fields.base_path ?? null,
  };
  return db
    .prepare(
      `INSERT INTO services
       (repo_id, name, root_path, language, type, scan_version_id,
        owner, auth_mechanism, db_backend, boundary_entry, base_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      repoId,
      name,
      row.root_path,
      row.language,
      row.type,
      scanVersionId,
      row.owner,
      row.auth_mechanism,
      row.db_backend,
      row.boundary_entry,
      row.base_path
    ).lastInsertRowid;
}

function insertConn(db, scanVersionId, srcId, tgtId, protocol, fields = {}) {
  const row = {
    protocol_raw: fields.protocol_raw ?? null,
    method: fields.method ?? null,
    path: fields.path ?? null,
    source_file: fields.source_file ?? null,
    target_file: fields.target_file ?? null,
    crossing: fields.crossing ?? null,
    confidence: fields.confidence ?? null,
    evidence: fields.evidence ?? null,
    path_template: fields.path_template ?? null,
  };
  return db
    .prepare(
      `INSERT INTO connections
       (source_service_id, target_service_id, protocol, protocol_raw, method, path,
        source_file, target_file, scan_version_id,
        crossing, confidence, evidence, path_template)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      srcId,
      tgtId,
      protocol,
      row.protocol_raw,
      row.method,
      row.path,
      row.source_file,
      row.target_file,
      scanVersionId,
      row.crossing,
      row.confidence,
      row.evidence,
      row.path_template
    ).lastInsertRowid;
}

/** Insert a connection into a pre-019 DB (no protocol_raw column). */
function insertConnPre019(db, scanVersionId, srcId, tgtId, protocol, fields = {}) {
  return db
    .prepare(
      `INSERT INTO connections
       (source_service_id, target_service_id, protocol, method, path,
        source_file, target_file, scan_version_id,
        crossing, confidence, evidence, path_template)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      srcId,
      tgtId,
      protocol,
      fields.method ?? null,
      fields.path ?? null,
      fields.source_file ?? null,
      fields.target_file ?? null,
      scanVersionId,
      fields.crossing ?? null,
      fields.confidence ?? null,
      fields.evidence ?? null,
      fields.path_template ?? null,
    ).lastInsertRowid;
}

describe("diffScanVersions — services", () => {
  test("test 1: services-added — B has one extra service", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    insertService(db, sA, repoId, "api");
    insertService(db, sA, repoId, "worker");
    insertService(db, sB, repoId, "api");
    insertService(db, sB, repoId, "worker");
    insertService(db, sB, repoId, "web");

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.services.added.length, 1);
    assert.equal(result.services.added[0].name, "web");
    assert.equal(result.services.removed.length, 0);
    assert.equal(result.services.modified.length, 0);
  });

  test("test 2: services-removed — A had 3, B has 2", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    insertService(db, sA, repoId, "api");
    insertService(db, sA, repoId, "worker");
    insertService(db, sA, repoId, "web");
    insertService(db, sB, repoId, "api");
    insertService(db, sB, repoId, "worker");

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.services.removed.length, 1);
    assert.equal(result.services.removed[0].name, "web");
  });

  test("test 3: services-modified — single field (owner) differs", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    insertService(db, sA, repoId, "api", { owner: "team-a" });
    insertService(db, sB, repoId, "api", { owner: "team-b" });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.services.modified.length, 1);
    const mod = result.services.modified[0];
    assert.equal(mod.name, "api");
    assert.equal(mod.changed_fields.length, 1);
    assert.equal(mod.changed_fields[0].field, "owner");
    assert.equal(mod.changed_fields[0].before, "team-a");
    assert.equal(mod.changed_fields[0].after, "team-b");
  });

  test("test 4: services-modified — multiple fields differ", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    insertService(db, sA, repoId, "api", {
      owner: "team-a",
      auth_mechanism: "jwt",
    });
    insertService(db, sB, repoId, "api", {
      owner: "team-b",
      auth_mechanism: "oauth2",
    });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.services.modified.length, 1);
    const fields = result.services.modified[0].changed_fields;
    assert.equal(fields.length, 2);
    const fieldNames = fields.map((f) => f.field).sort();
    assert.deepEqual(fieldNames, ["auth_mechanism", "owner"]);
  });

  test("test 5: services-modified — NULL → value reported as a change", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    insertService(db, sA, repoId, "api", { owner: null });
    insertService(db, sB, repoId, "api", { owner: "team-x" });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.services.modified.length, 1);
    const f = result.services.modified[0].changed_fields[0];
    assert.equal(f.field, "owner");
    assert.equal(f.before, null);
    assert.equal(f.after, "team-x");
  });

  test("test 6: services-unchanged are NOT in modified", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    insertService(db, sA, repoId, "api", { owner: "team-a" });
    insertService(db, sB, repoId, "api", { owner: "team-a" });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.services.modified.length, 0);
  });
});

describe("diffScanVersions — connections", () => {
  test("test 7: connections-added — B has one extra connection", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    const apiA = insertService(db, sA, repoId, "api");
    const dbA = insertService(db, sA, repoId, "db");
    const apiB = insertService(db, sB, repoId, "api");
    const dbB = insertService(db, sB, repoId, "db");
    const cacheB = insertService(db, sB, repoId, "cache");

    insertConn(db, sA, apiA, dbA, "http", { method: "GET", path: "/users" });
    insertConn(db, sA, apiA, dbA, "http", { method: "POST", path: "/users" });
    insertConn(db, sB, apiB, dbB, "http", { method: "GET", path: "/users" });
    insertConn(db, sB, apiB, dbB, "http", { method: "POST", path: "/users" });
    insertConn(db, sB, apiB, cacheB, "redis", { method: null, path: null });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.connections.added.length, 1);
    assert.equal(result.connections.added[0].target_name, "cache");
  });

  test("test 8: connections-removed — A had 3, B has 2", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    const apiA = insertService(db, sA, repoId, "api");
    const dbA = insertService(db, sA, repoId, "db");
    const cacheA = insertService(db, sA, repoId, "cache");
    const apiB = insertService(db, sB, repoId, "api");
    const dbB = insertService(db, sB, repoId, "db");

    insertConn(db, sA, apiA, dbA, "http", { method: "GET", path: "/users" });
    insertConn(db, sA, apiA, dbA, "http", { method: "POST", path: "/users" });
    insertConn(db, sA, apiA, cacheA, "redis");
    insertConn(db, sB, apiB, dbB, "http", { method: "GET", path: "/users" });
    insertConn(db, sB, apiB, dbB, "http", { method: "POST", path: "/users" });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.connections.removed.length, 1);
    assert.equal(result.connections.removed[0].target_name, "cache");
  });

  test("test 9: connections-modified — confidence high to low", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    const apiA = insertService(db, sA, repoId, "api");
    const dbA = insertService(db, sA, repoId, "db");
    const apiB = insertService(db, sB, repoId, "api");
    const dbB = insertService(db, sB, repoId, "db");

    insertConn(db, sA, apiA, dbA, "http", {
      method: "GET",
      path: "/users",
      confidence: "high",
    });
    insertConn(db, sB, apiB, dbB, "http", {
      method: "GET",
      path: "/users",
      confidence: "low",
    });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.connections.modified.length, 1);
    const mod = result.connections.modified[0];
    assert.equal(mod.changed_fields.length, 1);
    assert.equal(mod.changed_fields[0].field, "confidence");
    assert.equal(mod.changed_fields[0].before, "high");
    assert.equal(mod.changed_fields[0].after, "low");
  });

  test("test 10: cross-scan service re-IDs do not break diff (resolve via name)", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    // Inflate the autoincrement before scan B inserts to force re-IDs.
    // sqlite_sequence is auto-populated on first AUTOINCREMENT insert; we
    // then UPDATE seq to push the next id forward.
    const apiA = insertService(db, sA, repoId, "api");
    const dbA = insertService(db, sA, repoId, "db");
    db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = ?").run(
      98,
      "services"
    );
    const apiB = insertService(db, sB, repoId, "api");
    const dbB = insertService(db, sB, repoId, "db");

    assert.notEqual(apiA, apiB);
    assert.notEqual(dbA, dbB);

    insertConn(db, sA, apiA, dbA, "http", { method: "GET", path: "/users" });
    insertConn(db, sB, apiB, dbB, "http", { method: "GET", path: "/users" });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.connections.added.length, 0);
    assert.equal(result.connections.removed.length, 0);
    assert.equal(result.connections.modified.length, 0);
  });

  test("#42 no-churn: pre-phase raw kafka vs post-phase events/protocol_raw kafka keys identically", () => {
    // Scan A is a pre-phase scan: protocol stores the raw token, protocol_raw NULL.
    // Scan B is the first post-phase scan: protocol is the canonical bucket,
    // protocol_raw preserves the original token. The connectionKey must match so
    // the edge does NOT churn as removed+added.
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    const apiA = insertService(db, sA, repoId, "api");
    const brokerA = insertService(db, sA, repoId, "broker");
    const apiB = insertService(db, sB, repoId, "api");
    const brokerB = insertService(db, sB, repoId, "broker");

    // Pre-phase: protocol = raw "kafka", protocol_raw = NULL.
    insertConn(db, sA, apiA, brokerA, "kafka", {
      method: "produce",
      path: "orders.topic",
      protocol_raw: null,
    });
    // Post-phase: protocol = canonical "events", protocol_raw = "kafka".
    insertConn(db, sB, apiB, brokerB, "events", {
      method: "produce",
      path: "orders.topic",
      protocol_raw: "kafka",
    });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.connections.added.length, 0, "no spurious added edge");
    assert.equal(result.connections.removed.length, 0, "no spurious removed edge");
    // The protocol FIELD differs (kafka -> events), so it is reported as a
    // modification — but the EDGE IDENTITY is stable (not removed+added).
    assert.equal(result.connections.modified.length, 1);
    const mod = result.connections.modified[0];
    assert.ok(
      mod.changed_fields.some((f) => f.field === "protocol"),
      "protocol bucket change still surfaces as a field modification",
    );
  });

  test("#42 no-churn: two identical post-phase rows produce no diff", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    const apiA = insertService(db, sA, repoId, "api");
    const brokerA = insertService(db, sA, repoId, "broker");
    const apiB = insertService(db, sB, repoId, "api");
    const brokerB = insertService(db, sB, repoId, "broker");

    insertConn(db, sA, apiA, brokerA, "events", {
      method: "produce",
      path: "orders.topic",
      protocol_raw: "kafka",
    });
    insertConn(db, sB, apiB, brokerB, "events", {
      method: "produce",
      path: "orders.topic",
      protocol_raw: "kafka",
    });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.connections.added.length, 0);
    assert.equal(result.connections.removed.length, 0);
    assert.equal(result.connections.modified.length, 0);
  });

  test("#42 pre-019 DB: loadConnections degrades gracefully (keys on protocol)", () => {
    // A pre-019 DB lacks the protocol_raw column entirely. loadConnections must
    // fall back to a SELECT projecting protocol_raw NULL, and connectionKey then
    // keys on protocol — identical raw-kafka rows still diff as unchanged.
    const db = buildDbPre019();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    const apiA = insertService(db, sA, repoId, "api");
    const brokerA = insertService(db, sA, repoId, "broker");
    const apiB = insertService(db, sB, repoId, "api");
    const brokerB = insertService(db, sB, repoId, "broker");

    insertConnPre019(db, sA, apiA, brokerA, "kafka", {
      method: "produce",
      path: "orders.topic",
    });
    insertConnPre019(db, sB, apiB, brokerB, "kafka", {
      method: "produce",
      path: "orders.topic",
    });

    const rows = loadConnections(db, sA);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].protocol_raw, null, "pre-019 yields protocol_raw null");

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.connections.added.length, 0);
    assert.equal(result.connections.removed.length, 0);
    assert.equal(result.connections.modified.length, 0);
  });
});

describe("diffScanVersions — same_scan short-circuit", () => {
  test("test 11: same DB and same scan ID short-circuits with same_scan=true", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const s = seedScan(db, repoId);
    const apiId = insertService(db, s, repoId, "api");
    insertConn(db, s, apiId, apiId, "http");

    const result = diffScanVersions(db, db, s, s);
    assert.equal(result.same_scan, true);
    assert.deepEqual(result.services.added, []);
    assert.deepEqual(result.services.removed, []);
    assert.deepEqual(result.services.modified, []);
    assert.deepEqual(result.connections.added, []);
    assert.deepEqual(result.connections.removed, []);
    assert.deepEqual(result.connections.modified, []);
    assert.deepEqual(result.summary, {
      services: { added: 0, removed: 0, modified: 0 },
      connections: { added: 0, removed: 0, modified: 0 },
    });
  });

  test("test 12: different DBs with same scan ID does NOT short-circuit", () => {
    const dbA = buildDb();
    const dbB = buildDb();
    const repoIdA = seedRepo(dbA);
    const repoIdB = seedRepo(dbB);
    const sA = seedScan(dbA, repoIdA);
    const sB = seedScan(dbB, repoIdB);
    assert.equal(sA, sB, "sanity: both first scans are id=1");
    insertService(dbA, sA, repoIdA, "api");
    insertService(dbB, sB, repoIdB, "web");

    const result = diffScanVersions(dbA, dbB, sA, sB);
    assert.equal(result.same_scan, false);
    assert.equal(result.services.added.length, 1);
    assert.equal(result.services.added[0].name, "web");
    assert.equal(result.services.removed.length, 1);
    assert.equal(result.services.removed[0].name, "api");
  });

  test("test 13: cross-DB diff (Phase 119 readiness — load-bearing)", () => {
    // RESEARCH §8: this is the contract  (`/arcanon:diff --shadow`)
    // depends on. Engine takes two open Database handles; can be the SAME
    // handle ( same-DB case) or DIFFERENT handles ( shadow
    // vs live). Engine never reaches for a global pool.
    const dbA = buildDb();
    const dbB = buildDb();
    const repoIdA = seedRepo(dbA);
    const repoIdB = seedRepo(dbB);
    const sA = seedScan(dbA, repoIdA);
    const sB = seedScan(dbB, repoIdB);

    insertService(dbA, sA, repoIdA, "api", { owner: "team-live" });
    insertService(dbA, sA, repoIdA, "shared", { owner: "team-x" });
    insertService(dbB, sB, repoIdB, "api", { owner: "team-shadow" });
    insertService(dbB, sB, repoIdB, "shared", { owner: "team-x" });
    insertService(dbB, sB, repoIdB, "new-svc", { owner: "team-y" });

    const result = diffScanVersions(dbA, dbB, sA, sB);
    assert.equal(result.same_scan, false);
    assert.equal(result.services.added.length, 1);
    assert.equal(result.services.added[0].name, "new-svc");
    assert.equal(result.services.removed.length, 0);
    assert.equal(result.services.modified.length, 1);
    assert.equal(result.services.modified[0].name, "api");
    assert.equal(
      result.services.modified[0].changed_fields.find((f) => f.field === "owner")
        .after,
      "team-shadow"
    );
  });
});

describe("diffScanVersions — DB-handle hygiene", () => {
  test("test 14: engine never closes the DB handle (db.open === true post-diff)", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);
    insertService(db, sA, repoId, "api");
    insertService(db, sB, repoId, "api");

    diffScanVersions(db, db, sA, sB);
    assert.equal(db.open, true, "engine must not close the shared DB handle");
  });

  test("test 15: engine never writes (row counts unchanged pre/post diff)", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);
    const apiA = insertService(db, sA, repoId, "api", { owner: "team-a" });
    const dbsvcA = insertService(db, sA, repoId, "db");
    insertConn(db, sA, apiA, dbsvcA, "http", { method: "GET", path: "/users" });
    const apiB = insertService(db, sB, repoId, "api", { owner: "team-b" });
    const dbsvcB = insertService(db, sB, repoId, "db");
    insertConn(db, sB, apiB, dbsvcB, "http", { method: "GET", path: "/users" });

    const before = {
      services: db.prepare("SELECT COUNT(*) AS n FROM services").get().n,
      connections: db.prepare("SELECT COUNT(*) AS n FROM connections").get().n,
      scans: db.prepare("SELECT COUNT(*) AS n FROM scan_versions").get().n,
    };

    diffScanVersions(db, db, sA, sB);

    const after = {
      services: db.prepare("SELECT COUNT(*) AS n FROM services").get().n,
      connections: db.prepare("SELECT COUNT(*) AS n FROM connections").get().n,
      scans: db.prepare("SELECT COUNT(*) AS n FROM scan_versions").get().n,
    };
    assert.deepEqual(before, after, "row counts must not change post-diff");
  });
});

describe("diffScanVersions — summary + evidence", () => {
  test("test 16: summary counts match array lengths exactly", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    insertService(db, sA, repoId, "api");
    insertService(db, sA, repoId, "worker");
    insertService(db, sB, repoId, "api");
    insertService(db, sB, repoId, "worker");
    insertService(db, sB, repoId, "web");

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.summary.services.added, result.services.added.length);
    assert.equal(
      result.summary.services.removed,
      result.services.removed.length
    );
    assert.equal(
      result.summary.services.modified,
      result.services.modified.length
    );
    assert.equal(
      result.summary.connections.added,
      result.connections.added.length
    );
    assert.equal(
      result.summary.connections.removed,
      result.connections.removed.length
    );
    assert.equal(
      result.summary.connections.modified,
      result.connections.modified.length
    );
  });

  test("test 17: evidence field passes through untruncated (formatter's job)", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const sB = seedScan(db, repoId);

    const apiA = insertService(db, sA, repoId, "api");
    const dbsvcA = insertService(db, sA, repoId, "db");
    const apiB = insertService(db, sB, repoId, "api");
    const dbsvcB = insertService(db, sB, repoId, "db");

    const longA = "A".repeat(500);
    const longB = "B".repeat(500);
    insertConn(db, sA, apiA, dbsvcA, "http", {
      method: "GET",
      path: "/users",
      evidence: longA,
    });
    insertConn(db, sB, apiB, dbsvcB, "http", {
      method: "GET",
      path: "/users",
      evidence: longB,
    });

    const result = diffScanVersions(db, db, sA, sB);
    assert.equal(result.connections.modified.length, 1);
    const evField = result.connections.modified[0].changed_fields.find(
      (f) => f.field === "evidence"
    );
    assert.ok(evField, "evidence field must appear in changed_fields");
    assert.equal(evField.before.length, 500, "engine must NOT truncate before");
    assert.equal(evField.after.length, 500, "engine must NOT truncate after");
    assert.equal(evField.before, longA);
    assert.equal(evField.after, longB);
  });
});

describe("diffScanVersions — defensive (pool-agnosticism regression)", () => {
  test("test 18: engine module does not import from the pool", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "scan-version-diff.js"),
      "utf8"
    );
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(
      stripped,
      /\bgetQueryEngine\b|\bgetQueryEngineByHash\b|\bgetQueryEngineByRepo\b/,
      "engine must not reach for the QueryEngine pool"
    );
    assert.doesNotMatch(
      stripped,
      /\bopenDb\b/,
      "engine must not call openDb (caller owns DB lifecycle)"
    );
    assert.doesNotMatch(
      stripped,
      /\bprojectHashDir\b/,
      "engine must not resolve project paths (pool-agnostic)"
    );
  });
});

describe("loadServices / loadConnections", () => {
  test("loadServices returns all services for the scan with the projected fields", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    insertService(db, sA, repoId, "api", {
      owner: "team-a",
      auth_mechanism: "jwt",
    });

    const rows = loadServices(db, sA);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "api");
    assert.equal(rows[0].owner, "team-a");
    assert.equal(rows[0].auth_mechanism, "jwt");
    assert.equal(rows[0].repo_id, repoId);
  });

  test("loadConnections projects source_name / target_name via JOIN", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    const sA = seedScan(db, repoId);
    const apiId = insertService(db, sA, repoId, "api");
    const dbId = insertService(db, sA, repoId, "db");
    insertConn(db, sA, apiId, dbId, "http", { method: "GET", path: "/users" });

    const rows = loadConnections(db, sA);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_name, "api");
    assert.equal(rows[0].target_name, "db");
    assert.equal(rows[0].protocol, "http");
    assert.equal(rows[0].method, "GET");
    assert.equal(rows[0].path, "/users");
  });
});
