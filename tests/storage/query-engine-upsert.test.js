/**
 * tests/storage/query-engine-upsert.test.js
 *
 * Tests for STORE-03: persistFindings() type-conditional dispatch.
 * Verifies that the kind column is populated correctly for service, library,
 * sdk, and infra node types.
 *
 * Uses Node.js built-in test runner (node:test, available since Node 18+).
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
import * as migration003 from "../../worker/db/migrations/003_exposed_endpoints.js";
import * as migration004 from "../../worker/db/migrations/004_dedup_constraints.js";
import * as migration005 from "../../worker/db/migrations/005_scan_versions.js";
import * as migration006 from "../../worker/db/migrations/006_dedup_repos.js";
import * as migration007 from "../../worker/db/migrations/007_expose_kind.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create a fresh isolated on-disk DB for each test.
 * Runs all 7 migrations including 006 (dedup_repos) and 007 (expose_kind)
 * so that the kind column is present in exposed_endpoints.
 */
function makeQE() {
  const dir = path.join(os.tmpdir(), "arcanon-upsert-test-" + crypto.randomUUID());
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
 * Helper: create a repo and call persistFindings() with a single service of
 * the given type + exposes array. Returns the service_id and db for assertions.
 */
function seedFindings(qe, db, { type, exposes, name = "test-svc" }) {
  const repoId = qe.upsertRepo({
    path: "/repos/" + crypto.randomUUID(),
    name: "test-repo",
    type: "single",
  }).id;

  qe.persistFindings(repoId, {
    services: [{ name, type, exposes, root_path: "/repos/test", language: "node" }],
    connections: [],
    schemas: [],
  });

  const svcId = db
    .prepare("SELECT id FROM services WHERE name = ?")
    .pluck()
    .get(name);

  return svcId;
}

// ---------------------------------------------------------------------------
// STORE-03: persistFindings kind dispatch
// ---------------------------------------------------------------------------

describe("persistFindings kind dispatch — STORE-03", () => {
  // -------------------------------------------------------------------------
  // Service type tests
  // -------------------------------------------------------------------------

  it("service: METHOD PATH is split — stores method, path, kind=endpoint", () => {
    const { db, qe } = makeQE();

    const svcId = seedFindings(qe, db, {
      type: "service",
      exposes: ["GET /users", "POST /orders"],
    });

    const rows = db
      .prepare("SELECT method, path, kind FROM exposed_endpoints WHERE service_id = ? ORDER BY path")
      .all(svcId);

    assert.strictEqual(rows.length, 2);

    const get = rows.find((r) => r.path === "/users");
    assert.ok(get, "GET /users row should exist");
    assert.strictEqual(get.method, "GET");
    assert.strictEqual(get.kind, "endpoint");

    const post = rows.find((r) => r.path === "/orders");
    assert.ok(post, "POST /orders row should exist");
    assert.strictEqual(post.method, "POST");
    assert.strictEqual(post.kind, "endpoint");

    db.close();
  });

  it("service path-only: no method — stores method=NULL, kind=endpoint", () => {
    const { db, qe } = makeQE();

    const svcId = seedFindings(qe, db, {
      type: "service",
      exposes: ["/health"],
    });

    const rows = db
      .prepare("SELECT method, path, kind FROM exposed_endpoints WHERE service_id = ?")
      .all(svcId);

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].method, null);
    assert.strictEqual(rows[0].path, "/health");
    assert.strictEqual(rows[0].kind, "endpoint");

    db.close();
  });

  it("service regression: spaces in path — GET /api/v1/users splits correctly", () => {
    const { db, qe } = makeQE();

    const svcId = seedFindings(qe, db, {
      type: "service",
      exposes: ["GET /api/v1/users"],
    });

    const rows = db
      .prepare("SELECT method, path, kind FROM exposed_endpoints WHERE service_id = ?")
      .all(svcId);

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].method, "GET");
    assert.strictEqual(rows[0].path, "/api/v1/users");
    assert.strictEqual(rows[0].kind, "endpoint");

    db.close();
  });

  // -------------------------------------------------------------------------
  // Library type tests
  // -------------------------------------------------------------------------

  it("library: full function signature stored as-is — method=NULL, kind=export", () => {
    const { db, qe } = makeQE();

    const exposes = [
      "createClient(config: ClientConfig): EdgeworksClient",
      "EdgeworksConfig",
    ];

    const svcId = seedFindings(qe, db, {
      type: "library",
      exposes,
    });

    const rows = db
      .prepare("SELECT method, path, kind FROM exposed_endpoints WHERE service_id = ? ORDER BY path")
      .all(svcId);

    assert.strictEqual(rows.length, 2);

    for (const row of rows) {
      assert.strictEqual(row.method, null, "library rows should have method=NULL");
      assert.strictEqual(row.kind, "export");
    }

    const paths = rows.map((r) => r.path);
    assert.ok(paths.includes("createClient(config: ClientConfig): EdgeworksClient"));
    assert.ok(paths.includes("EdgeworksConfig"));

    db.close();
  });

  // -------------------------------------------------------------------------
  // SDK type tests
  // -------------------------------------------------------------------------

  it("sdk: full function signature stored as-is — method=NULL, kind=export", () => {
    const { db, qe } = makeQE();

    const svcId = seedFindings(qe, db, {
      type: "sdk",
      exposes: ["init(apiKey: string): void"],
    });

    const rows = db
      .prepare("SELECT method, path, kind FROM exposed_endpoints WHERE service_id = ?")
      .all(svcId);

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].method, null);
    assert.strictEqual(rows[0].path, "init(apiKey: string): void");
    assert.strictEqual(rows[0].kind, "export");

    db.close();
  });

  // -------------------------------------------------------------------------
  // Infra type tests
  // -------------------------------------------------------------------------

  it("infra: full resource reference stored as-is — method=NULL, kind=resource", () => {
    const { db, qe } = makeQE();

    const exposes = [
      "k8s:deployment/payment-service",
      "k8s:ingress/payment → payment.example.com",
    ];

    const svcId = seedFindings(qe, db, {
      type: "infra",
      exposes,
    });

    const rows = db
      .prepare("SELECT method, path, kind FROM exposed_endpoints WHERE service_id = ?")
      .all(svcId);

    assert.strictEqual(rows.length, 2);

    for (const row of rows) {
      assert.strictEqual(row.method, null, "infra rows should have method=NULL");
      assert.strictEqual(row.kind, "resource");
    }

    const paths = rows.map((r) => r.path);
    assert.ok(paths.includes("k8s:deployment/payment-service"));
    assert.ok(paths.includes("k8s:ingress/payment → payment.example.com"));

    db.close();
  });

  // -------------------------------------------------------------------------
  // Deduplication test
  // -------------------------------------------------------------------------

  it("dedup: inserting same library export twice does not throw or duplicate rows", () => {
    const { db, qe } = makeQE();

    const repoId = qe.upsertRepo({
      path: "/repos/dedup-test",
      name: "dedup-repo",
      type: "single",
    }).id;

    const findings = {
      services: [
        {
          name: "my-lib",
          type: "library",
          exposes: ["createClient(config: Config): Client"],
          root_path: "/repos/dedup-test",
          language: "node",
        },
      ],
      connections: [],
      schemas: [],
    };

    // Insert same findings twice — should not throw
    assert.doesNotThrow(() => {
      qe.persistFindings(repoId, findings);
      qe.persistFindings(repoId, findings);
    });

    const svcId = db
      .prepare("SELECT id FROM services WHERE name = 'my-lib'")
      .pluck()
      .get();

    const rows = db
      .prepare("SELECT method, path, kind FROM exposed_endpoints WHERE service_id = ?")
      .all(svcId);

    assert.strictEqual(rows.length, 1, "should have exactly one row after two identical inserts");
    assert.strictEqual(rows[0].kind, "export");

    db.close();
  });
});
