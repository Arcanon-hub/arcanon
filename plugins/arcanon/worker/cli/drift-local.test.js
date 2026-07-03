/**
 * worker/cli/drift-local.test.js
 *
 * Behavioral tests for the exported SQL helpers in drift-local.js.
 * Proves that:
 *   - connectionsForVersion() resolves target service names via a
 *     target_service_id JOIN — no reference to a nonexistent target_name
 *     column, so no "no such column" error occurs against a real schema.
 *   - listVersions() returns only completed scan_versions rows (WHERE
 *     completed_at IS NOT NULL), ordered by id DESC, exposing started_at
 *     (not the nonexistent created_at).
 *   - servicesForVersion() returns the inserted services for a given
 *     scan_version_id.
 *
 * Uses node:test + node:assert/strict — zero external dependencies.
 * Uses an in-memory SQLite database (via sqlite-adapter.js) with a schema
 * that mirrors the real migrations closely enough that a missing-column
 * regression would throw.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "../db/sqlite-adapter.js";
import { servicesForVersion, connectionsForVersion, listVersions } from "./drift-local.js";

// ---------------------------------------------------------------------------
// Test DB setup
// ---------------------------------------------------------------------------

let db;

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
// Tests
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
