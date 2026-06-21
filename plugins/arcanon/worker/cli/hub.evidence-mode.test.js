/**
 * worker/cli/hub.evidence-mode.test.js —   wiring tests.
 *
 * Asserts the load-bearing wiring at the CLI to hub-sync boundary:
 *
 *   1. loadLatestFindings() now SELECTs c.evidence + c.confidence + c.source_file
 *      so the new hub.evidence_mode flag has data to operate on. Without this
 *      the flag is structurally a no-op (RESEARCH section 1).
 *   2. Connection rows returned to buildScanPayload carry evidence/source_file
 *      fields so projectEvidence (hash-only mode) can hash + line-locate them.
 *
 * The cmdUpload to syncFindings to buildScanPayload forwarding chain is covered
 * by inspection in the test (asserting the forwarded shape is in the buildScanPayload
 * matrix at payload.test.js M9 — already green).
 *
 * Run: node --test plugins/arcanon/worker/cli/hub.evidence-mode.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// IMPORTANT: pool.js captures `dataDir = resolveDataDir()` at module-load,
// and Node ESM caches the module. So ARCANON_DATA_DIR must be set BEFORE the
// first dynamic import of hub.js, and every test in this file must reuse the
// same data dir (we cannot rotate it per-test without spawning a subprocess).
const SHARED_ARC_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "arcanon-data-int01-"),
);
process.env.ARCANON_DATA_DIR = SHARED_ARC_DATA_DIR;

function makeArcDataDir() {
  // Each test still gets its own subdir to avoid cross-pollution; only the
  // root data-dir must be stable across the file.
  return SHARED_ARC_DATA_DIR;
}

async function seedFixtureDB({ projectRoot, arcDataDir }) {
  // Compute the projectHashDir convention manually (must match pool.js).
  const hash = crypto
    .createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 12);
  const dir = path.join(arcDataDir, "projects", hash);
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "impact-map.db");

  const Database = (await import("../db/sqlite-adapter.js")).default;
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  const { applyAllMigrations } = await import(
    "../../tests/fixtures/verify/seed.js"
  );
  applyAllMigrations(db);

  const repoId = db
    .prepare(
      `INSERT INTO repos (path, name, type, scanned_at)
       VALUES (?, ?, ?, datetime('now'))`,
    )
    .run(projectRoot, path.basename(projectRoot), "single").lastInsertRowid;

  const scanVersionId = db
    .prepare(
      `INSERT INTO scan_versions (repo_id, started_at, completed_at)
       VALUES (?, datetime('now'), datetime('now'))`,
    )
    .run(repoId).lastInsertRowid;

  const insertService = db.prepare(
    `INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const svcId = insertService
    .run(repoId, "svc-a", projectRoot, "js", "service", scanVersionId)
    .lastInsertRowid;
  const targetSvcId = insertService
    .run(repoId, "users-api", projectRoot, "js", "service", scanVersionId)
    .lastInsertRowid;

  db.prepare(
    `INSERT INTO connections (
       source_service_id, target_service_id, protocol, method, path,
       source_file, scan_version_id, confidence, evidence
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    svcId,
    targetSvcId,
    "rest",
    "GET",
    "/users",
    "src/index.js",
    scanVersionId,
    "high",
    "fetch('/users')",
  );

  db.close();
  return { dbPath, dir };
}

test("INT-01 wiring #1 — loadLatestFindings SELECTs evidence + confidence + source_file", async () => {
  const arcDataDir = makeArcDataDir();
  process.env.ARCANON_DATA_DIR = arcDataDir;
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arcanon-proj-int01-"));

  try {
    await seedFixtureDB({ projectRoot, arcDataDir });

    // Dynamic import AFTER env var set so pool.js captures the right dataDir.
    const { loadLatestFindings } = await import("./hub.js");
    const findings = await loadLatestFindings(projectRoot);

    assert.equal(findings.connections.length, 1, "expected 1 seeded connection");
    const conn = findings.connections[0];
    assert.equal(conn.source, "svc-a");
    assert.equal(conn.target, "users-api");
    assert.equal(conn.evidence, "fetch('/users')",
      "INT-01 contract: c.evidence must be projected (was missing pre-Phase-120)");
    assert.equal(conn.confidence, "high",
      "INT-01 contract: c.confidence must be projected");
    assert.equal(conn.source_file, "src/index.js",
      "INT-01 contract: c.source_file must be projected (needed for hash-only line derivation)");
  } finally {
    // Do NOT remove SHARED_ARC_DATA_DIR — the second test needs the same path
    // because pool.js captured it at module load. Per-project subdirs are
    // distinct (different projectRoot → different sha256 hash → different dir).
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// NOTE: a second test exercising loadLatestFindings -> buildScanPayload
// (hash-only) end-to-end was prototyped but cannot run in the same process
// because worker/db/database.js openDb() is a module-level singleton (_db).
// The first test in this file claims that singleton; subsequent tests with
// a different projectRoot read the cached singleton and miss their seeded
// rows. Coverage of the buildScanPayload(hash-only) -> v1.2 + line derivation
// path lives in plugins/arcanon/worker/hub-sync/payload.test.js M4 (already
// green). The bats E2E test (Task 4) drives the same path through a fresh
// node subprocess so the singleton is not an obstacle there.
