/**
 * tests/storage/scan-version-bracket.test.js
 *
 * Tests for migration 005 (scan_versions table + scan_version_id FK columns)
 * and QueryEngine beginScan/endScan/persistFindings(scanVersionId) methods.
 *
 * Runs migrations 001 + 002 + 004 + 005 only (003 not needed for this plan's scope).
 * Uses Node.js built-in test runner (node:test).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

import { QueryEngine } from "../../worker/db/query-engine.js";

import * as migration001 from "../../worker/db/migrations/001_initial_schema.js";
import * as migration002 from "../../worker/db/migrations/002_service_type.js";
import * as migration004 from "../../worker/db/migrations/004_dedup_constraints.js";
import * as migration005 from "../../worker/db/migrations/005_scan_versions.js";

/**
 * Create a fresh isolated DB with migrations 001 + 002 + 004 + 005 applied.
 * Returns { db, qe }.
 */
function makeQE() {
  const dir = path.join(os.tmpdir(), "allclear-svb-" + crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "test.db");

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Run migrations in order, each wrapped in a transaction
  for (const m of [migration001, migration002, migration004, migration005]) {
    db.transaction(() => {
      m.up(db);
      db.prepare("INSERT INTO schema_versions (version) VALUES (?)").run(m.version);
    })();
  }

  const qe = new QueryEngine(db);
  return { db, qe };
}

/** Helper: insert a repo row directly and return its id */
function insertRepo(db, name = "test-repo") {
  const result = db
    .prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, 'single')")
    .run("/repos/" + name, name);
  return result.lastInsertRowid;
}

// ---------------------------------------------------------------------------
// 1. Migration 005 schema assertions
// ---------------------------------------------------------------------------
describe("migration 005 — schema", () => {
  it("scan_versions table exists after migrations", () => {
    const { db } = makeQE();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .pluck()
      .all();
    assert.ok(tables.includes("scan_versions"), "scan_versions table should exist");
    db.close();
  });

  it("services table has scan_version_id column", () => {
    const { db } = makeQE();
    const cols = db.prepare("PRAGMA table_info(services)").all();
    const colNames = cols.map((c) => c.name);
    assert.ok(
      colNames.includes("scan_version_id"),
      "services should have scan_version_id column"
    );
    db.close();
  });

  it("connections table has scan_version_id column", () => {
    const { db } = makeQE();
    const cols = db.prepare("PRAGMA table_info(connections)").all();
    const colNames = cols.map((c) => c.name);
    assert.ok(
      colNames.includes("scan_version_id"),
      "connections should have scan_version_id column"
    );
    db.close();
  });

  it("scan_version_id column on services is nullable (no NOT NULL)", () => {
    const { db } = makeQE();
    const col = db
      .prepare("PRAGMA table_info(services)")
      .all()
      .find((c) => c.name === "scan_version_id");
    assert.ok(col, "scan_version_id column must exist");
    assert.strictEqual(col.notnull, 0, "scan_version_id should be nullable");
    db.close();
  });

  it("migration version is 5", () => {
    assert.strictEqual(migration005.version, 5);
  });
});

// ---------------------------------------------------------------------------
// 2. beginScan
// ---------------------------------------------------------------------------
describe("beginScan", () => {
  it("inserts a scan_versions row and returns a numeric ID > 0", () => {
    const { db, qe } = makeQE();
    const repoId = insertRepo(db);
    const scanVersionId = qe.beginScan(repoId);
    assert.ok(typeof scanVersionId === "number", "should return a number");
    assert.ok(scanVersionId > 0, "returned ID should be > 0");
    db.close();
  });

  it("sets started_at to a non-null ISO timestamp", () => {
    const { db, qe } = makeQE();
    const repoId = insertRepo(db);
    const scanVersionId = qe.beginScan(repoId);
    const row = db
      .prepare("SELECT * FROM scan_versions WHERE id = ?")
      .get(scanVersionId);
    assert.ok(row, "row should exist");
    assert.ok(row.started_at, "started_at should be set");
    assert.ok(
      row.started_at.includes("T"),
      "started_at should be ISO format"
    );
    assert.strictEqual(row.completed_at, null, "completed_at should be null initially");
    db.close();
  });

  it("each call returns a unique increasing ID", () => {
    const { db, qe } = makeQE();
    const repoId = insertRepo(db);
    const id1 = qe.beginScan(repoId);
    const id2 = qe.beginScan(repoId);
    assert.ok(id2 > id1, "second scan ID should be greater than first");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// 3. endScan
// ---------------------------------------------------------------------------
describe("endScan", () => {
  it("marks scan as completed (sets completed_at)", () => {
    const { db, qe } = makeQE();
    const repoId = insertRepo(db);
    const scanVersionId = qe.beginScan(repoId);
    qe.endScan(repoId, scanVersionId);
    const row = db
      .prepare("SELECT * FROM scan_versions WHERE id = ?")
      .get(scanVersionId);
    assert.ok(row.completed_at, "completed_at should be set after endScan");
    db.close();
  });

  it("deletes stale services (scan_version_id != new version) after endScan", () => {
    const { db, qe } = makeQE();
    const repoId = insertRepo(db);

    // Create old scan and new scan
    const oldScanId = qe.beginScan(repoId);
    qe.endScan(repoId, oldScanId);

    // Insert a service stamped with the old scan version
    db.prepare(
      "INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id) VALUES (?, 'stale-svc', '/root', 'node', 'service', ?)"
    ).run(repoId, oldScanId);

    // Start a new scan
    const newScanId = qe.beginScan(repoId);

    // Insert a service stamped with the new scan version
    const newSvcId = qe.upsertService({
      repo_id: repoId,
      name: "current-svc",
      root_path: "/root",
      language: "node",
      scan_version_id: newScanId,
    });

    // End new scan — should delete stale rows
    qe.endScan(repoId, newScanId);

    const rows = db.prepare("SELECT name FROM services WHERE repo_id = ?").all(repoId);
    const names = rows.map((r) => r.name);
    assert.ok(!names.includes("stale-svc"), "stale service should be deleted");
    assert.ok(names.includes("current-svc"), "current service should survive");
    db.close();
  });

  it("does NOT delete rows with scan_version_id IS NULL (legacy rows)", () => {
    const { db, qe } = makeQE();
    const repoId = insertRepo(db);

    // Insert a legacy service with NULL scan_version_id
    db.prepare(
      "INSERT INTO services (repo_id, name, root_path, language, type) VALUES (?, 'legacy-svc', '/root', 'node', 'service')"
    ).run(repoId);

    const scanId = qe.beginScan(repoId);
    qe.upsertService({
      repo_id: repoId,
      name: "new-svc",
      root_path: "/root",
      language: "node",
      scan_version_id: scanId,
    });
    qe.endScan(repoId, scanId);

    const rows = db.prepare("SELECT name FROM services WHERE repo_id = ?").all(repoId);
    const names = rows.map((r) => r.name);
    assert.ok(names.includes("legacy-svc"), "legacy NULL rows should NOT be deleted");
    db.close();
  });

  it("deletes connections referencing stale services before deleting stale services", () => {
    const { db, qe } = makeQE();
    const repoId = insertRepo(db);

    // Create old scan
    const oldScanId = qe.beginScan(repoId);
    qe.endScan(repoId, oldScanId);

    // Insert stale service and a current service
    const staleSvcId = db.prepare(
      "INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id) VALUES (?, 'stale', '/root', 'node', 'service', ?) RETURNING id"
    ).get(repoId, oldScanId).id;

    const newScanId = qe.beginScan(repoId);
    const currentSvcId = qe.upsertService({
      repo_id: repoId,
      name: "current",
      root_path: "/root",
      language: "node",
      scan_version_id: newScanId,
    });

    // Insert a connection referencing the stale service as source
    db.prepare(
      "INSERT INTO connections (source_service_id, target_service_id, protocol, scan_version_id) VALUES (?, ?, 'rest', ?)"
    ).run(staleSvcId, currentSvcId, oldScanId);

    // Verify connection exists before endScan
    const connBefore = db
      .prepare("SELECT id FROM connections WHERE source_service_id = ?")
      .all(staleSvcId);
    assert.ok(connBefore.length > 0, "stale connection should exist before endScan");

    // endScan should clean up connections first, then services
    qe.endScan(repoId, newScanId);

    // Connection should be deleted (references stale service)
    const connAfter = db
      .prepare("SELECT id FROM connections WHERE source_service_id = ?")
      .all(staleSvcId);
    assert.strictEqual(connAfter.length, 0, "stale connection should be deleted");

    // Stale service should also be deleted
    const staleRow = db
      .prepare("SELECT id FROM services WHERE name = 'stale'")
      .get();
    assert.ok(!staleRow, "stale service should be deleted");

    db.close();
  });
});

// ---------------------------------------------------------------------------
// 4. persistFindings with scanVersionId
// ---------------------------------------------------------------------------
describe("persistFindings with scanVersionId", () => {
  it("stamps all upserted services with the given scanVersionId", () => {
    const { db, qe } = makeQE();
    const repoId = insertRepo(db);
    const scanVersionId = qe.beginScan(repoId);

    qe.persistFindings(
      repoId,
      {
        services: [
          { name: "svc-a", root_path: "/r/a", language: "node" },
          { name: "svc-b", root_path: "/r/b", language: "python" },
        ],
        connections: [],
      },
      null,
      scanVersionId
    );

    const rows = db
      .prepare("SELECT name, scan_version_id FROM services WHERE repo_id = ?")
      .all(repoId);
    for (const row of rows) {
      assert.strictEqual(
        row.scan_version_id,
        scanVersionId,
        `service ${row.name} should have scan_version_id = ${scanVersionId}`
      );
    }
    db.close();
  });

  it("stamps connections with scanVersionId", () => {
    const { db, qe } = makeQE();
    const repoId = insertRepo(db);
    const scanVersionId = qe.beginScan(repoId);

    qe.persistFindings(
      repoId,
      {
        services: [
          { name: "svc-a", root_path: "/r/a", language: "node" },
          { name: "svc-b", root_path: "/r/b", language: "node" },
        ],
        connections: [
          { source: "svc-a", target: "svc-b", protocol: "rest" },
        ],
      },
      null,
      scanVersionId
    );

    const conn = db
      .prepare("SELECT * FROM connections LIMIT 1")
      .get();
    assert.ok(conn, "connection should exist");
    assert.strictEqual(conn.scan_version_id, scanVersionId);
    db.close();
  });

  it("works without scanVersionId (backwards compat) — scan_version_id is null", () => {
    const { db, qe } = makeQE();
    const repoId = insertRepo(db);

    qe.persistFindings(
      repoId,
      {
        services: [{ name: "svc-a", root_path: "/r/a", language: "node" }],
        connections: [],
      },
      null
      // no scanVersionId
    );

    const row = db
      .prepare("SELECT scan_version_id FROM services WHERE name = 'svc-a'")
      .get();
    assert.ok(row, "service row should exist");
    assert.strictEqual(row.scan_version_id, null, "scan_version_id should be null");
    db.close();
  });
});
