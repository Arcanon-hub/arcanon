/**
 * Tests for path canonicalization (Phase 109, Plan 02 - TRUST-03 / TRUST-11).
 *
 * Covers:
 *   - canonicalizePath helper (5 unit tests, direct function calls)
 *   - persistFindings collapses template-variants to one row
 *   - persistFindings merges path_template comma-joined on collapse
 *   - persistFindings re-scan idempotency (no path_template duplication)
 *   - non-template path passthrough preserves both path and path_template
 *
 * Run: node --test plugins/arcanon/worker/db/query-engine-canonical.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { QueryEngine, canonicalizePath } from "./query-engine.js";

// ---------------------------------------------------------------------------
// Helper: build a fully-migrated in-memory DB (001..009 + 011 + 013) and engine
// ---------------------------------------------------------------------------

async function freshEngine() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Migration 001 - initial schema (inline SQL pattern; mirrors
  // query-engine-confidence.test.js)
  db.exec(`
    CREATE TABLE schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE repos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      last_commit TEXT,
      scanned_at  TEXT
    );

    CREATE TABLE services (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id   INTEGER NOT NULL REFERENCES repos(id),
      name      TEXT    NOT NULL,
      root_path TEXT    NOT NULL,
      language  TEXT    NOT NULL
    );

    CREATE TABLE connections (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      source_service_id INTEGER NOT NULL REFERENCES services(id),
      target_service_id INTEGER NOT NULL REFERENCES services(id),
      protocol          TEXT    NOT NULL,
      method            TEXT,
      path              TEXT,
      source_file       TEXT,
      target_file       TEXT
    );

    CREATE TABLE schemas (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL REFERENCES connections(id),
      role          TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      file          TEXT
    );

    CREATE TABLE fields (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      schema_id INTEGER NOT NULL REFERENCES schemas(id),
      name      TEXT    NOT NULL,
      type      TEXT    NOT NULL,
      required  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE map_versions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      label         TEXT,
      snapshot_path TEXT
    );

    CREATE TABLE repo_state (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id              INTEGER NOT NULL UNIQUE REFERENCES repos(id),
      last_scanned_commit  TEXT,
      last_scanned_at      TEXT
    );

    CREATE VIRTUAL TABLE connections_fts USING fts5(
      path, protocol, source_file, target_file,
      content='connections', content_rowid='id'
    );

    CREATE VIRTUAL TABLE services_fts USING fts5(
      name,
      content='services', content_rowid='id'
    );

    CREATE VIRTUAL TABLE fields_fts USING fts5(
      name, type,
      content='fields', content_rowid='id'
    );

    CREATE TRIGGER services_ai AFTER INSERT ON services BEGIN
      INSERT INTO services_fts(rowid, name) VALUES (new.id, new.name);
    END;
    CREATE TRIGGER connections_ai AFTER INSERT ON connections BEGIN
      INSERT INTO connections_fts(rowid, path, protocol, source_file, target_file)
        VALUES (new.id, new.path, new.protocol, new.source_file, new.target_file);
    END;
    CREATE TRIGGER fields_ai AFTER INSERT ON fields BEGIN
      INSERT INTO fields_fts(rowid, name, type) VALUES (new.id, new.name, new.type);
    END;
  `);
  db.exec("INSERT INTO schema_versions(version) VALUES(1);");

  // Migration 002 - service.type column
  db.exec("ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'service';");
  db.exec("INSERT INTO schema_versions(version) VALUES(2);");

  // Migration 003 - exposed_endpoints table
  const { up: up003 } = await import("./migrations/003_exposed_endpoints.js");
  db.transaction(() => {
    up003(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(3);
  })();

  // Migration 004 - dedup constraints (UNIQUE on connections)
  const { up: up004 } = await import("./migrations/004_dedup_constraints.js");
  db.transaction(() => {
    up004(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(4);
  })();

  // Migration 005 - scan_versions
  const { up: up005 } = await import("./migrations/005_scan_versions.js");
  db.transaction(() => {
    up005(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(5);
  })();

  // Migration 006 - UNIQUE(path) on repos
  const { up: up006 } = await import("./migrations/006_dedup_repos.js");
  db.transaction(() => {
    up006(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(6);
  })();

  // Migration 007 - expose kind column
  const { up: up007 } = await import("./migrations/007_expose_kind.js");
  db.transaction(() => {
    up007(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(7);
  })();

  // Migration 008 - crossing column + actors
  const { up: up008 } = await import("./migrations/008_actors_metadata.js");
  db.transaction(() => {
    up008(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(8);
  })();

  // Migration 009 - confidence + evidence columns
  const { up: up009 } = await import("./migrations/009_confidence_enrichment.js");
  db.transaction(() => {
    up009(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(9);
  })();

  // Migration 011 - services.boundary_entry
  const { up: up011 } = await import("./migrations/011_services_boundary_entry.js");
  db.transaction(() => {
    up011(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(11);
  })();

  // Migration 013 - connections.path_template
  const { up: up013 } = await import("./migrations/013_connections_path_template.js");
  db.transaction(() => {
    up013(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(13);
  })();

  const repoId = db
    .prepare(
      "INSERT INTO repos (path, name, type) VALUES ('/tmp/r-canon', 'r', 'single')"
    )
    .run().lastInsertRowid;
  return { db, repoId, qe: new QueryEngine(db) };
}

const baseFindings = (path) => ({
  service_name: "svc-a",
  confidence: "high",
  services: [
    { name: "svc-a", root_path: ".", language: "js", confidence: "high" },
    { name: "svc-b", root_path: ".", language: "js", confidence: "high" },
  ],
  connections: [
    {
      source: "svc-a",
      target: "svc-b",
      protocol: "rest",
      method: "GET",
      path,
      source_file: null,
      target_file: null,
      confidence: "high",
      evidence: "",
    },
  ],
  schemas: [],
});

// ---------------------------------------------------------------------------
// Tests 1-5: canonicalizePath helper (pure-JS unit tests)
// ---------------------------------------------------------------------------

describe("canonicalizePath helper (TRUST-03)", () => {
  it("replaces single {var}", () => {
    assert.equal(
      canonicalizePath("/runtime/streams/{stream_id}"),
      "/runtime/streams/{_}"
    );
  });

  it("replaces multiple {vars}", () => {
    assert.equal(
      canonicalizePath("/api/users/{id}/posts/{post_id}"),
      "/api/users/{_}/posts/{_}"
    );
  });

  it("passes through paths without templates", () => {
    assert.equal(canonicalizePath("/api/users"), "/api/users");
  });

  it("does NOT canonicalize Express :id style (D-06 scope)", () => {
    assert.equal(canonicalizePath("/api/users/:id"), "/api/users/:id");
  });

  it("returns null/empty/undefined unchanged (no {_} for falsy paths)", () => {
    assert.equal(canonicalizePath(null), null);
    assert.equal(canonicalizePath(""), "");
    assert.equal(canonicalizePath(undefined), null);
  });
});

// ---------------------------------------------------------------------------
// Tests 6-9: persistFindings end-to-end (TRUST-11)
// ---------------------------------------------------------------------------

describe("TRUST-03 path canonicalization in persistFindings (TRUST-11)", () => {
  it("collapses two template-variants to one row with both originals in path_template", async () => {
    const { db, repoId, qe } = await freshEngine();
    const findings = {
      service_name: "svc-a",
      confidence: "high",
      services: [
        { name: "svc-a", root_path: ".", language: "js", confidence: "high" },
        { name: "svc-b", root_path: ".", language: "js", confidence: "high" },
      ],
      connections: [
        {
          source: "svc-a",
          target: "svc-b",
          protocol: "rest",
          method: "GET",
          path: "/runtime/streams/{stream_id}",
          source_file: null,
          target_file: null,
          confidence: "high",
          evidence: "",
        },
        {
          source: "svc-a",
          target: "svc-b",
          protocol: "rest",
          method: "GET",
          path: "/runtime/streams/{name}",
          source_file: null,
          target_file: null,
          confidence: "high",
          evidence: "",
        },
      ],
      schemas: [],
    };
    qe.persistFindings(repoId, findings);

    const rows = db
      .prepare("SELECT path, path_template FROM connections WHERE protocol='rest'")
      .all();
    assert.equal(rows.length, 1, `expected 1 collapsed row, got ${rows.length}`);
    assert.equal(rows[0].path, "/runtime/streams/{_}");

    const templates = rows[0].path_template
      .split(",")
      .map((s) => s.trim())
      .sort();
    assert.deepEqual(templates, [
      "/runtime/streams/{name}",
      "/runtime/streams/{stream_id}",
    ]);
  });

  it("idempotent re-scan does not duplicate templates in path_template", async () => {
    const { db, repoId, qe } = await freshEngine();
    const findings = baseFindings("/runtime/streams/{stream_id}");
    qe.persistFindings(repoId, findings);
    qe.persistFindings(repoId, findings); // re-scan same input

    const rows = db
      .prepare("SELECT path_template FROM connections WHERE protocol='rest'")
      .all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].path_template, "/runtime/streams/{stream_id}");
    assert.equal(
      rows[0].path_template.includes(","),
      false,
      "path_template should not contain a comma after re-scanning the same template"
    );
  });

  it("paths without templates: path passes through, path_template equals original", async () => {
    const { db, repoId, qe } = await freshEngine();
    qe.persistFindings(repoId, baseFindings("/api/health"));
    const row = db
      .prepare("SELECT path, path_template FROM connections WHERE protocol='rest'")
      .get();
    assert.equal(row.path, "/api/health");
    assert.equal(row.path_template, "/api/health");
  });

  it("three-way merge: distinct templates accumulate, repeated template stays at one entry", async () => {
    const { db, repoId, qe } = await freshEngine();
    qe.persistFindings(repoId, baseFindings("/api/users/{id}"));
    qe.persistFindings(repoId, baseFindings("/api/users/{userId}"));
    qe.persistFindings(repoId, baseFindings("/api/users/{id}")); // duplicate
    const row = db
      .prepare("SELECT path_template FROM connections WHERE protocol='rest'")
      .get();
    const parts = row.path_template
      .split(",")
      .map((s) => s.trim())
      .sort();
    assert.deepEqual(parts, ["/api/users/{id}", "/api/users/{userId}"]);
  });
});
