/**
 * Tests for createSnapshot() and isFirstScan() in worker/db.js
 * Run: node --test worker/db-snapshot.test.js
 *
 * TDD RED phase: these tests are written before the implementation.
 * They test the snapshot behavior described in INTG-06.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

// We import from db.js but need to test snapshot functions specifically.
// Since db.js is a singleton, we use a temp projectRoot for isolation.
// NOTE: isFirstScan and createSnapshot are not yet exported — these tests FAIL in RED phase.

let testRoot;
let snapshotsDir;
let projectHash;
let dbDir;

// Helper to reset module singleton between tests (not possible with ESM cache)
// Instead we use a fresh testRoot for each describe block to get a fresh DB.

describe("isFirstScan()", () => {
  let importedDb;

  before(async () => {
    testRoot = path.join(os.tmpdir(), "ligamen-snap-test-" + Date.now());
    fs.mkdirSync(testRoot, { recursive: true });
    // Import db.js fresh — ESM caches, so we rely on isFirstScan checking map_versions
    importedDb = await import("./database.js");
    // Open the DB for testRoot
    importedDb.openDb(testRoot);
  });

  it("exports isFirstScan function", () => {
    assert.strictEqual(
      typeof importedDb.isFirstScan,
      "function",
      "isFirstScan must be exported",
    );
  });

  it("returns true before any snapshots exist", () => {
    const result = importedDb.isFirstScan();
    assert.strictEqual(
      result,
      true,
      "isFirstScan must return true when map_versions is empty",
    );
  });
});

describe("createSnapshot()", () => {
  let importedDb2;
  let testRoot2;

  before(async () => {
    // Use a different timestamp to get a fresh test root but same ESM module
    testRoot2 = path.join(os.tmpdir(), "ligamen-snap-test2-" + Date.now());
    fs.mkdirSync(testRoot2, { recursive: true });
    // Import module (already cached from previous describe)
    importedDb2 = await import("./database.js");
  });

  it("exports createSnapshot function", () => {
    assert.strictEqual(
      typeof importedDb2.createSnapshot,
      "function",
      "createSnapshot must be exported",
    );
  });

  it("returns a path to a .db file that exists after creation", () => {
    const snapshotPath = importedDb2.createSnapshot("test-label");
    assert.ok(
      typeof snapshotPath === "string",
      "createSnapshot must return a string path",
    );
    assert.ok(snapshotPath.endsWith(".db"), "snapshot path must end with .db");
    assert.ok(
      fs.existsSync(snapshotPath),
      `snapshot file must exist at: ${snapshotPath}`,
    );
  });

  it("isFirstScan returns false after a snapshot exists", () => {
    const result = importedDb2.isFirstScan();
    assert.strictEqual(
      result,
      false,
      "isFirstScan must return false after a snapshot exists",
    );
  });

  it("snapshot file is in a snapshots/ subdirectory", () => {
    const snapshotPath = importedDb2.createSnapshot("second-snapshot");
    const snapshotDirName = path.basename(path.dirname(snapshotPath));
    assert.strictEqual(
      snapshotDirName,
      "snapshots",
      "snapshot must be in a snapshots/ subdirectory",
    );
  });

  it("snapshot is recorded in map_versions table", () => {
    const db = importedDb2.getDb();
    const rows = db.prepare("SELECT * FROM map_versions").all();
    assert.ok(
      rows.length >= 2,
      `map_versions must have at least 2 rows, got ${rows.length}`,
    );
    assert.ok(
      rows[0].snapshot_path,
      "snapshot_path must be set in map_versions",
    );
    assert.ok(
      rows[0].snapshot_path.startsWith("snapshots/"),
      "snapshot_path must be relative (starts with snapshots/)",
    );
  });
});

describe("createSnapshot() retention cleanup", () => {
  let importedDb3;
  let testRoot3;

  before(async () => {
    testRoot3 = path.join(os.tmpdir(), "ligamen-retention-test-" + Date.now());
    fs.mkdirSync(testRoot3, { recursive: true });
    importedDb3 = await import("./database.js");
  });

  it("retains at most 10 snapshots by default when creating 12 snapshots", async () => {
    // Create 12 snapshots — default retention is 10, so 2 oldest should be deleted
    const paths = [];
    for (let i = 0; i < 12; i++) {
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 5));
      paths.push(importedDb3.createSnapshot(`retention-test-${i}`));
    }

    const db = importedDb3.getDb();
    const rows = db
      .prepare("SELECT * FROM map_versions ORDER BY created_at ASC")
      .all();
    assert.ok(
      rows.length <= 10,
      `Expected at most 10 rows in map_versions after cleanup, got ${rows.length}`,
    );

    // The 2 oldest snapshot files should NOT exist
    assert.ok(
      !fs.existsSync(paths[0]),
      `Oldest snapshot file should have been deleted: ${paths[0]}`,
    );
    assert.ok(
      !fs.existsSync(paths[1]),
      `Second oldest snapshot file should have been deleted: ${paths[1]}`,
    );

    // The most recent snapshots should still exist
    const lastPath = paths[paths.length - 1];
    assert.ok(
      fs.existsSync(lastPath),
      `Most recent snapshot must still exist: ${lastPath}`,
    );
  });
});
