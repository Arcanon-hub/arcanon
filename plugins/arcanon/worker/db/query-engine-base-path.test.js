/**
 * worker/db/query-engine-base-path.test.js — Phase 110 (TRUST-04, TRUST-12)
 *
 * Verifies the write + resolution paths for services.base_path:
 *   - Test 1: upsertService persists base_path on a migration-014 db
 *   - Test 2: upsertService defaults base_path to NULL when omitted
 *   - Test 3: upsertService backwards-compat — pre-014 db falls back to
 *             migration-011 shape (no throw, base_path silently dropped)
 *   - Test 4: detectMismatches positive single-segment — /api/users matches
 *             exposed /users when target.base_path = '/api'
 *   - Test 5: detectMismatches positive multi-segment (D-03) — /api/v1/users
 *             matches exposed /users when target.base_path = '/api/v1'
 *   - Test 6: detectMismatches negative D-02 guard — /api/users does NOT
 *             match exposed /users when target.base_path = NULL
 *   - Test 7: detectMismatches segment-boundary D-03 guard — /api/users does
 *             NOT match exposed /i/users when target.base_path = '/ap'
 *   - Test 8: detectMismatches literal-match preserved — /api/users matches
 *             literal /api/users even when target.base_path = '/api'
 *
 * Also unit-tests the exported stripBasePath helper (D-02 + D-03 algorithm).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up as up001 } from './migrations/001_initial_schema.js';
import { up as up002 } from './migrations/002_service_type.js';
import { up as up003 } from './migrations/003_exposed_endpoints.js';
import { up as up004 } from './migrations/004_dedup_constraints.js';
import { up as up005 } from './migrations/005_scan_versions.js';
import { up as up006 } from './migrations/006_dedup_repos.js';
import { up as up007 } from './migrations/007_expose_kind.js';
import { up as up008 } from './migrations/008_actors_metadata.js';
import { up as up009 } from './migrations/009_confidence_enrichment.js';
import { up as up010 } from './migrations/010_service_dependencies.js';
import { up as up011 } from './migrations/011_services_boundary_entry.js';
import { up as up013 } from './migrations/013_connections_path_template.js';
import { up as up014 } from './migrations/014_services_base_path.js';
import { QueryEngine, stripBasePath } from './query-engine.js';

/** Apply migrations 001..011 (pre-014 baseline — no base_path column) */
function applyMigrationsThrough011(db) {
  up001(db);
  up002(db);
  up003(db);
  up004(db);
  up005(db);
  up006(db);
  up007(db);
  up008(db);
  up009(db);
  up010(db);
  up011(db);
}

/** Apply all migrations through 014 (current head) */
function applyAllMigrations(db) {
  applyMigrationsThrough011(db);
  up013(db);
  up014(db);
}

/** Returns a fresh in-memory db at full migration head + a seeded repo */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  return { db, repoId };
}

/** Returns a fresh in-memory db at migration-011 head ONLY (pre-014) */
function freshDbPre014() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrationsThrough011(db);
  // Note: we apply 013 too because the connections.path_template column is
  // exercised by upsertConnection. But NOT 014, so services.base_path is absent.
  up013(db);
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  return { db, repoId };
}

/** Inserts a service via SQL directly (bypasses upsert) — for setting up
 *  resolution-test fixtures with arbitrary base_path values. */
function insertService(db, repoId, name, basePath) {
  const stmt = db.prepare(
    `INSERT INTO services (repo_id, name, root_path, language, type, base_path)
     VALUES (?, ?, '/tmp/r', 'js', 'service', ?)`
  );
  return stmt.run(repoId, name, basePath ?? null).lastInsertRowid;
}

function insertExposedEndpoint(db, serviceId, method, pathStr) {
  const stmt = db.prepare(
    `INSERT INTO exposed_endpoints (service_id, method, path) VALUES (?, ?, ?)`
  );
  return stmt.run(serviceId, method, pathStr).lastInsertRowid;
}

function insertConnection(db, srcId, tgtId, protocol, method, pathStr) {
  const stmt = db.prepare(
    `INSERT INTO connections (source_service_id, target_service_id, protocol, method, path)
     VALUES (?, ?, ?, ?, ?)`
  );
  return stmt.run(srcId, tgtId, protocol, method, pathStr).lastInsertRowid;
}

// ===========================================================================
// stripBasePath helper unit tests (D-02 + D-03 algorithm)
// ===========================================================================

describe('stripBasePath helper (D-02 + D-03)', () => {
  it('returns null when basePath is null/empty', () => {
    assert.equal(stripBasePath('/api/users', null), null);
    assert.equal(stripBasePath('/api/users', ''), null);
    assert.equal(stripBasePath('/api/users', undefined), null);
  });

  it('strips single-segment prefix at segment boundary', () => {
    assert.equal(stripBasePath('/api/users', '/api'), '/users');
  });

  it('strips multi-segment prefix at segment boundary (D-03)', () => {
    assert.equal(stripBasePath('/api/v1/users', '/api/v1'), '/users');
  });

  it('returns "/" when path equals basePath exactly', () => {
    assert.equal(stripBasePath('/api', '/api'), '/');
  });

  it('returns null when prefix is a substring without segment boundary (D-03)', () => {
    // /ap is a substring of /api/users but next char is "i", not "/"
    assert.equal(stripBasePath('/api/users', '/ap'), null);
  });

  it('returns null when path does not start with basePath', () => {
    assert.equal(stripBasePath('/users', '/api'), null);
  });

  it('normalizes trailing slash on basePath', () => {
    assert.equal(stripBasePath('/api/users', '/api/'), '/users');
  });
});

// ===========================================================================
// Write path tests (Tests 1-3)
// ===========================================================================

describe('upsertService write path — base_path', () => {
  it('Test 1: persists base_path on a migration-014 db', () => {
    const { db, repoId } = freshDb();
    const qe = new QueryEngine(db);
    const id = qe.upsertService({
      repo_id: repoId,
      name: 'svc-a',
      root_path: '/tmp/r',
      language: 'js',
      base_path: '/api',
    });
    assert.ok(id > 0);
    const row = db
      .prepare('SELECT base_path FROM services WHERE id = ?')
      .get(id);
    assert.equal(row.base_path, '/api');
  });

  it('Test 2: defaults base_path to NULL when omitted', () => {
    const { db, repoId } = freshDb();
    const qe = new QueryEngine(db);
    const id = qe.upsertService({
      repo_id: repoId,
      name: 'svc-b',
      root_path: '/tmp/r',
      language: 'js',
    });
    const row = db
      .prepare('SELECT base_path FROM services WHERE id = ?')
      .get(id);
    assert.equal(row.base_path, null);
  });

  it('Test 3: backwards compat — pre-014 db (no base_path column) does not throw', () => {
    const { db, repoId } = freshDbPre014();
    const qe = new QueryEngine(db);
    // Should NOT throw — falls through to migration-011 shape
    assert.doesNotThrow(() => {
      qe.upsertService({
        repo_id: repoId,
        name: 'svc-c',
        root_path: '/tmp/r',
        language: 'js',
        base_path: '/api',
      });
    });
    // Service was persisted (base_path silently dropped — column doesn't exist)
    const row = db
      .prepare('SELECT name FROM services WHERE name = ?')
      .get('svc-c');
    assert.ok(row);
    assert.equal(row.name, 'svc-c');
  });
});

// ===========================================================================
// Resolution path tests (Tests 4-8) — detectMismatches with base_path stripping
// ===========================================================================

describe('detectMismatches — base_path resolution (D-02, D-03)', () => {
  it('Test 4: positive single-segment — /api/users matches exposed /users when target.base_path = /api', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'user-api', '/api');
    insertExposedEndpoint(db, bId, 'GET', '/users');
    insertConnection(db, aId, bId, 'rest', 'GET', '/api/users');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'user-api'
    );
    assert.equal(
      forThisConn.length,
      0,
      `expected no mismatch but got: ${JSON.stringify(forThisConn)}`
    );
  });

  it('Test 5: positive multi-segment — /api/v1/users matches exposed /users when target.base_path = /api/v1 (D-03)', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'user-api-v1', '/api/v1');
    insertExposedEndpoint(db, bId, 'GET', '/users');
    insertConnection(db, aId, bId, 'rest', 'GET', '/api/v1/users');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'user-api-v1'
    );
    assert.equal(forThisConn.length, 0);
  });

  it('Test 6: negative D-02 guard — /api/users does NOT match exposed /users when target.base_path = NULL', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'user-api-no-prefix', null);
    insertExposedEndpoint(db, bId, 'GET', '/users');
    insertConnection(db, aId, bId, 'rest', 'GET', '/api/users');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'user-api-no-prefix'
    );
    assert.equal(
      forThisConn.length,
      1,
      'expected exactly one mismatch — over-eager stripping would mask this'
    );
    assert.equal(forThisConn[0].type, 'endpoint_not_exposed');
  });

  it('Test 7: segment-boundary D-03 guard — /api/users does NOT match exposed /i/users when target.base_path = /ap', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'partial-prefix-svc', '/ap');
    insertExposedEndpoint(db, bId, 'GET', '/i/users');
    insertConnection(db, aId, bId, 'rest', 'GET', '/api/users');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'partial-prefix-svc'
    );
    assert.equal(
      forThisConn.length,
      1,
      'expected mismatch — /ap is a substring of /api but not at a segment boundary'
    );
  });

  it('Test 8: literal match preserved — /api/users matches exposed /api/users when target.base_path = /api', () => {
    const { db, repoId } = freshDb();
    const aId = insertService(db, repoId, 'frontend', null);
    const bId = insertService(db, repoId, 'literal-prefix-svc', '/api');
    // Service "forgot" to strip /api in exposes — agent emitted it literally
    insertExposedEndpoint(db, bId, 'GET', '/api/users');
    insertConnection(db, aId, bId, 'rest', 'GET', '/api/users');

    const qe = new QueryEngine(db);
    const mismatches = qe.detectMismatches();
    const forThisConn = mismatches.filter(
      (m) => m.source === 'frontend' && m.target === 'literal-prefix-svc'
    );
    assert.equal(
      forThisConn.length,
      0,
      'expected no mismatch — literal match should win'
    );
  });
});

// ===========================================================================
// Backwards-compat resolution: detectMismatches on pre-014 db
// ===========================================================================

describe('detectMismatches — pre-014 backwards compat', () => {
  it('does not throw on a database without services.base_path column', () => {
    const { db, repoId } = freshDbPre014();
    // Insert services without base_path column
    const aId = db
      .prepare(
        `INSERT INTO services (repo_id, name, root_path, language, type)
         VALUES (?, 'frontend', '/tmp/r', 'js', 'service')`
      )
      .run(repoId).lastInsertRowid;
    const bId = db
      .prepare(
        `INSERT INTO services (repo_id, name, root_path, language, type)
         VALUES (?, 'backend', '/tmp/r', 'js', 'service')`
      )
      .run(repoId).lastInsertRowid;
    insertExposedEndpoint(db, bId, 'GET', '/users');
    insertConnection(db, aId, bId, 'rest', 'GET', '/users');

    const qe = new QueryEngine(db);
    assert.doesNotThrow(() => qe.detectMismatches());
    const mismatches = qe.detectMismatches();
    // Literal match works, no mismatch
    assert.equal(mismatches.length, 0);
  });
});
