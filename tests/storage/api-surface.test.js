/**
 * tests/storage/api-surface.test.js
 *
 * Unit tests for getGraph() exposes attachment (Phase 31, Plan 01).
 * Verifies that getGraph() attaches exposes arrays from exposed_endpoints
 * to every service node, including graceful degradation when migration 007
 * has not yet run.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";

import { QueryEngine } from "../../worker/db/query-engine.js";

import * as migration001 from "../../worker/db/migrations/001_initial_schema.js";
import * as migration002 from "../../worker/db/migrations/002_service_type.js";
import * as migration003 from "../../worker/db/migrations/003_exposed_endpoints.js";
import * as migration004 from "../../worker/db/migrations/004_dedup_constraints.js";
import * as migration005 from "../../worker/db/migrations/005_scan_versions.js";
import * as migration006 from "../../worker/db/migrations/006_dedup_repos.js";
import * as migration007 from "../../worker/db/migrations/007_expose_kind.js";

/**
 * Creates an isolated in-memory-backed on-disk DB running migrations 001–007.
 * This is the full migration chain for Phase 31 tests.
 */
function makeQE() {
  const dir = path.join(os.tmpdir(), "arcanon-test-" + crypto.randomUUID());
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
  for (const m of [
    migration001,
    migration002,
    migration003,
    migration004,
    migration005,
    migration006,
    migration007,
  ]) {
    db.transaction(() => {
      m.up(db);
      db.prepare("INSERT INTO schema_versions (version) VALUES (?)").run(m.version);
    })();
  }

  const qe = new QueryEngine(db);
  return { db, qe };
}

/**
 * Creates an isolated DB running migrations 001–006 only.
 * Used to test graceful degradation when migration 007 (kind column) has not run.
 */
function makeQEWithout007() {
  const dir = path.join(os.tmpdir(), "arcanon-test-" + crypto.randomUUID());
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
  for (const m of [
    migration001,
    migration002,
    migration003,
    migration004,
    migration005,
    migration006,
  ]) {
    db.transaction(() => {
      m.up(db);
      db.prepare("INSERT INTO schema_versions (version) VALUES (?)").run(m.version);
    })();
  }

  const qe = new QueryEngine(db);
  return { db, qe };
}

/**
 * Insert a repo and service into the DB, return their ids.
 */
function insertService(db, repoPath = "/repo/alpha", serviceName = "alpha") {
  db.prepare(
    "INSERT OR IGNORE INTO repos (name, path, type) VALUES (?, ?, 'service')",
  ).run(serviceName + "-repo", repoPath);
  const repo = db.prepare("SELECT id FROM repos WHERE path = ?").get(repoPath);
  db.prepare(
    "INSERT OR IGNORE INTO services (name, root_path, language, type, repo_id) VALUES (?, ?, 'js', 'service', ?)",
  ).run(serviceName, repoPath + "/" + serviceName, repo.id);
  const svc = db
    .prepare("SELECT id FROM services WHERE name = ?")
    .get(serviceName);
  return { repoId: repo.id, serviceId: svc.id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getGraph() exposes attachment", () => {
  it("Test 1: returns exposes array on service nodes that have exposed_endpoints rows", () => {
    const { db, qe } = makeQE();

    const { serviceId } = insertService(db);

    db.prepare(
      "INSERT INTO exposed_endpoints (service_id, method, path, handler, kind) VALUES (?, ?, ?, ?, ?)",
    ).run(serviceId, "GET", "/health", "healthHandler", "endpoint");
    db.prepare(
      "INSERT INTO exposed_endpoints (service_id, method, path, handler, kind) VALUES (?, ?, ?, ?, ?)",
    ).run(serviceId, "POST", "/users", "createUser", "endpoint");

    const graph = qe.getGraph();
    const svc = graph.services.find((s) => s.id === serviceId);

    assert.ok(svc, "service node must be present");
    assert.ok(Array.isArray(svc.exposes), "exposes must be an array");
    assert.strictEqual(svc.exposes.length, 2, "should have 2 exposed endpoints");

    const health = svc.exposes.find((e) => e.path === "/health");
    assert.ok(health, "GET /health must be in exposes");
    assert.strictEqual(health.method, "GET");
    assert.strictEqual(health.kind, "endpoint");
    assert.strictEqual(health.handler, "healthHandler");
    assert.strictEqual(health.service_id, serviceId);

    db.close();
  });

  it("Test 2: returns exposes: [] for service nodes with no exposed_endpoints rows", () => {
    const { db, qe } = makeQE();

    const { serviceId } = insertService(db);
    // No exposed_endpoints rows inserted

    const graph = qe.getGraph();
    const svc = graph.services.find((s) => s.id === serviceId);

    assert.ok(svc, "service node must be present");
    assert.ok(Array.isArray(svc.exposes), "exposes must be an array (not undefined)");
    assert.strictEqual(svc.exposes.length, 0, "exposes must be empty array []");

    db.close();
  });

  it("Test 3: returns exposes: [] for all nodes when migration 007 has not run", () => {
    const { db, qe } = makeQEWithout007();

    const { serviceId } = insertService(db);

    // Insert an endpoint using the pre-007 schema (no kind column)
    db.prepare(
      "INSERT INTO exposed_endpoints (service_id, method, path, handler) VALUES (?, ?, ?, ?)",
    ).run(serviceId, "GET", "/ping", "pingHandler");

    const graph = qe.getGraph();
    const svc = graph.services.find((s) => s.id === serviceId);

    assert.ok(svc, "service node must be present");
    assert.ok(Array.isArray(svc.exposes), "exposes must be an array even without migration 007");
    assert.strictEqual(svc.exposes.length, 0, "exposes must be [] when kind column is missing");

    db.close();
  });

  it("Test 4: multiple services each get their own correct exposes arrays", () => {
    const { db, qe } = makeQE();

    const { serviceId: idA } = insertService(db, "/repo/a", "svcA");
    const { serviceId: idB } = insertService(db, "/repo/b", "svcB");

    // svcA gets 2 endpoints, svcB gets 1
    db.prepare(
      "INSERT INTO exposed_endpoints (service_id, method, path, handler, kind) VALUES (?, ?, ?, ?, ?)",
    ).run(idA, "GET", "/a1", "handlerA1", "endpoint");
    db.prepare(
      "INSERT INTO exposed_endpoints (service_id, method, path, handler, kind) VALUES (?, ?, ?, ?, ?)",
    ).run(idA, "POST", "/a2", "handlerA2", "endpoint");
    db.prepare(
      "INSERT INTO exposed_endpoints (service_id, method, path, handler, kind) VALUES (?, ?, ?, ?, ?)",
    ).run(idB, "GET", "/b1", "handlerB1", "endpoint");

    const graph = qe.getGraph();
    const svcA = graph.services.find((s) => s.id === idA);
    const svcB = graph.services.find((s) => s.id === idB);

    assert.ok(svcA, "svcA must be present");
    assert.ok(svcB, "svcB must be present");
    assert.strictEqual(svcA.exposes.length, 2, "svcA should have 2 exposes");
    assert.strictEqual(svcB.exposes.length, 1, "svcB should have 1 expose");

    // Verify svcA's exposes don't include svcB's paths
    assert.ok(!svcA.exposes.some((e) => e.path === "/b1"), "svcA must not include svcB endpoints");
    // Verify svcB's expose
    assert.strictEqual(svcB.exposes[0].path, "/b1");
    assert.strictEqual(svcB.exposes[0].service_id, idB);

    db.close();
  });
});
