/**
 * worker/query-engine-search.test.js — Tests for the standalone search() export in query-engine.js
 *
 * Tests verify:
 *   - search() returns an array (Tier 3 / SQL always reachable)
 *   - search() with skipChroma=true, skipFts5=true uses SQL tier
 *   - search() with skipChroma=true falls through to FTS5 or SQL
 *   - search() result shape: [{id, name, type, score}]
 *   - Each tier returns results when appropriate data exists
 *   - prepared statement cache (REL-04): reuse and LRU eviction
 *
 * Uses node:test + node:assert/strict — zero external dependencies.
 * Uses better-sqlite3 directly for isolation (per Phase 14-02 decision).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { search, _stmtCache, StmtCache } from "./query-engine.js";

// ---------------------------------------------------------------------------
// Test DB setup — use project root that maps to a temp dir
// ---------------------------------------------------------------------------

let db;
let tmpRoot;

before(async () => {
  // Create a temp project root dir to derive the DB path
  tmpRoot = mkdtempSync(join(tmpdir(), "arcanon-search-test-"));

  // Derive the DB path the same way openDb() does
  const hash = createHash("sha256").update(tmpRoot).digest("hex").slice(0, 12);
  const dbDir = join(homedir(), ".arcanon", "projects", hash);

  // Use better-sqlite3 directly (Phase 14-02 decision: avoid singleton isolation issues)
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Apply initial schema inline (mirrors 001_initial_schema migration)
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
      last_commit TEXT, scanned_at TEXT
    );
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id),
      name TEXT NOT NULL, root_path TEXT NOT NULL, language TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_service_id INTEGER NOT NULL REFERENCES services(id),
      target_service_id INTEGER NOT NULL REFERENCES services(id),
      protocol TEXT NOT NULL, method TEXT, path TEXT, source_file TEXT, target_file TEXT
    );
    CREATE TABLE IF NOT EXISTS schemas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL REFERENCES connections(id),
      role TEXT NOT NULL, name TEXT NOT NULL, file TEXT
    );
    CREATE TABLE IF NOT EXISTS fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schema_id INTEGER NOT NULL REFERENCES schemas(id),
      name TEXT NOT NULL, type TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS services_fts USING fts5(
      name, content='services', content_rowid='id'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS connections_fts USING fts5(
      path, protocol, source_file, target_file,
      content='connections', content_rowid='id'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS fields_fts USING fts5(
      name, type, content='fields', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS services_ai AFTER INSERT ON services BEGIN
      INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
    END;
    CREATE TRIGGER IF NOT EXISTS services_ad AFTER DELETE ON services BEGIN
      INSERT INTO services_fts(services_fts, rowid, name) VALUES ('delete', old.id, old.name);
    END;
    CREATE TRIGGER IF NOT EXISTS services_au AFTER UPDATE ON services BEGIN
      INSERT INTO services_fts(services_fts, rowid, name) VALUES ('delete', old.id, old.name);
      INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
    END;
  `);

  // Seed test data
  db.prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, ?)").run(
    "/test",
    "test",
    "single",
  );
  const repoId = db.prepare("SELECT last_insert_rowid() AS id").pluck().get();
  db.prepare(
    "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, ?, ?, ?)",
  ).run(repoId, "payment-service", ".", "typescript");
  db.prepare(
    "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, ?, ?, ?)",
  ).run(repoId, "auth-service", ".", "go");

  // Inject the db instance into the search module (via setSearchDb)
  const { setSearchDb } = await import("./query-engine.js");
  setSearchDb(db);
});

after(() => {
  if (db) db.close();
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {}
});

// ---------------------------------------------------------------------------
// search() return shape
// ---------------------------------------------------------------------------

describe("search() — return shape", () => {
  test("returns an array", async () => {
    const results = await search("payment-service", {
      skipChroma: true,
      skipFts5: true,
    });
    assert.ok(Array.isArray(results), "search must return an array");
  });

  test("each result has id, name, type, score", async () => {
    const results = await search("payment-service", {
      skipChroma: true,
      skipFts5: true,
    });
    for (const r of results) {
      assert.ok("id" in r, "result must have id");
      assert.ok("name" in r, "result must have name");
      assert.ok("type" in r, "result must have type");
      assert.ok("score" in r, "result must have score");
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — SQL direct filter (skipChroma+skipFts5)
// ---------------------------------------------------------------------------

describe("search() — Tier 3 (SQL)", () => {
  test("skipChroma+skipFts5 forces SQL tier", async () => {
    const results = await search("payment", {
      skipChroma: true,
      skipFts5: true,
    });
    assert.ok(Array.isArray(results), "must return array for SQL tier");
    // payment-service should be found via SQL LIKE
    const names = results.map((r) => r.name);
    assert.ok(
      names.some((n) => n.includes("payment")),
      "payment-service should appear in SQL results",
    );
  });

  test("SQL tier result score is 0.5", async () => {
    const results = await search("payment", {
      skipChroma: true,
      skipFts5: true,
    });
    for (const r of results) {
      assert.equal(r.score, 0.5, "SQL tier score must be 0.5");
    }
  });

  test("returns empty array for non-matching query via SQL", async () => {
    const results = await search("xyzzy-does-not-exist-12345", {
      skipChroma: true,
      skipFts5: true,
    });
    assert.ok(Array.isArray(results), "must return array even when no matches");
    assert.equal(results.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — FTS5 (skipChroma only)
// ---------------------------------------------------------------------------

describe("search() — Tier 2 (FTS5)", () => {
  test("skipChroma=true uses FTS5 tier when available", async () => {
    const results = await search("auth", { skipChroma: true });
    assert.ok(Array.isArray(results), "must return array from FTS5 tier");
    // auth-service should be found via FTS5
    const names = results.map((r) => r.name);
    assert.ok(
      names.some((n) => n.includes("auth")),
      "auth-service should appear in FTS5 results",
    );
  });

  test("FTS5 tier result score is 1", async () => {
    const results = await search("auth", { skipChroma: true });
    // FTS5 results have score=1
    if (results.length > 0) {
      assert.equal(results[0].score, 1, "FTS5 tier score must be 1");
    }
  });

  test("falls through to SQL when FTS5 returns empty", async () => {
    // Query that won't match FTS5 but will match SQL LIKE
    // Use a partial query — FTS5 requires whole-word tokens, LIKE handles substrings
    const results = await search("payment", { skipChroma: true });
    assert.ok(
      Array.isArray(results),
      "must return array falling through to SQL",
    );
    // Either FTS5 or SQL found it
    assert.ok(results.length > 0, "payment-service must be found");
  });
});

// ---------------------------------------------------------------------------
// Tier 1 — ChromaDB (via isChromaAvailable flag)
// ---------------------------------------------------------------------------

describe("search() — Tier 1 (ChromaDB fallback when unavailable)", () => {
  test("when isChromaAvailable=false, falls through to FTS5/SQL automatically", async () => {
    // isChromaAvailable() returns false (no ChromaDB configured in tests)
    const results = await search("payment");
    assert.ok(
      Array.isArray(results),
      "must return array when chroma unavailable",
    );
    // Falls through to FTS5 or SQL
    assert.ok(results.length > 0, "must find results via fallback tiers");
  });
});

// ---------------------------------------------------------------------------
// prepared statement cache (REL-04)
// ---------------------------------------------------------------------------

describe("search() -- prepared statement cache (REL-04)", () => {
  test("reuses prepared statements for identical queries", async () => {
    // Clear the cache so we start from a known state
    _stmtCache.clear();
    assert.equal(_stmtCache.size, 0, "cache must start empty after clear()");

    // Run 100 consecutive identical FTS5 searches
    for (let i = 0; i < 100; i++) {
      await search("auth", { skipChroma: true });
    }

    // The FTS5 tier uses 1 SQL template; SQL fallback tier uses 1 SQL template.
    // At most 2 entries should be in the cache — not 100.
    assert.ok(
      _stmtCache.size <= 2,
      `cache should have at most 2 entries after 100 identical searches, got ${_stmtCache.size}`,
    );
    assert.ok(
      _stmtCache.size >= 1,
      "cache must have at least 1 entry after searches",
    );
  });

  test("LRU eviction at capacity", () => {
    // Create a fresh cache with capacity 3 to test eviction directly
    const cache = new StmtCache(3);
    // Use the shared in-memory db (already has the services table)
    const sql1 = "SELECT 1 AS n FROM services";
    const sql2 = "SELECT 2 AS n FROM services";
    const sql3 = "SELECT 3 AS n FROM services";
    const sql4 = "SELECT 4 AS n FROM services";

    cache.get(sql1, db);
    cache.get(sql2, db);
    cache.get(sql3, db);
    assert.equal(cache.size, 3, "cache should be at capacity after 3 inserts");

    // Insert 4th entry — should evict sql1 (oldest / least-recently-used)
    cache.get(sql4, db);
    assert.equal(cache.size, 3, "cache must not exceed capacity after eviction");

    // Re-request sql1: it was evicted, so a fresh prepare must occur.
    // The cache still stays at 3 (sql2 is now the oldest and gets evicted).
    cache.get(sql1, db);
    assert.equal(cache.size, 3, "cache size must remain 3 after re-inserting evicted key");
  });

  test("same SQL with different parameter values reuses the statement", async () => {
    _stmtCache.clear();

    // Call search with two different queries — both flow through the same SQL templates
    await search("auth", { skipChroma: true });
    const sizeAfterFirst = _stmtCache.size;

    await search("payment", { skipChroma: true });
    const sizeAfterSecond = _stmtCache.size;

    // Size must not have grown — same SQL templates are reused for different param values
    assert.equal(
      sizeAfterSecond,
      sizeAfterFirst,
      "different parameter values must reuse the same prepared statement (size unchanged)",
    );
  });
});
