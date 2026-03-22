/**
 * worker/db/query-engine-mcp-enrichment.test.js
 *
 * Tests for MCP enrichment of impact responses.
 *
 * Covers:
 *   - enrichImpactResult: result items include owner/auth_mechanism/db_backend from node_metadata
 *   - enrichImpactResult: fields are null when node_metadata has no matching row
 *   - enrichAffectedResult: affected items include owner/auth_mechanism/db_backend
 *   - enrichAffectedResult: empty affected array returns [] without throwing
 *
 * Uses node:test + node:assert/strict — zero external dependencies.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { enrichImpactResult, enrichAffectedResult } from "./query-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an in-memory DB with all tables needed for enrichment tests. */
function buildTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE repos (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      path      TEXT NOT NULL,
      name      TEXT NOT NULL,
      type      TEXT NOT NULL
    );
    CREATE TABLE services (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id    INTEGER NOT NULL REFERENCES repos(id),
      name       TEXT NOT NULL,
      root_path  TEXT NOT NULL,
      language   TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'service'
    );
    CREATE TABLE node_metadata (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id),
      view       TEXT    NOT NULL,
      key        TEXT    NOT NULL,
      value      TEXT,
      source     TEXT,
      updated_at TEXT,
      UNIQUE(service_id, view, key)
    );
  `);

  return db;
}

/** Seed a repo and return its id. */
function seedRepo(db) {
  return db
    .prepare("INSERT INTO repos (path, name, type) VALUES (?,?,?)")
    .run("/tmp/test", "test-repo", "single").lastInsertRowid;
}

/** Seed a service and return its id. */
function seedService(db, repoId, name, type = "service") {
  return db
    .prepare(
      "INSERT INTO services (repo_id, name, root_path, language, type) VALUES (?,?,?,?,?)"
    )
    .run(repoId, name, ".", "typescript", type).lastInsertRowid;
}

/** Insert a node_metadata row.
 *  View must match the production filter: enrichment, security, infra, ownership.
 *  Route keys to their canonical view automatically. */
const KEY_TO_VIEW = { owner: "ownership", owners: "ownership", auth_mechanism: "security", db_backend: "infra" };
function seedMeta(db, serviceId, key, value) {
  const view = KEY_TO_VIEW[key] || "enrichment";
  db.prepare(
    "INSERT INTO node_metadata (service_id, view, key, value) VALUES (?,?,?,?)"
  ).run(serviceId, view, key, value);
}

// ---------------------------------------------------------------------------
// Test 1: enrichImpactResult with node_metadata
// ---------------------------------------------------------------------------

describe("enrichImpactResult() with node_metadata", () => {
  let db;
  let repoId;
  let paymentsId;
  let billingId;

  before(() => {
    db = buildTestDb();
    repoId = seedRepo(db);
    paymentsId = seedService(db, repoId, "payments-api");
    billingId = seedService(db, repoId, "billing");

    // payments-api has metadata; billing does NOT yet
    seedMeta(db, paymentsId, "owner", "@team-payments");
  });

  after(() => {
    if (db) db.close();
  });

  test("result items have owner null when result service has no metadata", () => {
    // billing has no metadata — result service is 'billing', so owner must be null
    const out = enrichImpactResult(db, "payments-api", [
      { service: "billing", protocol: "rest", depth: 1 },
    ]);
    assert.equal(
      out.results[0].owner,
      null,
      "billing has no metadata — owner must be null"
    );
    assert.equal(out.results[0].auth_mechanism, null);
    assert.equal(out.results[0].db_backend, null);
  });

  test("result items include owner when result service has node_metadata", () => {
    // Add metadata for 'billing'
    seedMeta(db, billingId, "owner", "@team-billing");

    const out = enrichImpactResult(db, "payments-api", [
      { service: "billing", protocol: "rest", depth: 1 },
    ]);
    assert.equal(
      out.results[0].owner,
      "@team-billing",
      "billing now has metadata — owner must be @team-billing"
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: enrichImpactResult with no node_metadata rows
// ---------------------------------------------------------------------------

describe("enrichImpactResult() with empty node_metadata", () => {
  let db;
  let repoId;

  before(() => {
    db = buildTestDb();
    repoId = seedRepo(db);
    seedService(db, repoId, "alpha");
    seedService(db, repoId, "beta");
    // No node_metadata rows inserted
  });

  after(() => {
    if (db) db.close();
  });

  test("all three fields are null when no node_metadata rows exist", () => {
    const out = enrichImpactResult(db, "alpha", [
      { service: "beta", protocol: "grpc", depth: 2 },
    ]);
    assert.equal(out.results[0].owner, null);
    assert.equal(out.results[0].auth_mechanism, null);
    assert.equal(out.results[0].db_backend, null);
  });
});

// ---------------------------------------------------------------------------
// Test 3: enrichAffectedResult annotates affected list
// ---------------------------------------------------------------------------

describe("enrichAffectedResult() with node_metadata", () => {
  let db;
  let repoId;

  before(() => {
    db = buildTestDb();
    repoId = seedRepo(db);
    const orderId = seedService(db, repoId, "order-service");
    seedMeta(db, orderId, "auth_mechanism", "jwt");
    // No db_backend row inserted — should be null
  });

  after(() => {
    if (db) db.close();
  });

  test("affected items include auth_mechanism from node_metadata and null for absent fields", () => {
    const out = enrichAffectedResult(db, [
      { service: "order-service", connection_count: 3 },
    ]);
    assert.equal(out[0].auth_mechanism, "jwt", "auth_mechanism must be 'jwt'");
    assert.equal(out[0].db_backend, null, "db_backend not set — must be null");
    assert.equal(out[0].owner, null, "owner not set — must be null");
    assert.equal(out[0].service, "order-service");
    assert.equal(out[0].connection_count, 3);
  });
});

// ---------------------------------------------------------------------------
// Test 4: enrichAffectedResult with empty array returns []
// ---------------------------------------------------------------------------

describe("enrichAffectedResult() with empty affected array", () => {
  let db;

  before(() => {
    db = buildTestDb();
    seedRepo(db);
  });

  after(() => {
    if (db) db.close();
  });

  test("returns empty array without throwing", () => {
    let threw = false;
    let out;
    try {
      out = enrichAffectedResult(db, []);
    } catch {
      threw = true;
    }
    assert.ok(!threw, "enrichAffectedResult must not throw on empty input");
    assert.ok(Array.isArray(out), "must return an array");
    assert.equal(out.length, 0, "result must be empty");
  });
});
