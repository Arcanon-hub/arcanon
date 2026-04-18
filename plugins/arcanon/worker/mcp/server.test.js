/**
 * Tests for worker/mcp-server.js — MCP tool implementations
 * Run: node --test worker/mcp-server.test.js
 *
 * These tests exercise the query logic functions by calling them directly
 * with an in-memory SQLite database, bypassing the MCP SDK layer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Import the query functions exported from mcp-server.js
import { queryImpact, queryChanged, queryGraph } from "./server.js";

// ─────────────────────────────────────────────────────────────
// Test DB setup helpers
// ─────────────────────────────────────────────────────────────

function createTestDb() {
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

    CREATE TABLE schemas (
      id INTEGER PRIMARY KEY,
      connection_id INTEGER REFERENCES connections(id),
      role TEXT,
      name TEXT,
      file TEXT
    );

    CREATE TABLE fields (
      id INTEGER PRIMARY KEY,
      schema_id INTEGER REFERENCES schemas(id),
      name TEXT,
      type TEXT,
      required INTEGER
    );

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

  // Seed data
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
  db.prepare("INSERT INTO services VALUES (?, ?, ?, ?, ?)").run(
    3,
    1,
    "notification-service",
    "/repo/notifications",
    "python",
  );
  db.prepare("INSERT INTO services VALUES (?, ?, ?, ?, ?)").run(
    4,
    1,
    "audit-service",
    "/repo/audit",
    "python",
  );

  // order-service → payment-service (order-service consumes payment-service)
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
  // payment-service → notification-service
  db.prepare("INSERT INTO connections VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    2,
    2,
    3,
    "http",
    "POST",
    "/notify/payment",
    "/repo/payments/src/notify.js",
    "/repo/notifications/src/handler.js",
  );
  // notification-service → audit-service (transitive from order-service)
  db.prepare("INSERT INTO connections VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    3,
    3,
    4,
    "http",
    "POST",
    "/audit/log",
    "/repo/notifications/src/audit.js",
    "/repo/audit/src/handler.js",
  );

  return db;
}

// ─────────────────────────────────────────────────────────────
// queryImpact tests
// ─────────────────────────────────────────────────────────────

test("queryImpact: direct consumers of order-service (direction=consumes)", async () => {
  const db = createTestDb();
  const result = await queryImpact(db, {
    service: "order-service",
    direction: "consumes",
    transitive: false,
  });
  db.close();
  assert.ok(Array.isArray(result.results), "results should be array");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].service, "payment-service");
  assert.equal(result.results[0].protocol, "http");
  assert.equal(result.results[0].method, "POST");
  assert.equal(result.results[0].path, "/payments/charge");
  assert.equal(result.results[0].depth, 1);
});

test("queryImpact: exposes direction returns services that consume this service", async () => {
  const db = createTestDb();
  const result = await queryImpact(db, {
    service: "payment-service",
    direction: "exposes",
    transitive: false,
  });
  db.close();
  assert.ok(Array.isArray(result.results), "results should be array");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].service, "order-service");
});

test("queryImpact: transitive=true returns all downstream services", async () => {
  const db = createTestDb();
  const result = await queryImpact(db, {
    service: "order-service",
    direction: "consumes",
    transitive: true,
  });
  db.close();
  assert.ok(Array.isArray(result.results), "results should be array");
  // Should include payment-service, notification-service, audit-service
  assert.ok(
    result.results.length >= 3,
    `expected >= 3 transitive results, got ${result.results.length}`,
  );
  const names = result.results.map((r) => r.service);
  assert.ok(
    names.includes("payment-service"),
    "should include payment-service",
  );
  assert.ok(
    names.includes("notification-service"),
    "should include notification-service",
  );
  assert.ok(names.includes("audit-service"), "should include audit-service");
});

test("queryImpact: unknown service returns empty results", async () => {
  const db = createTestDb();
  const result = await queryImpact(db, {
    service: "unknown-service",
    direction: "consumes",
    transitive: false,
  });
  db.close();
  assert.deepEqual(result, { results: [] });
});

test("queryImpact: null db returns empty results", async () => {
  const result = await queryImpact(null, {
    service: "order-service",
    direction: "consumes",
    transitive: false,
  });
  assert.deepEqual(result, { results: [] });
});

// ─────────────────────────────────────────────────────────────
// queryChanged tests
// ─────────────────────────────────────────────────────────────

test("queryChanged: null db returns empty affected array", async () => {
  const result = await queryChanged(null, { repo: "/some/path" });
  assert.deepEqual(result.affected, []);
});

test("queryChanged: files with no matching connections return empty affected", async () => {
  const db = createTestDb();
  // Pass changedFiles directly to bypass git
  const result = await queryChanged(db, {
    _changedFiles: ["/unrelated/file.js"],
  });
  db.close();
  assert.deepEqual(result.affected, []);
});

test("queryChanged: changed file matches source_file returns affected service", async () => {
  const db = createTestDb();
  const result = await queryChanged(db, {
    _changedFiles: ["/repo/orders/src/checkout.js"],
  });
  db.close();
  assert.ok(Array.isArray(result.affected), "affected should be array");
  assert.ok(result.affected.length >= 1);
  const names = result.affected.map((a) => a.service);
  assert.ok(names.includes("order-service"), "should include order-service");
});

test("queryChanged: changed_files is included in response", async () => {
  const db = createTestDb();
  const result = await queryChanged(db, {
    _changedFiles: ["foo.js", "bar.js"],
  });
  db.close();
  assert.ok(Array.isArray(result.changed_files));
  assert.ok(result.changed_files.includes("foo.js"));
});

// ─────────────────────────────────────────────────────────────
// queryGraph tests
// ─────────────────────────────────────────────────────────────

test("queryGraph: null db returns empty nodes/edges", async () => {
  const result = await queryGraph(null, {
    service: "order-service",
    depth: 2,
    direction: "both",
  });
  assert.deepEqual(result, { nodes: [], edges: [] });
});

test("queryGraph: unknown service returns empty nodes/edges", async () => {
  const db = createTestDb();
  const result = await queryGraph(db, {
    service: "unknown",
    depth: 2,
    direction: "both",
  });
  db.close();
  assert.deepEqual(result, { nodes: [], edges: [] });
});

test("queryGraph: downstream from order-service depth=1 returns payment-service node", async () => {
  const db = createTestDb();
  const result = await queryGraph(db, {
    service: "order-service",
    depth: 1,
    direction: "downstream",
  });
  db.close();
  assert.ok(Array.isArray(result.nodes), "nodes should be array");
  assert.ok(Array.isArray(result.edges), "edges should be array");
  const nodeNames = result.nodes.map((n) => n.name);
  assert.ok(
    nodeNames.includes("payment-service"),
    "should include payment-service node",
  );
  assert.ok(result.edges.length >= 1, "should include at least one edge");
  assert.equal(result.edges[0].source, "order-service");
  assert.equal(result.edges[0].target, "payment-service");
});

test("queryGraph: depth=2 downstream includes transitive services", async () => {
  const db = createTestDb();
  const result = await queryGraph(db, {
    service: "order-service",
    depth: 2,
    direction: "downstream",
  });
  db.close();
  const nodeNames = result.nodes.map((n) => n.name);
  assert.ok(
    nodeNames.includes("payment-service"),
    "should include payment-service",
  );
  assert.ok(
    nodeNames.includes("notification-service"),
    "should include notification-service",
  );
});

test("queryGraph: nodes have id, name, language fields", async () => {
  const db = createTestDb();
  const result = await queryGraph(db, {
    service: "order-service",
    depth: 1,
    direction: "downstream",
  });
  db.close();
  const node = result.nodes[0];
  assert.ok("id" in node, "node should have id");
  assert.ok("name" in node, "node should have name");
  assert.ok("language" in node, "node should have language");
});

// ─────────────────────────────────────────────────────────────
// resolveDb behavior tests
// ─────────────────────────────────────────────────────────────

import { resolveDb } from "./server.js";

test("resolveDb: no project param falls back to LIGAMEN_PROJECT_ROOT env", async () => {
  // resolveDb() with no project calls getQueryEngine with LIGAMEN_PROJECT_ROOT
  // We can verify it returns null for a nonexistent project (no DB on disk)
  const prev = process.env.LIGAMEN_PROJECT_ROOT;
  process.env.LIGAMEN_PROJECT_ROOT = "/nonexistent/project/path/xyz";
  const result = resolveDb(undefined);
  // Should return null (no DB at this path)
  assert.equal(result, null, "should return null for nonexistent project root");
  if (prev === undefined) {
    delete process.env.LIGAMEN_PROJECT_ROOT;
  } else {
    process.env.LIGAMEN_PROJECT_ROOT = prev;
  }
});

test("resolveDb: absolute path calls getQueryEngine with that path", async () => {
  // Passing an absolute path returns null when no DB exists there
  const result = resolveDb("/nonexistent/absolute/path/abc");
  assert.equal(result, null, "should return null for absolute path with no DB");
});

test("resolveDb: path traversal (contains ..) returns null", async () => {
  const result = resolveDb("/some/path/../../../etc/passwd");
  assert.equal(result, null, "path traversal should return null");
});

test("resolveDb: 12-char hex hash calls getQueryEngineByHash", async () => {
  // A valid 12-char hex hash that has no matching DB returns null
  const result = resolveDb("aabbccddeeff");
  assert.equal(result, null, "12-char hex hash with no DB should return null");
});

test("resolveDb: non-path non-hash calls getQueryEngineByRepo", async () => {
  // A repo name that doesn't exist in any DB returns null
  const result = resolveDb("some-nonexistent-repo-name-xyz");
  assert.equal(
    result,
    null,
    "nonexistent repo name should return null",
  );
});

test("resolveDb: 11-char hex (not exactly 12) is treated as repo name", async () => {
  // aabbccddeef is 11 chars — should go through getQueryEngineByRepo path
  const result = resolveDb("aabbccddeef");
  assert.equal(result, null, "11-char string treated as repo name, returns null");
});

// ─────────────────────────────────────────────────────────────
// resolveDb path traversal (SEC-01)
// ─────────────────────────────────────────────────────────────

test("resolveDb path traversal: ../../../etc/passwd returns null", () => {
  const result = resolveDb("../../../etc/passwd");
  assert.equal(result, null, "relative traversal path should return null");
});

test("resolveDb path traversal: /tmp/../../../etc/passwd returns null", () => {
  const result = resolveDb("/tmp/../../../etc/passwd");
  assert.equal(result, null, "absolute path with .. traversal should return null");
});

test("resolveDb path traversal: ....//....//etc returns null", () => {
  const result = resolveDb("....//....//etc");
  assert.equal(result, null, "double-dot variant traversal should return null");
});

test("resolveDb path traversal: undefined does not throw, returns null or QueryEngine", () => {
  // Just verifies no exception is thrown
  let result;
  assert.doesNotThrow(() => { result = resolveDb(undefined); });
  // result is either null (no DB) or a QueryEngine — both are acceptable
  assert.ok(result === null || typeof result === "object", "should return null or object, not throw");
});

test("resolveDb path traversal: valid 12-char hex hash does not false-positive", () => {
  // Safe: regex rejects non-hex chars including '.' and '/'
  const result = resolveDb("abcdef012345");
  // Either null (no DB on disk) or a QueryEngine — should not throw
  assert.ok(result === null || typeof result === "object", "valid hex hash should not throw");
});

// ─────────────────────────────────────────────────────────────
// impact_query depth limit (REL-02)
// ─────────────────────────────────────────────────────────────

/**
 * Build a linear chain of N services: svc-1 -> svc-2 -> ... -> svc-N
 * Returns a fresh in-memory DB.
 */
function createChainDb(length) {
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

  db.prepare("INSERT INTO repos VALUES (1, ?, ?, ?, ?, ?)").run(
    "/chain-repo", "chain-repo", "monorepo", null, null,
  );

  for (let i = 1; i <= length; i++) {
    db.prepare("INSERT INTO services VALUES (?, ?, ?, ?, ?)").run(
      i, 1, `svc-${i}`, `/chain-repo/svc-${i}`, "javascript",
    );
  }

  for (let i = 1; i < length; i++) {
    db.prepare("INSERT INTO connections VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      i, i, i + 1, "http", "GET", `/api/${i}`, `/svc-${i}/index.js`, `/svc-${i + 1}/index.js`,
    );
  }

  return db;
}

test("impact_query depth limit: transitive query caps at depth 7 by default", async () => {
  // Chain of 10 services: svc-1 -> svc-2 -> ... -> svc-10
  const db = createChainDb(10);
  const result = await queryImpact(db, {
    service: "svc-1",
    direction: "consumes",
    transitive: true,
  });
  db.close();
  const depths = result.results.map((r) => r.depth);
  const maxDepth = Math.max(...depths, 0);
  assert.ok(
    maxDepth <= 7,
    `max depth should be <= 7, got ${maxDepth}`,
  );
});

test("impact_query depth limit: truncated flag is set when chain exceeds depth 7", async () => {
  const db = createChainDb(10);
  const result = await queryImpact(db, {
    service: "svc-1",
    direction: "consumes",
    transitive: true,
  });
  db.close();
  assert.equal(
    result.truncated,
    true,
    "truncated should be true when chain length > 7",
  );
  assert.ok(
    typeof result.notice === "string" && result.notice.includes("truncat"),
    "notice should include 'truncat'",
  );
});

test("impact_query depth limit: non-transitive query is unaffected by depth limit changes", async () => {
  const db = createChainDb(10);
  const result = await queryImpact(db, {
    service: "svc-1",
    direction: "consumes",
    transitive: false,
  });
  db.close();
  assert.ok(Array.isArray(result.results), "results should be array");
  assert.equal(result.results.length, 1, "non-transitive returns only direct connection");
  assert.equal(result.results[0].service, "svc-2");
  assert.equal(result.truncated, undefined, "truncated should not be set for non-transitive");
});

test("impact_query depth limit: short chain (4 hops) has no truncation", async () => {
  const db = createChainDb(4);
  const result = await queryImpact(db, {
    service: "svc-1",
    direction: "consumes",
    transitive: true,
  });
  db.close();
  // 4-service chain: svc-1 -> svc-2 -> svc-3 -> svc-4 (max depth 3)
  assert.equal(
    result.truncated,
    undefined,
    "no truncation for short chain within depth limit",
  );
  assert.ok(
    result.results.length >= 3,
    "all services in short chain should be returned",
  );
});

// ─────────────────────────────────────────────────────────────
// openDb() stack trace (ERR-02 / LOG-03)
// ─────────────────────────────────────────────────────────────

import { openDb } from "./server.js";

test("openDb: returns null without throwing when DB path is a directory (unreadable)", async () => {
  // Point LIGAMEN_DB_PATH at a directory (unreadable as a SQLite DB)
  // openDb() should catch the error, call logger.error, and return null
  const prevPath = process.env.LIGAMEN_DB_PATH;
  const prevExist = process.env.LIGAMEN_DB_PATH;
  // Use os.tmpdir() which always exists but is a directory, not a file
  // openDb() checks existsSync first, so use a real file path that is a dir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ligamen-opendb-test-"));
  // Create a fake file named "impact-map.db" that is actually not valid SQLite
  const fakeDb = path.join(tmpDir, "impact-map.db");
  fs.writeFileSync(fakeDb, "this is not sqlite", "utf8");
  process.env.LIGAMEN_DB_PATH = fakeDb;
  let result;
  assert.doesNotThrow(() => {
    result = openDb();
  }, "openDb should not throw even on invalid DB file");
  // Result is either null (caught error) or a db object — the key contract is no throw
  assert.ok(result === null || typeof result === "object", "openDb should return null or db object");
  if (prevExist === undefined) {
    delete process.env.LIGAMEN_DB_PATH;
  } else {
    process.env.LIGAMEN_DB_PATH = prevPath;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// querySearch FTS5 error path (ERR-02 / LOG-03)
// ─────────────────────────────────────────────────────────────

import { querySearch } from "./server.js";

test("querySearch: falls back to SQL LIKE when FTS5 table is missing (no throw)", async () => {
  // Create a DB without connections_fts table — triggers the FTS5 error path
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE repos (id INTEGER PRIMARY KEY, path TEXT, name TEXT, type TEXT, last_commit TEXT, scanned_at TEXT);
    CREATE TABLE services (id INTEGER PRIMARY KEY, repo_id INTEGER, name TEXT, root_path TEXT, language TEXT);
    CREATE TABLE connections (id INTEGER PRIMARY KEY, source_service_id INTEGER, target_service_id INTEGER,
      protocol TEXT, method TEXT, path TEXT, source_file TEXT, target_file TEXT);
  `);
  db.prepare("INSERT INTO repos VALUES (1, '/r', 'r', 'mono', null, null)").run();
  db.prepare("INSERT INTO services VALUES (1, 1, 'svc-a', '/r/a', 'js')").run();
  db.prepare("INSERT INTO services VALUES (2, 1, 'svc-b', '/r/b', 'js')").run();
  db.prepare("INSERT INTO connections VALUES (1, 1, 2, 'http', 'GET', '/api/test', '/r/a/index.js', '/r/b/index.js')").run();

  let result;
  assert.doesNotThrow(async () => {
    result = await querySearch(db, { query: "test", limit: 10 });
  }, "querySearch should not throw on FTS5 error — falls back to SQL LIKE");
  result = await querySearch(db, { query: "test", limit: 10 });
  // Should have fallen back to SQL LIKE and found the connection
  assert.ok(result !== null && typeof result === "object", "querySearch should return a result object");
  assert.ok(Array.isArray(result.results), "results should be array");
  db.close();
});
