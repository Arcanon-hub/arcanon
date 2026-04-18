/**
 * Tests for worker/mcp-server.js — impact_search and impact_scan tools (Task 2)
 * Run: node --test worker/mcp-server-search.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// Import query functions exported from mcp-server.js
import { querySearch, queryScan } from "./server.js";

// ─────────────────────────────────────────────────────────────
// Test DB setup helpers
// ─────────────────────────────────────────────────────────────

function createTestDb({ withFts = true } = {}) {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      last_commit TEXT,
      scanned_at TEXT
    );

    CREATE TABLE services (
      id INTEGER PRIMARY KEY,
      repo_id INTEGER REFERENCES repos(id),
      name TEXT NOT NULL,
      root_path TEXT,
      language TEXT
    );

    CREATE TABLE connections (
      id INTEGER PRIMARY KEY,
      source_service_id INTEGER REFERENCES services(id),
      target_service_id INTEGER REFERENCES services(id),
      protocol TEXT,
      method TEXT,
      path TEXT,
      source_file TEXT,
      target_file TEXT
    );
  `);

  if (withFts) {
    db.exec(`
      CREATE VIRTUAL TABLE connections_fts USING fts5(
        path, protocol, source_file, target_file,
        content=connections,
        content_rowid=id
      );

      CREATE TRIGGER connections_ai AFTER INSERT ON connections BEGIN
        INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
        VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
      END;
    `);
  }

  db.prepare("INSERT INTO repos VALUES (1, ?, ?, ?, ?, ?)").run(
    "/repo",
    "main-repo",
    "monorepo",
    null,
    null,
  );
  db.prepare("INSERT INTO services VALUES (?, ?, ?, ?, ?)").run(
    1,
    1,
    "order-service",
    "/repo/orders",
    "javascript",
  );
  db.prepare("INSERT INTO services VALUES (?, ?, ?, ?, ?)").run(
    2,
    1,
    "payment-service",
    "/repo/payments",
    "javascript",
  );

  db.prepare("INSERT INTO connections VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    1,
    1,
    2,
    "http",
    "POST",
    "/payments/charge",
    "/repo/orders/src/checkout.js",
    "/repo/payments/src/handler.js",
  );

  return db;
}

// ─────────────────────────────────────────────────────────────
// querySearch tests
// ─────────────────────────────────────────────────────────────

test("querySearch: null db returns empty results", async () => {
  const result = await querySearch(null, { query: "payment", limit: 20 });
  assert.deepEqual(result.results, []);
});

test("querySearch: FTS5 query returns matching rows", async () => {
  const db = createTestDb({ withFts: true });
  // FTS5 uses token-based matching: "payments" is the token in the path "/payments/charge"
  const result = await querySearch(db, { query: "payments", limit: 20 });
  db.close();
  assert.ok(Array.isArray(result.results), "results should be array");
  assert.ok(result.results.length >= 1, "expected at least one FTS match");
  assert.equal(result.search_mode, "fts5");
  const row = result.results[0];
  assert.ok("source_service" in row, "row should have source_service");
  assert.ok("target_service" in row, "row should have target_service");
  assert.ok("path" in row, "row should have path");
  assert.ok("protocol" in row, "row should have protocol");
});

test("querySearch: FTS5 query with no match returns empty results", async () => {
  const db = createTestDb({ withFts: true });
  const result = await querySearch(db, {
    query: "zzz_no_match_xyz",
    limit: 20,
  });
  db.close();
  assert.deepEqual(result.results, []);
  assert.equal(result.search_mode, "fts5");
});

test("querySearch: falls back to SQL LIKE when FTS5 table absent", async () => {
  const db = createTestDb({ withFts: false });
  // connections_fts table does not exist
  const result = await querySearch(db, { query: "payment", limit: 20 });
  db.close();
  assert.ok(Array.isArray(result.results), "results should be array");
  assert.ok(result.results.length >= 1, "expected at least one LIKE match");
  assert.equal(result.search_mode, "sql_fallback");
});

test("querySearch: respects limit parameter", async () => {
  const db = createTestDb({ withFts: true });
  const result = await querySearch(db, { query: "payment", limit: 1 });
  db.close();
  assert.ok(result.results.length <= 1, "limit should be respected");
});

// ─────────────────────────────────────────────────────────────
// queryScan tests
// ─────────────────────────────────────────────────────────────

test("queryScan: returns unavailable when port file does not exist", async () => {
  const result = await queryScan({ repo: "/nonexistent/path/abc123" });
  assert.equal(result.status, "unavailable");
  assert.ok(typeof result.message === "string");
});

test("queryScan: never throws — always returns structured object", async () => {
  let result;
  try {
    result = await queryScan({ repo: "/nonexistent/path/abc123" });
  } catch {
    assert.fail("queryScan should not throw");
  }
  assert.ok("status" in result, "result should have status");
  assert.ok("message" in result, "result should have message");
});

test("queryScan: returns object with status and message fields", async () => {
  const result = await queryScan({});
  assert.ok(typeof result.status === "string", "status should be string");
  assert.ok(typeof result.message === "string", "message should be string");
});
