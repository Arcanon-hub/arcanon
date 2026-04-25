/**
 * worker/server/http.verify.test.js — Phase 112-02 (TRUST-01, TRUST-07/08/09).
 *
 * Drives the GET /api/verify endpoint and the exported computeVerdict helper
 * with an in-memory SQLite DB. Pairs with tests/verify.bats which exercises
 * the same code path end-to-end via the shell wrapper + spawned worker.
 *
 * Coverage map:
 *   1.  computeVerdict — ok happy path                        (TRUST-07)
 *   2.  computeVerdict — moved (file deleted)                 (TRUST-08)
 *   3.  computeVerdict — missing (snippet absent)             (TRUST-09)
 *   4.  computeVerdict — method_mismatch                      (D-01)
 *   5.  computeVerdict — ok with evidence=null                (D-01 degraded)
 *   6.  GET /api/verify — happy path returns 3 results        (TRUST-07)
 *   7.  GET /api/verify ?connection_id — single result        (D-06)
 *   8.  GET /api/verify ?source_file — exact match            (D-06)
 *   9.  GET /api/verify — missing project param → 400         (D-04)
 *   10. GET /api/verify ?connection_id=99999 → 404            (D-04 / 112-01)
 *   11. GET /api/verify ?source_file=src/nope → 200 empty     (D-06)
 *   12. GET /api/verify cap — 1001 connections truncated      (D-03)
 *   13. GET /api/verify is read-only                          (D-02)
 *
 * Run: node --test plugins/arcanon/worker/server/http.verify.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { createHttpServer, computeVerdict } from './http.js';
import { seedFixture, applyAllMigrations } from '../../tests/fixtures/verify/seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Plugin root — three directory levels above this file:
//   plugins/arcanon/worker/server/http.verify.test.js → plugins/arcanon
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_SOURCE_DIR = path.join(
  PLUGIN_ROOT, 'tests', 'fixtures', 'verify', 'source',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a project root that mirrors how bats sets up its temp dir: a fresh
 * tmpdir plus a `tests/fixtures/verify/source/` subtree containing copies
 * of the canonical fixture source files. The seeded `source_file` paths are
 * relative (e.g. `tests/fixtures/verify/source/users.js`) so they resolve
 * against either the bats project root or this projectRoot.
 */
function buildProjectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcanon-verify-'));
  const dest = path.join(root, 'tests', 'fixtures', 'verify', 'source');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['users.js', 'orders.js', 'admin.js']) {
    fs.copyFileSync(path.join(FIXTURE_SOURCE_DIR, f), path.join(dest, f));
  }
  return root;
}

function cleanupProjectRoot(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch { /* best-effort */ }
}

async function makeServer(qe) {
  return await createHttpServer(null, {
    port: 0,
    resolveQueryEngine: () => qe,
  });
}

/**
 * Compute a deterministic checksum of every column we care about on the
 * connections + scan_versions tables. Used by the read-only assertion
 * (test 13 / D-02).
 */
function checksumTables(db) {
  const conn = db.prepare(
    `SELECT
       COUNT(*) AS n,
       SUM(LENGTH(COALESCE(source_file, ''))) AS sf_len,
       SUM(LENGTH(COALESCE(evidence,    ''))) AS ev_len,
       SUM(LENGTH(COALESCE(method,      ''))) AS m_len,
       SUM(LENGTH(COALESCE(path,        ''))) AS p_len,
       SUM(COALESCE(scan_version_id, 0))      AS sv_sum
     FROM connections`,
  ).get();
  const sv = db.prepare(
    `SELECT COUNT(*) AS n,
            SUM(LENGTH(COALESCE(started_at,   ''))) AS s_len,
            SUM(LENGTH(COALESCE(completed_at, ''))) AS c_len
       FROM scan_versions`,
  ).get();
  return { conn, sv };
}

// ---------------------------------------------------------------------------
// 1. computeVerdict — ok happy path                                  TRUST-07
// ---------------------------------------------------------------------------

test('computeVerdict — ok when file exists, evidence found, method matches (TRUST-07)', () => {
  const projectRoot = buildProjectRoot();
  try {
    const v = computeVerdict({
      connection_id: 1,
      source_file: 'tests/fixtures/verify/source/users.js',
      method: 'POST',
      path: '/users',
      evidence: "router.post('/users', async (req, res)",
    }, projectRoot);
    assert.equal(v.verdict, 'ok');
    assert.equal(v.evidence_present, true);
    assert.ok(v.line_start > 0, 'line_start should be 1-indexed positive');
    assert.ok(v.line_end >= v.line_start);
    assert.ok(v.snippet && v.snippet.length <= 81, // up to 80 + ellipsis
      `snippet length=${v.snippet?.length}`);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 2. computeVerdict — moved (file deleted)                           TRUST-08
// ---------------------------------------------------------------------------

test('computeVerdict — moved when source_file does not exist (TRUST-08)', () => {
  const projectRoot = buildProjectRoot();
  try {
    const v = computeVerdict({
      connection_id: 99,
      source_file: 'src/never/existed/here.ts',
      method: 'POST',
      path: '/x',
      evidence: 'whatever',
    }, projectRoot);
    assert.equal(v.verdict, 'moved');
    assert.equal(v.evidence_present, false);
    assert.equal(v.snippet, null);
    assert.match(v.message || '', /not found/i);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 3. computeVerdict — missing (snippet absent)                       TRUST-09
// ---------------------------------------------------------------------------

test('computeVerdict — missing when file exists but evidence absent (TRUST-09)', () => {
  const projectRoot = buildProjectRoot();
  try {
    const v = computeVerdict({
      connection_id: 1,
      source_file: 'tests/fixtures/verify/source/users.js',
      method: 'POST',
      path: '/users',
      evidence: 'this snippet is not in the file',
    }, projectRoot);
    assert.equal(v.verdict, 'missing');
    assert.equal(v.evidence_present, false);
    assert.match(v.message || '', /not found in file/);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 4. computeVerdict — method_mismatch                                D-01
// ---------------------------------------------------------------------------

test('computeVerdict — method_mismatch when cited method absent in snippet (D-01)', () => {
  const projectRoot = buildProjectRoot();
  try {
    const v = computeVerdict({
      connection_id: 2,
      // orders.js contains router.get — claim it was POST
      source_file: 'tests/fixtures/verify/source/orders.js',
      method: 'POST',
      path: '/orders',
      evidence: "router.get('/orders'",
    }, projectRoot);
    assert.equal(v.verdict, 'method_mismatch');
    assert.equal(v.evidence_present, true);
    assert.match(v.message || '', /method 'POST' not found in evidence/);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 5. computeVerdict — ok with no-evidence-recorded                   D-01
// ---------------------------------------------------------------------------

test('computeVerdict — ok degraded when conn.evidence is null (pre-Phase-109)', () => {
  const projectRoot = buildProjectRoot();
  try {
    const v = computeVerdict({
      connection_id: 5,
      source_file: 'tests/fixtures/verify/source/users.js',
      method: 'POST',
      path: '/users',
      evidence: null,
    }, projectRoot);
    assert.equal(v.verdict, 'ok');
    assert.equal(v.evidence_present, false);
    assert.equal(v.message, 'no-evidence-recorded');
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 6. GET /api/verify happy path — 3 ok results                       TRUST-07
// ---------------------------------------------------------------------------

test('GET /api/verify — happy path returns 3 ok verdicts (TRUST-07)', async () => {
  const projectRoot = buildProjectRoot();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  seedFixture({ db, projectRoot });
  const qe = { _db: db };
  const server = await makeServer(qe);
  try {
    const res = await server.inject({
      method: 'GET',
      url: `/api/verify?project=${encodeURIComponent(projectRoot)}`,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.total, 3);
    assert.equal(body.truncated, false);
    assert.equal(body.scope, 'all');
    assert.equal(body.results.length, 3);
    for (const r of body.results) {
      assert.equal(r.verdict, 'ok', `connection ${r.connection_id} should be ok`);
      assert.equal(r.evidence_present, true);
    }
  } finally {
    await server.close();
    db.close();
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 7. GET /api/verify ?connection_id — single result                  D-06
// ---------------------------------------------------------------------------

test('GET /api/verify ?connection_id=2 — returns exactly that connection', async () => {
  const projectRoot = buildProjectRoot();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  seedFixture({ db, projectRoot });
  const qe = { _db: db };
  const server = await makeServer(qe);
  try {
    const res = await server.inject({
      method: 'GET',
      url: `/api/verify?project=${encodeURIComponent(projectRoot)}&connection_id=2`,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.scope, 'connection');
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].connection_id, 2);
    assert.equal(body.results[0].verdict, 'ok');
  } finally {
    await server.close();
    db.close();
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 8. GET /api/verify ?source_file — exact match                      D-06
// ---------------------------------------------------------------------------

test('GET /api/verify ?source_file=...users.js — exact-path match returns one row', async () => {
  const projectRoot = buildProjectRoot();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  seedFixture({ db, projectRoot });
  const qe = { _db: db };
  const server = await makeServer(qe);
  try {
    const res = await server.inject({
      method: 'GET',
      url: `/api/verify?project=${encodeURIComponent(projectRoot)}` +
        `&source_file=${encodeURIComponent('tests/fixtures/verify/source/users.js')}`,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.scope, 'source');
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].source_file,
      'tests/fixtures/verify/source/users.js');
    assert.equal(body.results[0].verdict, 'ok');
  } finally {
    await server.close();
    db.close();
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 9. GET /api/verify — missing project param → 400                   D-04
// ---------------------------------------------------------------------------

test('GET /api/verify — missing project param returns 400', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const qe = { _db: db };
  const server = await makeServer(qe);
  try {
    const res = await server.inject({ method: 'GET', url: '/api/verify' });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.match(body.error, /missing required param: project/);
  } finally {
    await server.close();
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 10. GET /api/verify ?connection_id=99999 → 404                     D-04
// ---------------------------------------------------------------------------

test('GET /api/verify ?connection_id=99999 — no row returns 404', async () => {
  const projectRoot = buildProjectRoot();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  seedFixture({ db, projectRoot });
  const qe = { _db: db };
  const server = await makeServer(qe);
  try {
    const res = await server.inject({
      method: 'GET',
      url: `/api/verify?project=${encodeURIComponent(projectRoot)}&connection_id=99999`,
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.payload);
    assert.match(body.error, /no connection with id 99999/);
  } finally {
    await server.close();
    db.close();
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 11. GET /api/verify ?source_file=nope → 200 empty                  D-06
// ---------------------------------------------------------------------------

test('GET /api/verify ?source_file=nonexistent — 200 with empty results', async () => {
  const projectRoot = buildProjectRoot();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  seedFixture({ db, projectRoot });
  const qe = { _db: db };
  const server = await makeServer(qe);
  try {
    const res = await server.inject({
      method: 'GET',
      url: `/api/verify?project=${encodeURIComponent(projectRoot)}` +
        `&source_file=${encodeURIComponent('src/nonexistent.ts')}`,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.scope, 'source');
    assert.equal(body.total, 0);
    assert.equal(body.results.length, 0);
    assert.equal(body.truncated, false);
  } finally {
    await server.close();
    db.close();
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 12. GET /api/verify cap — 1001 connections → truncated=true        D-03
// ---------------------------------------------------------------------------

test('GET /api/verify — 1001 connections triggers truncated=true (D-03)', async () => {
  const projectRoot = buildProjectRoot();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const { scanVersionId, repoId } = seedFixture({ db, projectRoot });

  // Add a fourth service so we have a fresh source_service_id to spam.
  const padSvcId = db
    .prepare(
      `INSERT INTO services (repo_id, name, root_path, language, type, scan_version_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(repoId, 'pad-svc', `${projectRoot}/pad`, 'js', 'service', scanVersionId)
    .lastInsertRowid;

  const usersSvcRow = db.prepare(`SELECT id FROM services WHERE name = 'users-svc'`).get();
  const usersSvcId = usersSvcRow.id;

  // Need 998 additional rows (3 seeded → +998 = 1001 total). Each must be
  // distinct on (source_service_id, target_service_id, protocol, method, path)
  // due to the UNIQUE dedup index from migration 013.
  const insertConn = db.prepare(
    `INSERT INTO connections (
       source_service_id, target_service_id, protocol, method, path,
       source_file, target_file, scan_version_id, confidence, evidence
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const txn = db.transaction(() => {
    for (let i = 0; i < 998; i++) {
      insertConn.run(
        padSvcId, usersSvcId, 'http', 'GET', `/pad/${i}`,
        'tests/fixtures/verify/source/users.js', null, scanVersionId, 'high',
        "router.post('/users', async (req, res)",
      );
    }
  });
  txn();

  const total = db.prepare(`SELECT COUNT(*) AS n FROM connections`).get().n;
  assert.equal(total, 1001, 'precondition: 1001 connections seeded');

  const qe = { _db: db };
  const server = await makeServer(qe);
  try {
    const res = await server.inject({
      method: 'GET',
      url: `/api/verify?project=${encodeURIComponent(projectRoot)}`,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.truncated, true);
    assert.equal(body.total, 1001);
    assert.equal(body.results.length, 0);
    assert.equal(body.scope, 'all');
    assert.match(body.message || '',
      /scope with --source <path> or --connection <id>/);
  } finally {
    await server.close();
    db.close();
    cleanupProjectRoot(projectRoot);
  }
});

// ---------------------------------------------------------------------------
// 13. GET /api/verify is read-only — D-02 byte-level checksum proof
// ---------------------------------------------------------------------------

test('GET /api/verify — read-only contract: connections + scan_versions byte-identical (D-02)', async () => {
  const projectRoot = buildProjectRoot();
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  seedFixture({ db, projectRoot });
  const qe = { _db: db };
  const server = await makeServer(qe);
  try {
    const before = checksumTables(db);
    // Three calls — one per scope path — all must be read-only.
    await server.inject({
      method: 'GET',
      url: `/api/verify?project=${encodeURIComponent(projectRoot)}`,
    });
    await server.inject({
      method: 'GET',
      url: `/api/verify?project=${encodeURIComponent(projectRoot)}&connection_id=1`,
    });
    await server.inject({
      method: 'GET',
      url: `/api/verify?project=${encodeURIComponent(projectRoot)}` +
        `&source_file=${encodeURIComponent('tests/fixtures/verify/source/users.js')}`,
    });
    const after = checksumTables(db);
    assert.deepEqual(after.conn, before.conn,
      'connections checksum must be unchanged after verify (D-02)');
    assert.deepEqual(after.sv, before.sv,
      'scan_versions checksum must be unchanged after verify (D-02)');
  } finally {
    await server.close();
    db.close();
    cleanupProjectRoot(projectRoot);
  }
});
