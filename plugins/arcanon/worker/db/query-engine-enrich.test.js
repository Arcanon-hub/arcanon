/**
 * worker/db/query-engine-enrich.test.js
 *
 * Tests for enrichImpactResult() and enrichSearchResult() helpers.
 *
 * Covers:
 *   - enrichImpactResult: summary string contains type word and count
 *   - enrichImpactResult: boundary found in config — summary includes boundary name
 *   - enrichImpactResult: library type produces "is used by" phrasing
 *   - enrichImpactResult: actors table absent — no error, summary still returned
 *   - enrichSearchResult: actor_connections row present → sentence appended
 *   - enrichSearchResult: actor_connections table absent → empty actor_sentences, no throw
 *   - enrichSearchResult: results with no actor rows get empty actor_sentences array
 *
 * Uses node:test + node:assert/strict — zero external dependencies.
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { enrichImpactResult, enrichSearchResult } from "./query-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a DB with the services table (and optionally actors tables). */
function buildDb({ withActors = true } = {}) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL
    );
    CREATE TABLE services (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id  INTEGER NOT NULL REFERENCES repos(id),
      name     TEXT NOT NULL,
      root_path TEXT NOT NULL,
      language TEXT NOT NULL,
      type     TEXT NOT NULL DEFAULT 'service'
    );
  `);

  if (withActors) {
    db.exec(`
      CREATE TABLE actors (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name      TEXT NOT NULL UNIQUE,
        kind      TEXT,
        direction TEXT,
        source    TEXT
      );
      CREATE TABLE actor_connections (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id   INTEGER NOT NULL REFERENCES actors(id),
        service_id INTEGER NOT NULL REFERENCES services(id),
        direction  TEXT,
        protocol   TEXT,
        path       TEXT
      );
    `);
  }

  return db;
}

/** Seed a repo and return its id. */
function seedRepo(db) {
  return db
    .prepare("INSERT INTO repos (path, name, type) VALUES (?,?,?)")
    .run("/tmp/test", "test-repo", "single").lastInsertRowid;
}

/** Seed a service and return its id. */
function seedService(db, repoId, { name, type = "service" } = {}) {
  return db
    .prepare(
      "INSERT INTO services (repo_id, name, root_path, language, type) VALUES (?,?,?,?,?)"
    )
    .run(repoId, name, ".", "typescript", type).lastInsertRowid;
}

// ---------------------------------------------------------------------------
// enrichImpactResult tests
// ---------------------------------------------------------------------------

describe("enrichImpactResult()", () => {
  let db;
  let tmpDir;

  before(() => {
    db = buildDb({ withActors: false });
    const repoId = seedRepo(db);
    seedService(db, repoId, { name: "payments-api", type: "service" });
    seedService(db, repoId, { name: "common-sdk", type: "library" });
    seedService(db, repoId, { name: "redis-cluster", type: "infra" });

    // Create a temp dir to act as process.cwd() — no config file yet
    tmpDir = mkdtempSync(join(tmpdir(), "arcanon-enrich-test-"));
  });

  after(() => {
    if (db) db.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns object with results and summary keys", () => {
    const results = [{ service: "billing-service", protocol: "rest", depth: 1 }];
    const out = enrichImpactResult(db, "payments-api", results);
    assert.ok("results" in out, "must have results key");
    assert.ok("summary" in out, "must have summary key");
    assert.equal(out.results, results, "results must be passed through unchanged");
  });

  test("summary for plain service includes 'service' type word and count", () => {
    const results = [
      { service: "a", protocol: "rest", depth: 1 },
      { service: "b", protocol: "rest", depth: 1 },
    ];
    const out = enrichImpactResult(db, "payments-api", results);
    assert.ok(
      out.summary.includes("service"),
      `summary should contain 'service', got: "${out.summary}"`
    );
    assert.ok(
      out.summary.includes("2"),
      `summary should contain count '2', got: "${out.summary}"`
    );
  });

  test("summary for library type uses 'is used by' phrasing", () => {
    const results = [
      { service: "svc-a", protocol: "sdk", depth: 1 },
      { service: "svc-b", protocol: "sdk", depth: 1 },
      { service: "svc-c", protocol: "sdk", depth: 1 },
    ];
    const out = enrichImpactResult(db, "common-sdk", results);
    assert.ok(
      out.summary.includes("library") || out.summary.includes("sdk"),
      `summary for library type should mention 'library', got: "${out.summary}"`
    );
    assert.ok(
      out.summary.includes("3"),
      `summary should contain count '3', got: "${out.summary}"`
    );
    assert.ok(
      out.summary.toLowerCase().includes("used by") ||
        out.summary.toLowerCase().includes("service"),
      `summary should contain 'used by' or 'service', got: "${out.summary}"`
    );
  });

  test("summary for infra type mentions 'infrastructure' or 'infra'", () => {
    const results = [{ service: "svc-a", depth: 1 }];
    const out = enrichImpactResult(db, "redis-cluster", results);
    assert.ok(
      out.summary.toLowerCase().includes("infra"),
      `summary for infra should include 'infra', got: "${out.summary}"`
    );
  });

  test("summary includes boundary name when config file is present", () => {
    // Write a arcanon.config.json in tmpDir
    const cfgPath = join(tmpDir, "arcanon.config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({
        boundaries: { payments: ["payments-api", "billing-service"] },
      })
    );

    // Temporarily override process.cwd for this test
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    try {
      const results = [{ service: "billing-service", depth: 1 }];
      const out = enrichImpactResult(db, "payments-api", results);
      assert.ok(
        out.summary.includes("payments"),
        `summary should include boundary name 'payments', got: "${out.summary}"`
      );
    } finally {
      process.cwd = origCwd;
    }
  });

  test("does not throw when db has no services table (best-effort)", () => {
    const emptyDb = new Database(":memory:");
    let threw = false;
    let out;
    try {
      out = enrichImpactResult(emptyDb, "unknown-svc", [{ service: "x" }]);
    } catch {
      threw = true;
    } finally {
      emptyDb.close();
    }
    assert.ok(!threw, "enrichImpactResult must not throw");
    assert.ok(out && "results" in out, "must return object with results key");
    assert.ok(out && "summary" in out, "must return object with summary key");
  });
});

// ---------------------------------------------------------------------------
// enrichSearchResult tests
// ---------------------------------------------------------------------------

describe("enrichSearchResult()", () => {
  let db;

  before(() => {
    db = buildDb({ withActors: true });
    const repoId = seedRepo(db);
    const svcId = seedService(db, repoId, { name: "payments-api", type: "service" });

    // Insert actor + actor_connection
    db.prepare(
      "INSERT INTO actors (name, kind, direction, source) VALUES (?,?,?,?)"
    ).run("Stripe", "system", "outbound", "scan");

    const actorId = db
      .prepare("SELECT id FROM actors WHERE name = 'Stripe'")
      .get().id;

    db.prepare(
      "INSERT INTO actor_connections (actor_id, service_id, direction, protocol) VALUES (?,?,?,?)"
    ).run(actorId, svcId, "outbound", "REST");
  });

  after(() => {
    if (db) db.close();
  });

  test("returns array with same length as input", () => {
    const input = [
      { path: "/pay", protocol: "rest", source_service: "payments-api", target_service: "billing" },
    ];
    const out = enrichSearchResult(db, input);
    assert.ok(Array.isArray(out), "must return array");
    assert.equal(out.length, 1, "must return same number of rows");
  });

  test("each result row has actor_sentences array", () => {
    const input = [
      { path: "/pay", protocol: "rest", source_service: "payments-api", target_service: "billing" },
    ];
    const out = enrichSearchResult(db, input);
    assert.ok("actor_sentences" in out[0], "row must have actor_sentences key");
    assert.ok(Array.isArray(out[0].actor_sentences), "actor_sentences must be an array");
  });

  test("actor_sentences contains relationship sentence for known source service", () => {
    const input = [
      { path: "/pay", protocol: "rest", source_service: "payments-api", target_service: "billing" },
    ];
    const out = enrichSearchResult(db, input);
    assert.ok(
      out[0].actor_sentences.length > 0,
      "payments-api has actor connection — should have at least one sentence"
    );
    const sentence = out[0].actor_sentences[0];
    assert.ok(
      sentence.includes("payments-api"),
      `sentence should include source service name, got: "${sentence}"`
    );
    assert.ok(
      sentence.includes("Stripe"),
      `sentence should include actor name, got: "${sentence}"`
    );
  });

  test("row with unknown source service gets empty actor_sentences", () => {
    const input = [
      { path: "/auth", protocol: "rest", source_service: "no-such-service", target_service: "payments-api" },
    ];
    const out = enrichSearchResult(db, input);
    assert.equal(
      out[0].actor_sentences.length,
      0,
      "unknown service should produce empty actor_sentences"
    );
  });

  test("original row fields are preserved", () => {
    const input = [
      { path: "/pay", protocol: "rest", source_service: "payments-api", target_service: "billing" },
    ];
    const out = enrichSearchResult(db, input);
    assert.equal(out[0].path, "/pay");
    assert.equal(out[0].protocol, "rest");
    assert.equal(out[0].source_service, "payments-api");
    assert.equal(out[0].target_service, "billing");
  });

  test("does not throw when actors table is absent", () => {
    const dbNoActors = buildDb({ withActors: false });
    const repoId = seedRepo(dbNoActors);
    seedService(dbNoActors, repoId, { name: "svc-a" });

    let threw = false;
    let out;
    try {
      out = enrichSearchResult(dbNoActors, [
        { path: "/x", protocol: "rest", source_service: "svc-a", target_service: "svc-b" },
      ]);
    } catch {
      threw = true;
    } finally {
      dbNoActors.close();
    }

    assert.ok(!threw, "enrichSearchResult must not throw when actors table absent");
    assert.ok(Array.isArray(out), "must return array even when actors table absent");
    assert.ok(
      out.length > 0 && "actor_sentences" in out[0],
      "must have actor_sentences key even when actors table absent"
    );
    assert.equal(out[0].actor_sentences.length, 0, "actor_sentences must be empty when table absent");
  });
});
