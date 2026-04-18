/**
 * Tests for getQueryEngineByRepo in worker/db/pool.js
 * Run: node --test worker/db/pool-repo.test.js
 *
 * Creates two temporary SQLite DBs in temp dirs with different repo names,
 * verifies that getQueryEngineByRepo returns the correct engine for each.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────
// Helpers to create isolated test environments
// ─────────────────────────────────────────────────────────────

/**
 * Create a minimal SQLite DB in the given directory with a repos table
 * containing one row with the specified repo name.
 */
function createProjectDb(dir, repoName, repoPath) {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "impact-map.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  // Full schema matching migration 005 (all columns required by QueryEngine constructor)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      last_commit TEXT,
      scanned_at TEXT
    );
    CREATE TABLE IF NOT EXISTS scan_versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id      INTEGER NOT NULL REFERENCES repos(id),
      started_at   TEXT    NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS services (
      id              INTEGER PRIMARY KEY,
      repo_id         INTEGER REFERENCES repos(id),
      name            TEXT NOT NULL,
      root_path       TEXT,
      language        TEXT,
      type            TEXT NOT NULL DEFAULT 'service',
      canonical_name  TEXT,
      scan_version_id INTEGER REFERENCES scan_versions(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_services_repo_name ON services(repo_id, name);
    CREATE TABLE IF NOT EXISTS connections (
      id                 INTEGER PRIMARY KEY,
      source_service_id  INTEGER REFERENCES services(id),
      target_service_id  INTEGER REFERENCES services(id),
      protocol           TEXT,
      method             TEXT,
      path               TEXT,
      source_file        TEXT,
      target_file        TEXT,
      scan_version_id    INTEGER REFERENCES scan_versions(id)
    );
    CREATE TABLE IF NOT EXISTS exposed_endpoints (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id),
      method     TEXT,
      path       TEXT NOT NULL,
      handler    TEXT,
      UNIQUE(service_id, method, path)
    );
    CREATE TABLE IF NOT EXISTS schemas (
      id            INTEGER PRIMARY KEY,
      connection_id INTEGER REFERENCES connections(id),
      role          TEXT,
      name          TEXT,
      file          TEXT
    );
    CREATE TABLE IF NOT EXISTS fields (
      id        INTEGER PRIMARY KEY,
      schema_id INTEGER REFERENCES schemas(id),
      name      TEXT,
      type      TEXT,
      required  INTEGER
    );
    CREATE TABLE IF NOT EXISTS map_versions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    TEXT NOT NULL,
      label         TEXT,
      snapshot_path TEXT
    );
    CREATE TABLE IF NOT EXISTS repo_state (
      repo_id            INTEGER PRIMARY KEY REFERENCES repos(id),
      last_scanned_commit TEXT,
      last_scanned_at    TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS services_fts USING fts5(
      name,
      content=services,
      content_rowid=id
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS connections_fts USING fts5(
      path, protocol, source_file, target_file,
      content=connections,
      content_rowid=id
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS fields_fts USING fts5(
      name,
      content=fields,
      content_rowid=id
    );
  `);
  // Mark all migrations applied up to version 5 so getQueryEngineByHash inline
  // migration workaround (which only covers v1-v3) skips cleanly.
  db.prepare("INSERT INTO schema_versions (version, applied_at) VALUES (?, datetime('now'))").run(5);
  db.prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, ?)").run(
    repoPath,
    repoName,
    "monorepo",
  );
  // Add a service so listProjects() filter (serviceCount > 0) doesn't exclude it
  db.prepare(
    "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, ?, ?, ?)",
  ).run(1, `${repoName}-service`, repoPath, "javascript");
  db.close();
  return dbPath;
}

/**
 * Compute the project hash dir path for a given projectRoot — same as pool.js.
 */
function projectHashDir(dataDir, projectRoot) {
  const hash = crypto
    .createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 12);
  return path.join(dataDir, "projects", hash);
}

// ─────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────

test("getQueryEngineByRepo: returns correct engine for repo-A", async () => {
  // Create isolated data dir
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ligamen-test-"));
  const rootA = "/fake/project-alpha";
  const hashDirA = projectHashDir(dataDir, rootA);
  createProjectDb(hashDirA, "repo-alpha", rootA);

  // Override env so pool.js uses our temp data dir
  process.env.LIGAMEN_DATA_DIR = dataDir;

  // Import fresh — use dynamic import to get a clean module state
  // We use a cache-bust trick via URL query param (works in Node ESM)
  const { getQueryEngineByRepo } = await import(
    `./pool.js?t=${Date.now()}-1`
  );

  const qe = await getQueryEngineByRepo("repo-alpha");
  assert.ok(qe !== null, "should find engine for repo-alpha");

  // Cleanup
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.LIGAMEN_DATA_DIR;
});

test("getQueryEngineByRepo: returns null for unknown repo name", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ligamen-test-"));
  const rootA = "/fake/project-beta";
  const hashDirA = projectHashDir(dataDir, rootA);
  createProjectDb(hashDirA, "repo-beta", rootA);

  process.env.LIGAMEN_DATA_DIR = dataDir;

  const { getQueryEngineByRepo } = await import(
    `./pool.js?t=${Date.now()}-2`
  );

  const qe = await getQueryEngineByRepo("unknown-repo-xyz");
  assert.equal(qe, null, "should return null for unknown repo name");

  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.LIGAMEN_DATA_DIR;
});

test("getQueryEngineByRepo: returns correct engine when two projects exist", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ligamen-test-"));
  const rootA = "/fake/multi-project-A";
  const rootB = "/fake/multi-project-B";
  const hashDirA = projectHashDir(dataDir, rootA);
  const hashDirB = projectHashDir(dataDir, rootB);
  createProjectDb(hashDirA, "repo-multi-A", rootA);
  createProjectDb(hashDirB, "repo-multi-B", rootB);

  process.env.LIGAMEN_DATA_DIR = dataDir;

  const { getQueryEngineByRepo } = await import(
    `./pool.js?t=${Date.now()}-3`
  );

  const qeA = await getQueryEngineByRepo("repo-multi-A");
  const qeB = await getQueryEngineByRepo("repo-multi-B");
  assert.ok(qeA !== null, "should find engine for repo-multi-A");
  assert.ok(qeB !== null, "should find engine for repo-multi-B");
  // They should be distinct engines
  assert.notEqual(qeA, qeB, "engines for different repos should be distinct");

  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.LIGAMEN_DATA_DIR;
});

test("getQueryEngineByRepo: case-insensitive lookup finds repo", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ligamen-test-"));
  const rootA = "/fake/case-project";
  const hashDirA = projectHashDir(dataDir, rootA);
  createProjectDb(hashDirA, "Repo-Case", rootA);

  process.env.LIGAMEN_DATA_DIR = dataDir;

  const { getQueryEngineByRepo } = await import(
    `./pool.js?t=${Date.now()}-4`
  );

  const qe = await getQueryEngineByRepo("repo-case");
  assert.ok(qe !== null, "case-insensitive lookup should find Repo-Case");

  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.LIGAMEN_DATA_DIR;
});
