/**
 * ISO-11 integration tests for worker/db/pool.js
 *
 * Uses REAL openDb() + REAL migration chain (not mocked resolvers, not
 * hand-rolled schema) and REAL per-project databases to prove:
 *
 *   ISO-01: two project roots opened in one worker get isolated DB handles;
 *           data written to project A is invisible from project B.
 *   ISO-02: the pool returns the same cached QueryEngine for repeated
 *           resolution of the same canonical path (cache hit), and for
 *           trailing-slash variants (normalization via path.resolve).
 *
 * Pattern (per pool-repo.test.js convention, 137-RESEARCH Pitfall 1):
 *   1. Set process.env.ARCANON_DATA_DIR to a mkdtemp'd dir.
 *   2. Seed each project DB via openDb(path.resolve(root)) — creates the file
 *      and runs the full real migration chain (ISO-11 requirement).
 *   3. `await import('./pool.js?t=...')` to cache-bust pool.js so its
 *      module-level `const dataDir = resolveDataDir()` captures the temp dir.
 *   4. Call getQueryEngine(root) — finds the seeded file, opens its own handle.
 *
 * Critical gotcha: getQueryEngine() returns null when impact-map.db does not
 * exist yet.  Always seed via openDb() BEFORE calling getQueryEngine().
 *
 * Run: node --test worker/db/pool.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./database.js";

// ─────────────────────────────────────────────────────────────
// ISO-01: cross-project isolation
// ─────────────────────────────────────────────────────────────

test("ISO-01: two project roots yield independent DB handles; A's data invisible from B", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-iso01-"));

  // Set ARCANON_DATA_DIR BEFORE seeding so openDb() hashes into this dir.
  process.env.ARCANON_DATA_DIR = dataDir;

  const rootA = path.join(dataDir, "project-a");
  const rootB = path.join(dataDir, "project-b");
  fs.mkdirSync(rootA, { recursive: true });
  fs.mkdirSync(rootB, { recursive: true });

  // Seed both DBs via the REAL openDb() + REAL migration chain (ISO-11).
  // This creates <dataDir>/projects/<hashA>/impact-map.db and <hashB>/impact-map.db.
  const seedA = openDb(path.resolve(rootA));
  const seedB = openDb(path.resolve(rootB));
  // Close seed handles — getQueryEngine() will open its own pooled handle.
  seedA.close();
  seedB.close();

  // Cache-bust: pool.js evaluates `const dataDir = resolveDataDir()` at import
  // time, so we must import AFTER setting ARCANON_DATA_DIR (Pitfall 1).
  const { getQueryEngine } = await import(`./pool.js?t=${Date.now()}`);

  const qeA = getQueryEngine(rootA);
  const qeB = getQueryEngine(rootB);

  // Both engines must resolve to non-null handles.
  assert.ok(qeA, "engine A resolved (DB file exists, openDb ran migrations)");
  assert.ok(qeB, "engine B resolved (DB file exists, openDb ran migrations)");

  // ISO-01: the two handles must point to different DB files.
  assert.notEqual(
    qeA._db.name,
    qeB._db.name,
    "project A and B must use different DB file paths",
  );

  // ISO-01: data written to A must be invisible from B.
  qeA.upsertRepo({ path: rootA, name: "repo-A", type: "service" });
  const row = qeB._db
    .prepare("SELECT COUNT(*) AS n FROM repos WHERE name = ?")
    .get("repo-A");
  assert.strictEqual(
    row.n,
    0,
    "repo-A written to project A must not appear in project B's database",
  );

  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.ARCANON_DATA_DIR;
});

// ─────────────────────────────────────────────────────────────
// ISO-02: cache hit on repeated resolution
// ─────────────────────────────────────────────────────────────

test("ISO-02: repeated getQueryEngine() calls for the same root return the same cached QE instance", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-iso02a-"));
  process.env.ARCANON_DATA_DIR = dataDir;

  const rootC = path.join(dataDir, "project-c");
  fs.mkdirSync(rootC, { recursive: true });

  // Seed via real openDb() + real migrations (ISO-11).
  const seed = openDb(path.resolve(rootC));
  seed.close();

  // Fresh pool — unique cache-bust key so this test is isolated from others.
  const { getQueryEngine } = await import(`./pool.js?t=${Date.now()}-cache`);

  const qe1 = getQueryEngine(rootC);
  const qe2 = getQueryEngine(rootC);

  assert.ok(qe1, "first resolution must return a non-null QE");
  // ISO-02: must be the same cached object (pool hit, not a new handle).
  assert.strictEqual(qe1, qe2, "repeated resolution must return the same QE instance");
  assert.strictEqual(
    qe1._db.name,
    qe2._db.name,
    "both calls must reference the same DB handle",
  );

  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.ARCANON_DATA_DIR;
});

// ─────────────────────────────────────────────────────────────
// ISO-02: trailing-slash normalization
// ─────────────────────────────────────────────────────────────

test("ISO-02: trailing-slash variant of a project root resolves to the same pool entry", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-iso02b-"));
  process.env.ARCANON_DATA_DIR = dataDir;

  const rootD = path.join(dataDir, "project-d");
  fs.mkdirSync(rootD, { recursive: true });

  // Seed via real openDb() + real migrations.
  const seed = openDb(path.resolve(rootD));
  seed.close();

  // Fresh pool — unique cache-bust key.
  const { getQueryEngine } = await import(`./pool.js?t=${Date.now()}-slash`);

  const qeCanon = getQueryEngine(rootD);
  // path.resolve(rootD + "/") strips the trailing slash → same dbPath → same pool entry.
  const qeTrailing = getQueryEngine(rootD + "/");

  assert.ok(qeCanon, "canonical path must resolve to a non-null QE");
  assert.ok(qeTrailing, "trailing-slash path must resolve to a non-null QE");
  assert.strictEqual(
    qeCanon,
    qeTrailing,
    "canonical and trailing-slash paths must return the same cached QE instance",
  );

  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.ARCANON_DATA_DIR;
});
