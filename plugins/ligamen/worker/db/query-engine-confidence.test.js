/**
 * Tests for confidence and evidence pipeline (Phase 70, Plan 01).
 *
 * Covers:
 *   - upsertConnection writes confidence + evidence to DB
 *   - upsertConnection with no confidence/evidence does not throw (nulls stored)
 *   - getGraph() returns confidence and evidence on each connection object
 *   - getGraph() on a pre-migration-009 DB (no confidence/evidence columns) does not throw
 *
 * Run: node --test plugins/ligamen/worker/db/query-engine-confidence.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Helper: build a fully-migrated in-memory DB (migrations 001-009 applied)
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
    CREATE TRIGGER connections_ai AFTER INSERT ON connections BEGIN
      INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
        VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
    END;
    CREATE TRIGGER fields_ai AFTER INSERT ON fields BEGIN
      INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
    END;
  `);
  db.exec("INSERT INTO schema_versions(version) VALUES(1);");

  // Migration 002 — service type column
  db.exec("ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'service';");
  db.exec("INSERT INTO schema_versions(version) VALUES(2);");

  // Migration 004 — dedup constraints
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

  // Migration 006 — UNIQUE(path) on repos
  const { up: up006 } = await import("./migrations/006_dedup_repos.js");
  db.transaction(() => {
    up006(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(6);
  })();

  // Migration 008 — crossing column on connections, actors table
  const { up: up008 } = await import("./migrations/008_actors_metadata.js");
  db.transaction(() => {
    up008(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(8);
  })();

  // Migration 009 — confidence + evidence columns on connections
  const { up: up009 } = await import("./migrations/009_confidence_enrichment.js");
  db.transaction(() => {
    up009(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(9);
  })();

  return db;
}

// ---------------------------------------------------------------------------
// Helper: build a legacy in-memory DB WITHOUT migration 009 columns
// (no confidence / evidence on connections — simulates pre-migration-009 DB)
// ---------------------------------------------------------------------------

async function buildDbLegacy() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

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
    CREATE TRIGGER connections_ai AFTER INSERT ON connections BEGIN
      INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
        VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
    END;
    CREATE TRIGGER fields_ai AFTER INSERT ON fields BEGIN
      INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
    END;
  `);
  db.exec("INSERT INTO schema_versions(version) VALUES(1);");

  db.exec("ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'service';");
  db.exec("INSERT INTO schema_versions(version) VALUES(2);");

  const { up: up004 } = await import("./migrations/004_dedup_constraints.js");
  db.transaction(() => {
    up004(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  })();

  const { up: up005 } = await import("./migrations/005_scan_versions.js");
  db.transaction(() => {
    up005(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(5);
  })();

  const { up: up006 } = await import("./migrations/006_dedup_repos.js");
  db.transaction(() => {
    up006(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(6);
  })();

  // Migration 008 adds crossing column — required for QueryEngine constructor
  const { up: up008 } = await import("./migrations/008_actors_metadata.js");
  db.transaction(() => {
    up008(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(8);
  })();

  // NOTE: Migration 009 intentionally NOT applied — simulates pre-009 DB

  return db;
}

// ---------------------------------------------------------------------------
// Shared helper: insert a repo + two services, return { repoId, srcId, tgtId }
// ---------------------------------------------------------------------------

function insertServicePair(db, repoPath) {
  const repoId = db
    .prepare("INSERT INTO repos(path, name, type) VALUES(?,?,?)")
    .run(repoPath, "test-repo", "monorepo").lastInsertRowid;

  const srcId = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language) VALUES(?,?,?,?)")
    .run(repoId, "svc-a", "/src/a", "javascript").lastInsertRowid;

  const tgtId = db
    .prepare("INSERT INTO services(repo_id, name, root_path, language) VALUES(?,?,?,?)")
    .run(repoId, "svc-b", "/src/b", "javascript").lastInsertRowid;

  return { repoId, srcId, tgtId };
}

// ---------------------------------------------------------------------------
// Test 1: upsertConnection with confidence + evidence writes values to DB
// ---------------------------------------------------------------------------

test("upsertConnection with confidence='high' and evidence stores values in DB", async (t) => {
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js");
  const qe = new QueryEngine(db);

  const { srcId, tgtId } = insertServicePair(db, "/repo/test1");

  qe.upsertConnection({
    source_service_id: srcId,
    target_service_id: tgtId,
    protocol: "http",
    confidence: "high",
    evidence: "fetch('/api')",
  });

  const row = db.prepare("SELECT confidence, evidence FROM connections LIMIT 1").get();
  assert.equal(row.confidence, "high", "confidence should be 'high'");
  assert.equal(row.evidence, "fetch('/api')", "evidence should match");
});

// ---------------------------------------------------------------------------
// Test 2: upsertConnection without confidence/evidence stores NULL (no throw)
// ---------------------------------------------------------------------------

test("upsertConnection without confidence/evidence stores NULL without throwing", async (t) => {
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js");
  const qe = new QueryEngine(db);

  const { srcId, tgtId } = insertServicePair(db, "/repo/test2");

  assert.doesNotThrow(() => {
    qe.upsertConnection({
      source_service_id: srcId,
      target_service_id: tgtId,
      protocol: "grpc",
    });
  });

  const row = db.prepare("SELECT confidence, evidence FROM connections LIMIT 1").get();
  assert.equal(row.confidence, null, "confidence should be NULL when not provided");
  assert.equal(row.evidence, null, "evidence should be NULL when not provided");
});

// ---------------------------------------------------------------------------
// Test 3: getGraph() returns confidence + evidence on connection objects
// ---------------------------------------------------------------------------

test("getGraph() returns confidence and evidence keys on each connection object", async (t) => {
  const db = await buildDb();
  const { QueryEngine } = await import("./query-engine.js");
  const qe = new QueryEngine(db);

  const { srcId, tgtId } = insertServicePair(db, "/repo/test3");

  qe.upsertConnection({
    source_service_id: srcId,
    target_service_id: tgtId,
    protocol: "http",
    confidence: "high",
    evidence: "fetch('/api')",
  });

  const graph = qe.getGraph();
  assert.ok(graph.connections.length > 0, "should have at least one connection");
  const conn = graph.connections[0];

  assert.ok("confidence" in conn, "connection should have confidence key");
  assert.ok("evidence" in conn, "connection should have evidence key");
  assert.equal(conn.confidence, "high", "confidence should be 'high'");
  assert.equal(conn.evidence, "fetch('/api')", "evidence should match");
});

// ---------------------------------------------------------------------------
// Test 4: getGraph() on pre-migration-009 DB does not throw
// ---------------------------------------------------------------------------

test("getGraph() on pre-migration-009 DB returns connections without throwing", async (t) => {
  const db = await buildDbLegacy();
  const { QueryEngine } = await import("./query-engine.js");
  const qe = new QueryEngine(db);

  const { srcId, tgtId } = insertServicePair(db, "/repo/legacy");

  // Insert a connection directly (no confidence/evidence columns exist)
  db.prepare(
    "INSERT INTO connections(source_service_id, target_service_id, protocol) VALUES(?,?,?)"
  ).run(srcId, tgtId, "http");

  let graph;
  assert.doesNotThrow(() => {
    graph = qe.getGraph();
  }, "getGraph() must not throw on pre-migration-009 DB");

  assert.ok(Array.isArray(graph.connections), "connections should be an array");
  assert.equal(graph.connections.length, 1, "should return the one connection row");
});
