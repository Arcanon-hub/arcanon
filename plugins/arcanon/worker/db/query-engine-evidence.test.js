/**
 * Tests for evidence-substring guard in persistFindings (-).
 *
 * Covers the write-time validation rule: if the agent emits a connection with
 * non-empty evidence AND a source_file that resolves to a readable file on disk,
 * the evidence string MUST appear as a literal substring in that file. If not,
 * the connection is skipped + a warning is logged. Lenient cases (null/empty
 * evidence, null source_file, missing-on-disk source_file) persist anyway,
 * with a warning where applicable.
 *
 * See 109-CONTEXT.md .. for the rules.
 *
 * Run: node --test plugins/arcanon/worker/db/query-engine-evidence.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "./sqlite-adapter.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { QueryEngine } from "./query-engine.js";

// ---------------------------------------------------------------------------
// Helper: build a fully-migrated in-memory DB with a real tempdir-backed repo
// ---------------------------------------------------------------------------

async function freshEngineWithTempRepo() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-ev-"));
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Migration 001 - initial schema (inline SQL, mirrors confidence test)
  const sql001 = `
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
  `;
  db.exec(sql001);
  db.exec("INSERT INTO schema_versions(version) VALUES(1);");
  db.exec("ALTER TABLE services ADD COLUMN type TEXT NOT NULL DEFAULT 'service';");
  db.exec("INSERT INTO schema_versions(version) VALUES(2);");

  const { up: up003 } = await import("./migrations/003_exposed_endpoints.js");
  const { up: up004 } = await import("./migrations/004_dedup_constraints.js");
  const { up: up005 } = await import("./migrations/005_scan_versions.js");
  const { up: up006 } = await import("./migrations/006_dedup_repos.js");
  const { up: up007 } = await import("./migrations/007_expose_kind.js");
  const { up: up008 } = await import("./migrations/008_actors_metadata.js");
  const { up: up009 } = await import("./migrations/009_confidence_enrichment.js");
  const { up: up011 } = await import("./migrations/011_services_boundary_entry.js");
  const { up: up013 } = await import("./migrations/013_connections_path_template.js");
  for (const [v, fn] of [
    [3, up003],
    [4, up004],
    [5, up005],
    [6, up006],
    [7, up007],
    [8, up008],
    [9, up009],
    [11, up011],
    [13, up013],
  ]) {
    db.transaction(() => {
      fn(db);
      db.prepare("INSERT INTO schema_versions(version) VALUES(?)").run(v);
    })();
  }

  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES (?, 'r', 'single')")
    .run(tmpRoot).lastInsertRowid;
  return { db, repoId, qe: new QueryEngine(db), tmpRoot };
}

// Capture process.stderr output for the duration of fn() and restore. Used
// because the validator falls back to writing warnings to stderr when no
// structured logger is injected.
function captureStderr(fn) {
  const captured = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return captured.join("");
}

const baseFindings = (connOverride) => ({
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
      path: "/api/x",
      source_file: "src/api.js",
      target_file: null,
      confidence: "high",
      evidence: "",
      ...connOverride,
    },
  ],
  schemas: [],
});

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("evidence rejection in persistFindings", () => {
  it("persists when evidence appears verbatim in source_file (happy path)", async () => {
    const { db, repoId, qe, tmpRoot } = await freshEngineWithTempRepo();
    fs.mkdirSync(path.join(tmpRoot, "src"));
    fs.writeFileSync(
      path.join(tmpRoot, "src/api.js"),
      "const stream = openStream(streamId);"
    );
    qe.persistFindings(
      repoId,
      baseFindings({ evidence: "openStream(streamId)" })
    );
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM connections WHERE protocol='rest'")
      .get().n;
    assert.equal(n, 1);
  });

  it("skips and warns when evidence is prose with no substring match", async () => {
    const { db, repoId, qe, tmpRoot } = await freshEngineWithTempRepo();
    fs.mkdirSync(path.join(tmpRoot, "src"));
    fs.writeFileSync(
      path.join(tmpRoot, "src/api.js"),
      "const stream = openStream(streamId);"
    );
    const stderr = captureStderr(() =>
      qe.persistFindings(
        repoId,
        baseFindings({ evidence: "this is just a paragraph with no code" })
      )
    );
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM connections WHERE protocol='rest'")
      .get().n;
    assert.equal(n, 0, "expected connection to be skipped");
    assert.match(stderr, /evidence/i);
    assert.match(stderr, /api\.js/);
  });

  it("persists with warning when source_file does not exist on disk (D-05 lenient)", async () => {
    const { db, repoId, qe } = await freshEngineWithTempRepo();
    const stderr = captureStderr(() =>
      qe.persistFindings(
        repoId,
        baseFindings({
          evidence: "whatever",
          source_file: "/nonexistent/file.ts",
        })
      )
    );
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM connections WHERE protocol='rest'")
      .get().n;
    assert.equal(
      n,
      1,
      "connection should persist when source_file is missing on disk"
    );
    assert.match(stderr, /cannot validate evidence/);
  });

  it("persists silently when source_file is null (D-05 - no double-warn)", async () => {
    const { db, repoId, qe } = await freshEngineWithTempRepo();
    const stderr = captureStderr(() =>
      qe.persistFindings(
        repoId,
        baseFindings({ evidence: "whatever", source_file: null })
      )
    );
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM connections WHERE protocol='rest'")
      .get().n;
    assert.equal(n, 1);
    // No "cannot validate evidence" warning when source_file is null
    assert.equal(/cannot validate evidence/.test(stderr), false);
  });

  it("persists silently when evidence is empty/whitespace (D-05 - opt-in)", async () => {
    const { db, repoId, qe, tmpRoot } = await freshEngineWithTempRepo();
    fs.mkdirSync(path.join(tmpRoot, "src"));
    fs.writeFileSync(path.join(tmpRoot, "src/api.js"), "irrelevant content");
    for (const ev of ["", "   ", null]) {
      const stderr = captureStderr(() =>
        qe.persistFindings(
          repoId,
          baseFindings({
            evidence: ev,
            path: "/api/x-" + Math.random().toString(36).slice(2),
          })
        )
      );
      assert.equal(/evidence not found/.test(stderr), false);
    }
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM connections WHERE protocol='rest'")
      .get().n;
    assert.ok(n >= 1, "at least one connection should persist with empty evidence");
  });

  it("rejects ONE connection without aborting the rest of the scan", async () => {
    const { db, repoId, qe, tmpRoot } = await freshEngineWithTempRepo();
    fs.mkdirSync(path.join(tmpRoot, "src"));
    fs.writeFileSync(
      path.join(tmpRoot, "src/api.js"),
      "const x = realCallSite();"
    );
    const findings = {
      service_name: "svc-a",
      confidence: "high",
      services: [
        { name: "svc-a", root_path: ".", language: "js", confidence: "high" },
        { name: "svc-b", root_path: ".", language: "js", confidence: "high" },
        { name: "svc-c", root_path: ".", language: "js", confidence: "high" },
      ],
      connections: [
        // Connection A: prose evidence -> reject
        {
          source: "svc-a",
          target: "svc-b",
          protocol: "rest",
          method: "GET",
          path: "/api/a",
          source_file: "src/api.js",
          target_file: null,
          confidence: "high",
          evidence: "prose paragraph with no code",
        },
        // Connection B: real evidence -> persist
        {
          source: "svc-a",
          target: "svc-c",
          protocol: "rest",
          method: "GET",
          path: "/api/b",
          source_file: "src/api.js",
          target_file: null,
          confidence: "high",
          evidence: "realCallSite()",
        },
      ],
      schemas: [],
    };
    captureStderr(() => qe.persistFindings(repoId, findings));
    const rows = db
      .prepare(
        "SELECT path FROM connections WHERE protocol='rest' ORDER BY path"
      )
      .all();
    assert.deepEqual(rows.map((r) => r.path), ["/api/b"]);
  });

  it("resolves relative source_file against repos.path (covers the typical agent emit shape)", async () => {
    const { db, repoId, qe, tmpRoot } = await freshEngineWithTempRepo();
    fs.mkdirSync(path.join(tmpRoot, "src"));
    fs.writeFileSync(path.join(tmpRoot, "src/api.js"), "unique-token-xyz");
    qe.persistFindings(
      repoId,
      baseFindings({
        evidence: "unique-token-xyz",
        source_file: "src/api.js",
      })
    );
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM connections WHERE protocol='rest'")
      .get().n;
    assert.equal(n, 1);
  });
});

// ---------------------------------------------------------------------------
// PERF-02: read-count spy tests for the per-persistFindings source-file cache
// ---------------------------------------------------------------------------

describe("PERF-02: evidence source-file read-count cache (143-04)", () => {
  it("reads each unique source_file at most once per persistFindings call", async () => {
    const { repoId, qe, tmpRoot } = await freshEngineWithTempRepo();
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, "src/api.js"),
      "validToken"
    );

    // Spy on fs.readFileSync to count calls
    let readCount = 0;
    const origReadFileSync = fs.readFileSync;
    fs.readFileSync = (filePath, enc) => {
      if (typeof filePath === "string" && filePath.includes("src/api.js")) {
        readCount++;
      }
      return origReadFileSync(filePath, enc);
    };

    try {
      // 3 connections all citing the SAME source_file
      const findings = {
        services: [
          { name: "svc-a", root_path: ".", language: "js", confidence: "high" },
          { name: "svc-b", root_path: ".", language: "js", confidence: "high" },
        ],
        connections: [
          {
            source: "svc-a", target: "svc-b", protocol: "rest",
            method: "GET", path: "/x", source_file: "src/api.js",
            target_file: null, confidence: "high", evidence: "validToken",
          },
          {
            source: "svc-a", target: "svc-b", protocol: "rest",
            method: "POST", path: "/y", source_file: "src/api.js",
            target_file: null, confidence: "high", evidence: "validToken",
          },
          {
            source: "svc-a", target: "svc-b", protocol: "rest",
            method: "DELETE", path: "/z", source_file: "src/api.js",
            target_file: null, confidence: "high", evidence: "validToken",
          },
        ],
        schemas: [],
      };
      qe.persistFindings(repoId, findings);
    } finally {
      fs.readFileSync = origReadFileSync;
    }

    assert.strictEqual(
      readCount,
      1,
      `Expected exactly 1 readFileSync call for src/api.js but got ${readCount} (cache not working)`
    );
  });

  it("re-reads source_file on a subsequent persistFindings call (cache released)", async () => {
    const { repoId, qe, tmpRoot } = await freshEngineWithTempRepo();
    fs.mkdirSync(path.join(tmpRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "src/svc.js"), "freshToken");

    let readCount = 0;
    const origReadFileSync = fs.readFileSync;
    fs.readFileSync = (filePath, enc) => {
      if (typeof filePath === "string" && filePath.includes("src/svc.js")) {
        readCount++;
      }
      return origReadFileSync(filePath, enc);
    };

    try {
      const makeFindings = (path_, method) => ({
        services: [
          { name: "svc-a", root_path: ".", language: "js", confidence: "high" },
          { name: "svc-b", root_path: ".", language: "js", confidence: "high" },
        ],
        connections: [
          {
            source: "svc-a", target: "svc-b", protocol: "rest",
            method, path: path_, source_file: "src/svc.js",
            target_file: null, confidence: "high", evidence: "freshToken",
          },
        ],
        schemas: [],
      });

      // Call 1: reads the file once
      qe.persistFindings(repoId, makeFindings("/a", "GET"));
      assert.strictEqual(readCount, 1, "First call should read the file once");

      // Call 2: cache has been released — reads again (fresh)
      qe.persistFindings(repoId, makeFindings("/b", "POST"));
      assert.strictEqual(readCount, 2, "Second call should re-read the file (cache released between calls)");
    } finally {
      fs.readFileSync = origReadFileSync;
    }
  });

  it("null sentinel is reused: unreadable file causes one warn per connection that cites it", async () => {
    const { repoId, qe } = await freshEngineWithTempRepo();

    // source_file does NOT exist on disk
    let readCount = 0;
    const origReadFileSync = fs.readFileSync;
    fs.readFileSync = (filePath, enc) => {
      if (typeof filePath === "string" && filePath.includes("missing.js")) {
        readCount++;
        throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      }
      return origReadFileSync(filePath, enc);
    };

    try {
      const findings = {
        services: [
          { name: "svc-a", root_path: ".", language: "js", confidence: "high" },
          { name: "svc-b", root_path: ".", language: "js", confidence: "high" },
        ],
        connections: [
          {
            source: "svc-a", target: "svc-b", protocol: "rest",
            method: "GET", path: "/x", source_file: "/missing.js",
            target_file: null, confidence: "high", evidence: "anyToken",
          },
          {
            source: "svc-a", target: "svc-b", protocol: "rest",
            method: "POST", path: "/y", source_file: "/missing.js",
            target_file: null, confidence: "high", evidence: "anyToken",
          },
        ],
        schemas: [],
      };
      captureStderr(() => qe.persistFindings(repoId, findings));
    } finally {
      fs.readFileSync = origReadFileSync;
    }

    assert.strictEqual(
      readCount,
      1,
      `Expected exactly 1 readFileSync attempt for missing.js but got ${readCount} (null sentinel not cached)`
    );
  });
});
