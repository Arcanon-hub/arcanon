/**
 * Tests for createSnapshot() and isFirstScan() in worker/db/database.js
 * Run: node --test worker/db/snapshot.test.js
 *
 * Phase 137 / ISO-01: isFirstScan(db) and createSnapshot(db, label) now take
 * an explicit db handle (the singleton was removed). Each describe block opens
 * its own handle via openDb() and threads it through all assertions.
 *
 * Phase 139 / ISO-06: createSnapshot extended to createSnapshot(db, label, kind, repos).
 * Tests verify that the new columns (kind, repos_json) are correctly populated
 * and round-trip through the map_versions table.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────
// isFirstScan() — basic behavior
// ─────────────────────────────────────────────────────────────

describe("isFirstScan()", () => {
  let importedDb;
  let db;
  let testRoot;

  before(async () => {
    testRoot = path.join(os.tmpdir(), "arcanon-snap-test-" + Date.now());
    fs.mkdirSync(testRoot, { recursive: true });
    importedDb = await import("./database.js");
    // Capture the handle returned by the factory — thread it through all tests.
    db = importedDb.openDb(testRoot);
  });

  after(() => {
    try { db.close(); } catch { /* already closed */ }
  });

  it("exports isFirstScan function", () => {
    assert.strictEqual(
      typeof importedDb.isFirstScan,
      "function",
      "isFirstScan must be exported",
    );
  });

  it("returns true before any snapshots exist", () => {
    const result = importedDb.isFirstScan(db);
    assert.strictEqual(
      result,
      true,
      "isFirstScan must return true when map_versions is empty",
    );
  });
});

// ─────────────────────────────────────────────────────────────
// createSnapshot() — core behavior
// ─────────────────────────────────────────────────────────────

describe("createSnapshot()", () => {
  let importedDb2;
  let testRoot2;
  let db2;

  before(async () => {
    testRoot2 = path.join(os.tmpdir(), "arcanon-snap-test2-" + Date.now());
    fs.mkdirSync(testRoot2, { recursive: true });
    importedDb2 = await import("./database.js");
    // Each describe block gets its own DB handle — no singleton dependency.
    db2 = importedDb2.openDb(testRoot2);
  });

  after(() => {
    try { db2.close(); } catch { /* already closed */ }
  });

  it("exports createSnapshot function", () => {
    assert.strictEqual(
      typeof importedDb2.createSnapshot,
      "function",
      "createSnapshot must be exported",
    );
  });

  it("returns a path to a .db file that exists after creation", () => {
    const snapshotPath = importedDb2.createSnapshot(db2, "test-label", "map", []);
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
    // A snapshot was created in the previous test; map_versions now has >= 1 row.
    const result = importedDb2.isFirstScan(db2);
    assert.strictEqual(
      result,
      false,
      "isFirstScan must return false after a snapshot exists",
    );
  });

  it("snapshot file is in a snapshots/ subdirectory", () => {
    const snapshotPath = importedDb2.createSnapshot(db2, "second-snapshot", "rescan", []);
    const snapshotDirName = path.basename(path.dirname(snapshotPath));
    assert.strictEqual(
      snapshotDirName,
      "snapshots",
      "snapshot must be in a snapshots/ subdirectory",
    );
  });

  it("snapshot is recorded in map_versions table", () => {
    // Use the explicit db2 handle instead of the removed getDb().
    const rows = db2.prepare("SELECT * FROM map_versions").all();
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

  it("kind column is populated correctly for map and rescan", () => {
    const snapshotPath = importedDb2.createSnapshot(db2, "map-run", "map", []);
    const row = db2
      .prepare("SELECT * FROM map_versions ORDER BY id DESC LIMIT 1")
      .get();
    assert.strictEqual(row.kind, "map", "kind must be 'map' when specified");

    importedDb2.createSnapshot(db2, "rescan-run", "rescan", []);
    const row2 = db2
      .prepare("SELECT * FROM map_versions ORDER BY id DESC LIMIT 1")
      .get();
    assert.strictEqual(row2.kind, "rescan", "kind must be 'rescan' when specified");
  });

  it("repos_json round-trips a [{path, scan_version_id}] array", () => {
    const repos = [
      { path: "/repo/a", scan_version_id: 42 },
      { path: "/repo/b", scan_version_id: 99 },
    ];
    importedDb2.createSnapshot(db2, "repos-test", "map", repos);
    const row = db2
      .prepare("SELECT * FROM map_versions ORDER BY id DESC LIMIT 1")
      .get();
    assert.ok(row.repos_json, "repos_json must be set");
    const parsed = JSON.parse(row.repos_json);
    assert.equal(parsed.length, 2, "repos_json has 2 entries");
    assert.equal(parsed[0].path, "/repo/a");
    assert.equal(parsed[0].scan_version_id, 42);
    assert.equal(parsed[1].path, "/repo/b");
    assert.equal(parsed[1].scan_version_id, 99);
  });
});

// ─────────────────────────────────────────────────────────────
// createSnapshot() — retention cleanup
// ─────────────────────────────────────────────────────────────

describe("createSnapshot() retention cleanup", () => {
  let importedDb3;
  let testRoot3;
  let db3;

  before(async () => {
    testRoot3 = path.join(os.tmpdir(), "arcanon-retention-test-" + Date.now());
    fs.mkdirSync(testRoot3, { recursive: true });
    importedDb3 = await import("./database.js");
    db3 = importedDb3.openDb(testRoot3);
  });

  after(() => {
    try { db3.close(); } catch { /* already closed */ }
  });

  it("retains at most 10 snapshots by default when creating 12 snapshots", async () => {
    // Create 12 snapshots — default retention is 10, so 2 oldest should be deleted.
    const paths = [];
    for (let i = 0; i < 12; i++) {
      // Small delay to ensure different timestamps in snapshot filenames.
      await new Promise((r) => setTimeout(r, 5));
      paths.push(importedDb3.createSnapshot(db3, `retention-test-${i}`, "map", []));
    }

    // Use the explicit db3 handle instead of the removed getDb().
    const rows = db3
      .prepare("SELECT * FROM map_versions ORDER BY created_at ASC")
      .all();
    assert.ok(
      rows.length <= 10,
      `Expected at most 10 rows in map_versions after cleanup, got ${rows.length}`,
    );

    // The 2 oldest snapshot files should NOT exist on disk.
    assert.ok(
      !fs.existsSync(paths[0]),
      `Oldest snapshot file should have been deleted: ${paths[0]}`,
    );
    assert.ok(
      !fs.existsSync(paths[1]),
      `Second oldest snapshot file should have been deleted: ${paths[1]}`,
    );

    // The most recent snapshot should still exist.
    const lastPath = paths[paths.length - 1];
    assert.ok(
      fs.existsSync(lastPath),
      `Most recent snapshot must still exist: ${lastPath}`,
    );
  });
});
