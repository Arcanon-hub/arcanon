/**
 * Tests for path canonicalization (-).
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
import Database from "./sqlite-adapter.js";
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

  // Migration 019 - connections.protocol_raw (needed for _hasProtocolRaw)
  const { up: up019 } = await import("./migrations/019_connections_protocol_raw.js");
  db.transaction(() => {
    up019(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(19);
  })();

  // Migration 022 - connections.source_symbol + target_symbol (CTR-03)
  const { up: up022 } = await import("./migrations/022_connections_source_target_symbol.js");
  db.transaction(() => {
    up022(db);
    db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(22);
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

describe("canonicalizePath helper", () => {
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
// Tests 6-9: persistFindings end-to-end 
// ---------------------------------------------------------------------------

describe("path canonicalization in persistFindings", () => {
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

// ---------------------------------------------------------------------------
// CTR-01b: cross-service crossing round-trips through persistFindings
// ---------------------------------------------------------------------------

describe("CTR-01b: cross-service crossing persisted correctly", () => {
  it("crossing:'cross-service' is stored verbatim in the connections row", async () => {
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
          method: "POST",
          path: "/api/bridge",
          source_file: null,
          target_file: null,
          crossing: "cross-service",
          confidence: "high",
          evidence: "",
        },
      ],
      schemas: [],
    };
    qe.persistFindings(repoId, findings);

    const row = db
      .prepare("SELECT crossing FROM connections WHERE protocol='rest' AND path='/api/bridge'")
      .get();
    assert.ok(row, "connection with cross-service crossing was persisted");
    assert.equal(row.crossing, "cross-service", "crossing:'cross-service' round-trips through persistFindings");
  });
});

// ---------------------------------------------------------------------------
// CTR-03b: source_symbol + target_symbol written to the connections row
// ---------------------------------------------------------------------------

describe("CTR-03b: source_symbol and target_symbol persisted via upsertConnection ladder", () => {
  it("source_symbol and target_symbol are written when migration 022 columns are present", async () => {
    const { db, repoId, qe } = await freshEngine();
    const findings = {
      service_name: "svc-a",
      confidence: "high",
      services: [
        { name: "svc-a", root_path: ".", language: "ts", confidence: "high" },
        { name: "svc-b", root_path: ".", language: "ts", confidence: "high" },
      ],
      connections: [
        {
          source: "svc-a",
          target: "svc-b",
          protocol: "rest",
          method: "GET",
          path: "/api/users",
          source_file: "src/middleware/auth.ts",   // path-only (already split by contract)
          source_symbol: "validateToken",           // CTR-03: symbol in separate field
          target_file: "src/handlers/users.ts",
          target_symbol: "getUser",
          confidence: "high",
          evidence: "",
        },
      ],
      schemas: [],
    };
    qe.persistFindings(repoId, findings);

    const row = db
      .prepare("SELECT source_file, source_symbol, target_file, target_symbol FROM connections WHERE protocol='rest'")
      .get();
    assert.ok(row, "connection row exists");
    assert.equal(row.source_file, "src/middleware/auth.ts", "source_file is path-only");
    assert.equal(row.source_symbol, "validateToken", "source_symbol persisted correctly (CTR-03)");
    assert.equal(row.target_file, "src/handlers/users.ts", "target_file is path-only");
    assert.equal(row.target_symbol, "getUser", "target_symbol persisted correctly (CTR-03)");
  });

  it("schema with connection_index attaches to exactly that connection (CTR-02 via persistFindings)", async () => {
    const { db, repoId, qe } = await freshEngine();
    const findings = {
      service_name: "svc-a",
      confidence: "high",
      services: [
        { name: "svc-a", root_path: ".", language: "ts", confidence: "high" },
        { name: "svc-b", root_path: ".", language: "ts", confidence: "high" },
      ],
      connections: [
        {
          source: "svc-a",
          target: "svc-b",
          protocol: "rest",
          method: "GET",
          path: "/api/users",
          source_file: null,
          target_file: null,
          confidence: "high",
          evidence: "",
        },
      ],
      schemas: [
        {
          connection_index: 0,
          name: "UserList",
          role: "response",
          file: "src/types/user.ts",
          fields: [{ name: "users", type: "array", required: true }],
        },
      ],
    };
    qe.persistFindings(repoId, findings);

    const schemaRows = db.prepare("SELECT name FROM schemas").all();
    assert.equal(schemaRows.length, 1, "exactly 1 schema row (no fan-out)");
    assert.equal(schemaRows[0].name, "UserList", "schema name matches");

    const fieldRows = db.prepare("SELECT name FROM fields").all();
    assert.equal(fieldRows.length, 1, "exactly 1 field row");
    assert.equal(fieldRows[0].name, "users", "field name matches");
  });
});
