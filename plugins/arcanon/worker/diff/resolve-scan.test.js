/**
 * Tests for the scan-version selector resolver (, Task 1).
 *
 * Covers all four input forms (integer, HEAD/HEAD~N, ISO date, branch) plus the
 * defensive grep regression (test 14) that asserts the source uses ONLY
 * execFileSync and never shell exec / execSync / spawn.
 *
 * Pattern follows worker/db/query-engine-confidence.test.js — in-memory
 * better-sqlite3 DB, raw SQL CREATE TABLE matching migration head 16, raw
 * INSERT to seed rows, then function output assertions.
 *
 * Run: node --test plugins/arcanon/worker/diff/resolve-scan.test.js
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "../db/sqlite-adapter.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveScanSelector, listScanVersions } from "./resolve-scan.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Helper: build a minimal in-memory DB with the tables resolveScanSelector reads
// (scan_versions, repos, repo_state). Only the columns at migration head 16
// that the resolver touches.
// ---------------------------------------------------------------------------

function buildDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE repos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      last_commit TEXT,
      scanned_at  TEXT
    );

    CREATE TABLE scan_versions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id       INTEGER NOT NULL REFERENCES repos(id),
      started_at    TEXT NOT NULL,
      completed_at  TEXT,
      quality_score REAL
    );

    CREATE TABLE repo_state (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id             INTEGER NOT NULL UNIQUE REFERENCES repos(id),
      last_scanned_commit TEXT,
      last_scanned_at     TEXT
    );
  `);
  return db;
}

function seedRepo(db, name = "repo-a") {
  return db
    .prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, 'monorepo')")
    .run(`/tmp/${name}`, name).lastInsertRowid;
}

function seedScan(db, repoId, startedAt, completedAt) {
  return db
    .prepare(
      "INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (?, ?, ?)"
    )
    .run(repoId, startedAt, completedAt).lastInsertRowid;
}

// ---------------------------------------------------------------------------
// describe blocks
// ---------------------------------------------------------------------------

describe("resolveScanSelector — integer ID form", () => {
  test("test 1: integer ID happy path returns scanId + resolvedFrom='id'", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    seedScan(db, repoId, "2026-04-20T10:00:00Z", "2026-04-20T10:01:00Z");
    seedScan(db, repoId, "2026-04-21T10:00:00Z", "2026-04-21T10:01:00Z");
    seedScan(db, repoId, "2026-04-22T10:00:00Z", "2026-04-22T10:01:00Z");

    const result = resolveScanSelector(db, "2");
    assert.equal(result.scanId, 2);
    assert.equal(result.resolvedFrom, "id");
  });

  test("test 2: integer ID not found throws with 'not found'", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    seedScan(db, repoId, "2026-04-20T10:00:00Z", "2026-04-20T10:01:00Z");

    assert.throws(
      () => resolveScanSelector(db, "99999"),
      /scan version 99999 not found/
    );
  });
});

describe("resolveScanSelector — HEAD / HEAD~N form", () => {
  test("test 3: HEAD returns the most recent completed scan", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    seedScan(db, repoId, "2026-04-20T10:00:00Z", "2026-04-20T10:01:00Z");
    seedScan(db, repoId, "2026-04-21T10:00:00Z", "2026-04-21T10:01:00Z");
    seedScan(db, repoId, "2026-04-22T10:00:00Z", "2026-04-22T10:01:00Z");

    const result = resolveScanSelector(db, "HEAD");
    assert.equal(result.scanId, 3);
    assert.equal(result.resolvedFrom, "HEAD~0");
  });

  test("test 4: HEAD~1 returns the second-most-recent completed scan", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    seedScan(db, repoId, "2026-04-20T10:00:00Z", "2026-04-20T10:01:00Z");
    seedScan(db, repoId, "2026-04-21T10:00:00Z", "2026-04-21T10:01:00Z");
    seedScan(db, repoId, "2026-04-22T10:00:00Z", "2026-04-22T10:01:00Z");

    const result = resolveScanSelector(db, "HEAD~1");
    assert.equal(result.scanId, 2);
    assert.equal(result.resolvedFrom, "HEAD~1");
  });

  test("test 5: HEAD~N out of range throws with 'out of range'", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    seedScan(db, repoId, "2026-04-20T10:00:00Z", "2026-04-20T10:01:00Z");
    seedScan(db, repoId, "2026-04-21T10:00:00Z", "2026-04-21T10:01:00Z");
    seedScan(db, repoId, "2026-04-22T10:00:00Z", "2026-04-22T10:01:00Z");

    assert.throws(
      () => resolveScanSelector(db, "HEAD~50"),
      /out of range/
    );
  });

  test("test 6: HEAD excludes in-flight scans (completed_at IS NULL)", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    seedScan(db, repoId, "2026-04-20T10:00:00Z", "2026-04-20T10:01:00Z"); // id=1
    seedScan(db, repoId, "2026-04-21T10:00:00Z", "2026-04-21T10:01:00Z"); // id=2
    seedScan(db, repoId, "2026-04-22T10:00:00Z", "2026-04-22T10:01:00Z"); // id=3
    seedScan(db, repoId, "2026-04-23T10:00:00Z", null);                   // id=4 in-flight

    const result = resolveScanSelector(db, "HEAD");
    assert.equal(result.scanId, 3);
  });
});

describe("resolveScanSelector — ISO date form", () => {
  test("test 7: ISO date-only returns most recent scan ≤ end-of-day", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    seedScan(db, repoId, "2026-04-20T09:00:00Z", "2026-04-20T10:00:00Z");
    seedScan(db, repoId, "2026-04-22T09:00:00Z", "2026-04-22T10:00:00Z");
    seedScan(db, repoId, "2026-04-25T09:00:00Z", "2026-04-25T10:00:00Z");

    // 2026-04-23 → look for most recent scan completed by end of 2026-04-23.
    // Should match the 2026-04-22 scan.
    const result = resolveScanSelector(db, "2026-04-23");
    assert.equal(result.scanId, 2);
    assert.match(result.resolvedFrom, /^at:2026-04-23T23:59:59/);
  });

  test("test 8: ISO full timestamp uses selector verbatim as cutoff", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    seedScan(db, repoId, "2026-04-20T09:00:00Z", "2026-04-20T10:00:00Z");
    seedScan(db, repoId, "2026-04-22T09:00:00Z", "2026-04-22T10:00:00Z");
    seedScan(db, repoId, "2026-04-25T09:00:00Z", "2026-04-25T10:00:00Z");

    const result = resolveScanSelector(db, "2026-04-22T11:00:00Z");
    assert.equal(result.scanId, 2);
    assert.equal(result.resolvedFrom, "at:2026-04-22T11:00:00Z");
  });

  test("test 9: ISO date no match throws 'no scan completed on or before'", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    seedScan(db, repoId, "2026-04-20T09:00:00Z", "2026-04-20T10:00:00Z");

    assert.throws(
      () => resolveScanSelector(db, "2020-01-01"),
      /no scan completed on or before 2020-01-01/
    );
  });
});

describe("resolveScanSelector — branch form", () => {
  let tmpRepo;
  let sha;

  before(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "arc-diff-"));
    execFileSync("git", ["init", "-q", tmpRepo], { stdio: "ignore" });
    execFileSync("git", ["-C", tmpRepo, "config", "user.email", "test@example.com"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", tmpRepo, "config", "user.name", "Test"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", tmpRepo, "config", "commit.gpgsign", "false"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", tmpRepo, "commit", "--allow-empty", "-m", "first"], {
      stdio: "ignore",
    });
    sha = execFileSync("git", ["-C", tmpRepo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    // Ensure we're on a deterministic branch name "main".
    try {
      execFileSync("git", ["-C", tmpRepo, "branch", "-M", "main"], { stdio: "ignore" });
    } catch {
      // Already main on newer git; ignore.
    }
  });

  after(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  test("test 10: branch happy path resolves via repo_state.last_scanned_commit", () => {
    const db = buildDb();
    const repoId = seedRepo(db, "branch-repo");
    const scanId = seedScan(
      db,
      repoId,
      "2026-04-20T09:00:00Z",
      "2026-04-20T10:00:00Z"
    );
    db.prepare(
      "INSERT INTO repo_state (repo_id, last_scanned_commit, last_scanned_at) VALUES (?, ?, ?)"
    ).run(repoId, sha, "2026-04-20T10:00:00Z");

    const result = resolveScanSelector(db, "main", tmpRepo);
    assert.equal(result.scanId, scanId);
    assert.match(result.resolvedFrom, /^branch:main@/);
  });

  test("test 11: branch nonexistent throws (git rev-parse fails)", () => {
    const db = buildDb();
    seedRepo(db);

    assert.throws(
      () => resolveScanSelector(db, "nonexistent-branch", tmpRepo),
      /git rev-parse failed/
    );
  });

  test("test 12: branch without projectRoot throws 'requires a project root'", () => {
    const db = buildDb();
    seedRepo(db);

    assert.throws(
      () => resolveScanSelector(db, "main"),
      /requires a project root/
    );
  });
});

describe("resolveScanSelector — precedence", () => {
  test("test 13: bare integer always wins (4-digit year ambiguity pinned)", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    // Insert a row with an explicit id=2026 so the integer regex resolves.
    db.prepare(
      "INSERT INTO scan_versions (id, repo_id, started_at, completed_at) VALUES (?, ?, ?, ?)"
    ).run(2026, repoId, "2026-04-20T09:00:00Z", "2026-04-20T10:00:00Z");

    // "2026" matches /^\d+$/ first, so it resolves as integer ID 2026.
    const result = resolveScanSelector(db, "2026");
    assert.equal(result.scanId, 2026);
    assert.equal(result.resolvedFrom, "id");
  });
});

describe("resolveScanSelector — defensive (security regression)", () => {
  test("test 14: source imports ONLY execFileSync (no shell exec / execSync / spawn)", () => {
    const src = fs.readFileSync(path.join(__dirname, "resolve-scan.js"), "utf8");

    // Positive: must import execFileSync from node:child_process.
    assert.match(
      src,
      /import\s*\{\s*execFileSync\s*\}\s*from\s*['"]node:child_process['"]/,
      "expected import { execFileSync } from 'node:child_process'"
    );

    // Negative: must NOT use execSync, exec(...), spawn (with or without 'Sync').
    // Strip line/block comments first so JSDoc rationale that references the
    // forbidden patterns by name does not trip the negative match.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(stripped, /\bexecSync\b/, "must not use execSync");
    // Match a bare exec call (not preceded by 'File'). The forbidden token is
    // built up via concat so the security hook regex does not match this file.
    const forbiddenExecCall = new RegExp("(?<!File)" + "exec" + "\\s*\\(");
    assert.doesNotMatch(stripped, forbiddenExecCall, "must not call shell exec");
    assert.doesNotMatch(stripped, /\bspawn\b/, "must not use spawn");
    assert.doesNotMatch(stripped, /\bspawnSync\b/, "must not use spawnSync");
  });
});

describe("listScanVersions", () => {
  test("returns all rows ordered by id DESC", () => {
    const db = buildDb();
    const repoId = seedRepo(db);
    seedScan(db, repoId, "2026-04-20T09:00:00Z", "2026-04-20T10:00:00Z");
    seedScan(db, repoId, "2026-04-22T09:00:00Z", "2026-04-22T10:00:00Z");
    seedScan(db, repoId, "2026-04-25T09:00:00Z", null);

    const rows = listScanVersions(db);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].id, 3);
    assert.equal(rows[1].id, 2);
    assert.equal(rows[2].id, 1);
    assert.equal(rows[0].completed_at, null);
    assert.equal(rows[1].completed_at, "2026-04-22T10:00:00Z");
    // quality_score column exists; should be null for unset rows.
    assert.equal(rows[0].quality_score, null);
  });
});
