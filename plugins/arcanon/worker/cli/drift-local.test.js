/**
 * worker/cli/drift-local.test.js
 *
 * Behavioral tests for drift-local.js covering:
 *
 * Part A — SQL helper regression guards (142-01 fixes):
 *   - connectionsForVersion() resolves target service names via JOIN
 *   - listVersions() returns only completed rows, exposes started_at
 *   - servicesForVersion() returns inserted services
 *
 * Part B — Snapshot routing (142-02 / INTG-01):
 *   - runDrift() routes through snapshot DBs when >=2 map_versions rows
 *     with snapshot_path + repos_json exist
 *   - Correct added/removed counts from diffScanVersions
 *   - Fallback A: <2 snapshot rows → guidance message (exit 0)
 *   - Fallback B: rows present but no repos_json → calls live-DB path
 *   - Path-traversal guard: absolute snapshot_path → skip with warning
 *
 * Uses node:test + node:assert/strict — zero external dependencies.
 * Snapshot DBs are real on-disk SQLite files in a mkdtemp directory.
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "../db/sqlite-adapter.js";
import { servicesForVersion, connectionsForVersion, listVersions, runDrift } from "./drift-local.js";

// ---------------------------------------------------------------------------
// Part A — Test DB setup (in-memory, 142-01 SQL regression guards)
// ---------------------------------------------------------------------------

let db;

/** Minimal migration-accurate schema for the live-DB helpers. */
const SCHEMA = `
  CREATE TABLE repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    last_commit TEXT,
    scanned_at TEXT
  );

  CREATE TABLE scan_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL REFERENCES repos(id),
    started_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL REFERENCES repos(id),
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    root_path TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'service',
    scan_version_id INTEGER REFERENCES scan_versions(id)
  );

  CREATE TABLE connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_service_id INTEGER NOT NULL REFERENCES services(id),
    target_service_id INTEGER NOT NULL REFERENCES services(id),
    protocol TEXT NOT NULL,
    method TEXT,
    path TEXT,
    scan_version_id INTEGER REFERENCES scan_versions(id)
  );
`;

before(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  // Insert a repo
  db.prepare(`INSERT INTO repos (path, name, type) VALUES (?, ?, ?)`)
    .run("/projects/myapp", "myapp", "monorepo");
  const repoId = 1;

  // Insert two scan_versions: one completed, one in-progress
  db.prepare(`INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (?, ?, ?)`)
    .run(repoId, "2026-06-01T10:00:00Z", "2026-06-01T10:05:00Z");  // id=1, completed
  db.prepare(`INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (?, ?, ?)`)
    .run(repoId, "2026-06-02T10:00:00Z", null);                      // id=2, in-progress

  const completedScanId = 1;

  // Insert two services for the completed scan
  db.prepare(
    `INSERT INTO services (repo_id, name, language, root_path, type, scan_version_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(repoId, "api-gateway", "TypeScript", "/projects/myapp/api", "service", completedScanId);
  db.prepare(
    `INSERT INTO services (repo_id, name, language, root_path, type, scan_version_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(repoId, "user-service", "TypeScript", "/projects/myapp/users", "service", completedScanId);
  // src id=1, tgt id=2

  // Insert one connection between them
  db.prepare(
    `INSERT INTO connections (source_service_id, target_service_id, protocol, method, path, scan_version_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(1, 2, "HTTP", "GET", "/users", completedScanId);
});

after(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Part A — connectionsForVersion
// ---------------------------------------------------------------------------

describe("connectionsForVersion", () => {
  test("resolves target service name via target_service_id JOIN (no target_name column)", () => {
    // This would throw "no such column: c.target_name" with the old query
    let rows;
    assert.doesNotThrow(() => {
      rows = connectionsForVersion(db, 1);
    }, "connectionsForVersion must not throw a missing-column error");

    assert.equal(rows.length, 1, "should return the one inserted connection");
    const row = rows[0];
    assert.equal(row.source, "api-gateway", "source must be resolved via source_service_id JOIN");
    assert.equal(row.target, "user-service", "target must be resolved via target_service_id JOIN");
    assert.equal(row.protocol, "HTTP");
    assert.equal(row.method, "GET");
    assert.equal(row.path, "/users");
  });

  test("returns empty array when no connections exist for the given scan version", () => {
    const rows = connectionsForVersion(db, 2);
    assert.deepEqual(rows, []);
  });

  test("returns empty array for a nonexistent scan version id", () => {
    const rows = connectionsForVersion(db, 999);
    assert.deepEqual(rows, []);
  });
});

describe("listVersions", () => {
  test("returns only completed scan_versions rows (completed_at IS NOT NULL)", () => {
    // This would throw "no such column: created_at" with the old query
    let rows;
    assert.doesNotThrow(() => {
      rows = listVersions(db);
    }, "listVersions must not throw a missing-column error");

    assert.equal(rows.length, 1, "only the completed scan version should be returned");
    assert.equal(rows[0].id, 1, "should be the completed version (id=1)");
  });

  test("exposes started_at (not created_at) on each returned row", () => {
    const rows = listVersions(db);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok("started_at" in row, "row must have started_at column");
    assert.equal(row.started_at, "2026-06-01T10:00:00Z");
    assert.ok(!("created_at" in row), "row must NOT have created_at (nonexistent column)");
  });

  test("orders results by id DESC", () => {
    // Insert a second completed version so ordering can be checked
    db.prepare(`INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (?, ?, ?)`)
      .run(1, "2026-06-03T10:00:00Z", "2026-06-03T10:06:00Z"); // id=3

    const rows = listVersions(db);
    assert.ok(rows.length >= 2, "should return at least two completed versions");
    assert.ok(rows[0].id > rows[1].id, "rows should be ordered by id DESC");

    // Clean up the extra row so other tests are unaffected
    db.prepare(`DELETE FROM scan_versions WHERE id = 3`).run();
  });
});

describe("servicesForVersion", () => {
  test("returns all services for a given scan_version_id", () => {
    let rows;
    assert.doesNotThrow(() => {
      rows = servicesForVersion(db, 1);
    });

    assert.equal(rows.length, 2, "should return both inserted services");
    const names = rows.map((r) => r.name).sort();
    assert.deepEqual(names, ["api-gateway", "user-service"]);
  });

  test("returns empty array for a scan_version_id with no services", () => {
    const rows = servicesForVersion(db, 999);
    assert.deepEqual(rows, []);
  });
});

// ---------------------------------------------------------------------------
// Part B — Snapshot routing (INTG-01)
// ---------------------------------------------------------------------------

/**
 * Minimal schema for snapshot DBs.
 * Must satisfy diffScanVersions → loadServices + loadConnections requirements.
 * loadServices selects: id, repo_id, name, root_path, language, type,
 *   owner, auth_mechanism, db_backend, boundary_entry, base_path
 * loadConnections: JOIN on services, selects protocol, protocol_raw, method,
 *   path, source_file, target_file, crossing, confidence, evidence, path_template
 */
const SNAPSHOT_SCHEMA = `
  CREATE TABLE repos (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL
  );
  CREATE TABLE scan_versions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id      INTEGER NOT NULL REFERENCES repos(id),
    started_at   TEXT    NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE services (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id        INTEGER NOT NULL REFERENCES repos(id),
    name           TEXT    NOT NULL,
    root_path      TEXT    NOT NULL DEFAULT '.',
    language       TEXT    NOT NULL DEFAULT 'unknown',
    type           TEXT    NOT NULL DEFAULT 'service',
    scan_version_id INTEGER REFERENCES scan_versions(id),
    owner          TEXT,
    auth_mechanism TEXT,
    db_backend     TEXT,
    boundary_entry INTEGER,
    base_path      TEXT
  );
  CREATE TABLE connections (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    source_service_id  INTEGER NOT NULL REFERENCES services(id),
    target_service_id  INTEGER NOT NULL REFERENCES services(id),
    protocol           TEXT    NOT NULL,
    protocol_raw       TEXT,
    method             TEXT,
    path               TEXT,
    path_template      TEXT,
    source_file        TEXT,
    target_file        TEXT,
    crossing           INTEGER,
    confidence         TEXT,
    evidence           TEXT,
    scan_version_id    INTEGER REFERENCES scan_versions(id)
  );
`;

/** Directory for on-disk snapshot DB files (cleared after each describe block). */
let tmpDir;

describe("runDrift — snapshot routing (INTG-01)", () => {
  // --------------------------------------------------------
  // Snapshot helpers
  // --------------------------------------------------------

  /**
   * Create a snapshot DB file at <tmpDir>/snapshots/<name>.
   * Seeds it with the given services/connections arrays.
   * Returns the scan_version_id written into the snapshot.
   *
   * @param {string} name - Filename under tmpDir/snapshots/
   * @param {string} repoPath - Logical repo path stored in map_versions.repos_json
   * @param {{ name: string, language?: string }[]} services
   * @param {{ src: string, tgt: string, protocol?: string }[]} connections
   * @returns {number} scan_version_id
   */
  function makeSnapshotDb(name, repoPath, services, connections) {
    const snapsDir = join(tmpDir, "snapshots");
    mkdirSync(snapsDir, { recursive: true });
    const dbPath = join(snapsDir, name);
    const snapDb = new Database(dbPath);
    snapDb.exec(SNAPSHOT_SCHEMA);
    snapDb.prepare("INSERT INTO repos (path, name, type) VALUES (?, ?, ?)").run(repoPath, "repo", "service");
    const repoId = 1;
    snapDb.prepare("INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (?, ?, ?)").run(repoId, "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z");
    const scanVersionId = 1;
    const svcIds = {};
    for (const svc of services) {
      snapDb.prepare(
        "INSERT INTO services (repo_id, name, language, root_path, scan_version_id) VALUES (?, ?, ?, ?, ?)"
      ).run(repoId, svc.name, svc.language || "unknown", ".", scanVersionId);
      const row = snapDb.prepare("SELECT id FROM services WHERE name = ?").get(svc.name);
      svcIds[svc.name] = row.id;
    }
    for (const conn of connections) {
      snapDb.prepare(
        "INSERT INTO connections (source_service_id, target_service_id, protocol, scan_version_id) VALUES (?, ?, ?, ?)"
      ).run(svcIds[conn.src], svcIds[conn.tgt], conn.protocol || "HTTP", scanVersionId);
    }
    snapDb.close();
    return scanVersionId;
  }

  /**
   * Create an in-memory main DB with a map_versions table pointing at two
   * snapshot files.
   */
  function makeMainDb(rows) {
    const mainDb = new Database(":memory:");
    mainDb.exec(`
      CREATE TABLE map_versions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at    TEXT    NOT NULL,
        label         TEXT,
        snapshot_path TEXT,
        kind          TEXT    NOT NULL DEFAULT 'map',
        repos_json    TEXT
      );
    `);
    for (const row of rows) {
      mainDb.prepare(
        "INSERT INTO map_versions (created_at, label, snapshot_path, kind, repos_json) VALUES (?, ?, ?, ?, ?)"
      ).run(row.created_at, row.label || "", row.snapshot_path || null, row.kind || "map", row.repos_json || null);
    }
    return mainDb;
  }

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "arcanon-drift-snap-"));
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // --------------------------------------------------------
  // Core snapshot routing
  // --------------------------------------------------------

  test("snapshot routing: reports correct added/removed service counts", async () => {
    const repoPath = "/projects/repo-a";

    // Snapshot A (older): api-gateway + user-service
    const scanIdA = makeSnapshotDb("snap-a.db", repoPath,
      [{ name: "api-gateway" }, { name: "user-service" }],
      [{ src: "api-gateway", tgt: "user-service" }],
    );

    // Snapshot B (newer): api-gateway + payment-service (user-service removed, payment added)
    const scanIdB = makeSnapshotDb("snap-b.db", repoPath,
      [{ name: "api-gateway" }, { name: "payment-service" }],
      [{ src: "api-gateway", tgt: "payment-service" }],
    );

    const reposJsonA = JSON.stringify([{ path: repoPath, scan_version_id: scanIdA }]);
    const reposJsonB = JSON.stringify([{ path: repoPath, scan_version_id: scanIdB }]);

    const mainDb = makeMainDb([
      { created_at: "2026-01-01T00:00:00Z", snapshot_path: "snapshots/snap-a.db", repos_json: reposJsonA, kind: "map" },
      { created_at: "2026-01-02T00:00:00Z", snapshot_path: "snapshots/snap-b.db", repos_json: reposJsonB, kind: "map" },
    ]);

    const result = await runDrift({ flags: {}, db: mainDb, dbDir: tmpDir });
    mainDb.close();

    assert.ok(result !== null, "runDrift must return a result object");
    assert.equal(result.repos.length, 1, "should process one shared repo");
    const diff = result.repos[0].result;
    // payment-service added, user-service removed, api-gateway unchanged
    assert.equal(diff.summary.services.added, 1, "one service added");
    assert.equal(diff.summary.services.removed, 1, "one service removed");
    assert.equal(diff.summary.services.modified, 0, "no service modifications");
    // connection to user-service removed, connection to payment-service added
    assert.equal(diff.summary.connections.added, 1, "one connection added");
    assert.equal(diff.summary.connections.removed, 1, "one connection removed");
  });

  test("snapshot routing: returns from/to snapshot IDs", async () => {
    const repoPath = "/projects/repo-b";
    const scanIdA = makeSnapshotDb("snap-c.db", repoPath, [{ name: "svc-x" }], []);
    const scanIdB = makeSnapshotDb("snap-d.db", repoPath, [{ name: "svc-x" }, { name: "svc-y" }], []);
    const mainDb = makeMainDb([
      { created_at: "2026-02-01T00:00:00Z", snapshot_path: "snapshots/snap-c.db", repos_json: JSON.stringify([{ path: repoPath, scan_version_id: scanIdA }]) },
      { created_at: "2026-02-02T00:00:00Z", snapshot_path: "snapshots/snap-d.db", repos_json: JSON.stringify([{ path: repoPath, scan_version_id: scanIdB }]) },
    ]);
    const result = await runDrift({ flags: {}, db: mainDb, dbDir: tmpDir });
    mainDb.close();
    assert.ok(result !== null);
    assert.ok(typeof result.from === "number", "from must be a snapshot row id");
    assert.ok(typeof result.to === "number", "to must be a snapshot row id");
    assert.ok(result.to > result.from, "to should be the newer snapshot");
  });

  // --------------------------------------------------------
  // Fallback A: fewer than 2 snapshot rows
  // --------------------------------------------------------

  test("fallback A: returns null and prints guidance when fewer than 2 snapshot rows", async () => {
    const mainDb = makeMainDb([
      { created_at: "2026-03-01T00:00:00Z", snapshot_path: "snapshots/only-one.db", repos_json: "[]" },
    ]);
    const messages = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { messages.push(s); return true; };
    try {
      const result = await runDrift({ flags: {}, db: mainDb, dbDir: tmpDir });
      assert.equal(result, null, "should return null for <2 snapshots");
      assert.ok(messages.some((m) => m.includes("run /arcanon:map at least twice")),
        "should print guidance message");
    } finally {
      process.stdout.write = origWrite;
      mainDb.close();
    }
  });

  test("fallback A: returns null when map_versions table is absent", async () => {
    const mainDb = new Database(":memory:");
    // No map_versions table at all
    const result = await runDrift({ flags: {}, db: mainDb, dbDir: tmpDir });
    mainDb.close();
    assert.equal(result, null, "should return null when map_versions is absent");
  });

  // --------------------------------------------------------
  // Fallback B: rows present but no repos_json (pre-migration-021)
  // --------------------------------------------------------

  test("fallback B: calls live-DB path when repos_json is null (no crash)", async () => {
    // Create a main DB with map_versions rows but null repos_json
    const mainDb = new Database(":memory:");
    mainDb.exec(`
      CREATE TABLE map_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        snapshot_path TEXT,
        kind TEXT DEFAULT 'map',
        repos_json TEXT
      );
      CREATE TABLE repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL
      );
      CREATE TABLE scan_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL, started_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL, name TEXT NOT NULL,
        language TEXT NOT NULL, root_path TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'service',
        scan_version_id INTEGER
      );
      CREATE TABLE connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_service_id INTEGER NOT NULL, target_service_id INTEGER NOT NULL,
        protocol TEXT NOT NULL, method TEXT, path TEXT,
        scan_version_id INTEGER
      );
    `);
    // Insert 2 map_versions rows with snapshot_path but no repos_json
    mainDb.prepare("INSERT INTO map_versions (created_at, snapshot_path, kind) VALUES (?, ?, ?)").run("2026-04-01T00:00:00Z", "snapshots/s1.db", "map");
    mainDb.prepare("INSERT INTO map_versions (created_at, snapshot_path, kind) VALUES (?, ?, ?)").run("2026-04-02T00:00:00Z", "snapshots/s2.db", "map");
    // No scan_versions rows → live-DB fallback prints "only one scan..."
    const messages = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { messages.push(s); return true; };
    try {
      // Should not throw — graceful fallback
      await assert.doesNotReject(
        () => runDrift({ flags: {}, db: mainDb, dbDir: tmpDir }),
        "fallback B must not throw",
      );
    } finally {
      process.stdout.write = origWrite;
      mainDb.close();
    }
  });

  // --------------------------------------------------------
  // Path-traversal guard
  // --------------------------------------------------------

  test("path-traversal guard: absolute snapshot_path is skipped with warning", async () => {
    const mainDb = makeMainDb([
      { created_at: "2026-05-01T00:00:00Z", snapshot_path: "snapshots/ok.db", repos_json: JSON.stringify([{ path: "/repo", scan_version_id: 1 }]) },
      { created_at: "2026-05-02T00:00:00Z", snapshot_path: "/etc/passwd", repos_json: JSON.stringify([{ path: "/repo", scan_version_id: 1 }]) },
    ]);
    const errMsgs = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { errMsgs.push(s); return true; };
    try {
      // Must not throw — the guarded repo is skipped
      await assert.doesNotReject(
        () => runDrift({ flags: {}, db: mainDb, dbDir: tmpDir }),
        "absolute snapshot_path must be skipped, not throw",
      );
      assert.ok(errMsgs.some((m) => m.includes("unsafe snapshot_path")),
        "should log a warning about the unsafe path");
    } finally {
      process.stderr.write = origStderr;
      mainDb.close();
    }
  });

  test("path-traversal guard: .. segment in snapshot_path is skipped", async () => {
    const mainDb = makeMainDb([
      { created_at: "2026-06-01T00:00:00Z", snapshot_path: "snapshots/ok.db", repos_json: JSON.stringify([{ path: "/repo", scan_version_id: 1 }]) },
      { created_at: "2026-06-02T00:00:00Z", snapshot_path: "../../../etc/shadow", repos_json: JSON.stringify([{ path: "/repo", scan_version_id: 1 }]) },
    ]);
    const errMsgs = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { errMsgs.push(s); return true; };
    try {
      await assert.doesNotReject(
        () => runDrift({ flags: {}, db: mainDb, dbDir: tmpDir }),
        ".. path must be skipped, not throw",
      );
      assert.ok(errMsgs.some((m) => m.includes("unsafe snapshot_path")),
        "should log a warning for .. segment");
    } finally {
      process.stderr.write = origStderr;
      mainDb.close();
    }
  });
});
