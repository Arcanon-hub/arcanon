/**
 * worker/scan/scan-service.e2e.test.js — Real-DB E2E suite for persistScanResult.
 *
 * Uses a real in-memory node:sqlite database (via sqlite-adapter.js) and the
 * real QueryEngine. No mocks. Verifies:
 *
 *   CTR-05  command transport: persistScanResult writes real services + connections
 *   PIPE-03 slog safety: no-logger call does not throw
 *   PIPE-03 override exactly-once: pending override stamped once; not re-applied
 *   ISO-03  rollback: forced throw inside transaction rolls back all writes
 *   CTR-04  validateFindings hook: throws before any write
 *   PIPE-04 incremental preserve: unchanged services kept after incremental scan
 *   PIPE-04 deleted-file removal: services owned by deleted files are removed
 *   PIPE-04 renamed-file removal: old-path services removed, new-path services kept
 *   PIPE-04 full mode never re-stamps: _restampExistingRows is NOT invoked on mode=full
 *   PIPE-04 in-progress guard: re-stamp only targets the latest completed scan
 *
 * Run: node --test plugins/arcanon/worker/scan/scan-service.e2e.test.js
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import Database from '../db/sqlite-adapter.js';
import { QueryEngine } from '../db/query-engine.js';
import { persistScanResult } from './scan-service.js';

// All migrations in order (skipping 012 which was reverted)
import { up as up001 } from '../db/migrations/001_initial_schema.js';
import { up as up002 } from '../db/migrations/002_service_type.js';
import { up as up003 } from '../db/migrations/003_exposed_endpoints.js';
import { up as up004 } from '../db/migrations/004_dedup_constraints.js';
import { up as up005 } from '../db/migrations/005_scan_versions.js';
import { up as up006 } from '../db/migrations/006_dedup_repos.js';
import { up as up007 } from '../db/migrations/007_expose_kind.js';
import { up as up008 } from '../db/migrations/008_actors_metadata.js';
import { up as up009 } from '../db/migrations/009_confidence_enrichment.js';
import { up as up010 } from '../db/migrations/010_service_dependencies.js';
import { up as up011 } from '../db/migrations/011_services_boundary_entry.js';
import { up as up013 } from '../db/migrations/013_connections_path_template.js';
import { up as up014 } from '../db/migrations/014_services_base_path.js';
import { up as up015 } from '../db/migrations/015_scan_versions_quality_score.js';
import { up as up016 } from '../db/migrations/016_enrichment_log.js';
import { up as up017 } from '../db/migrations/017_scan_overrides.js';
import { up as up018 } from '../db/migrations/018_actors_label.js';
import { up as up019 } from '../db/migrations/019_connections_protocol_raw.js';
import { up as up020 } from '../db/migrations/020_actor_connections_protocol_raw.js';
import { up as up021 } from '../db/migrations/021_map_versions_kind_repos.js';
import { up as up022 } from '../db/migrations/022_connections_source_target_symbol.js';
import { up as up023 } from '../db/migrations/023_services_source_file.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply all 23 migrations (no 012 — reverted) to a fresh in-memory database.
 */
function applyAllMigrations(db) {
  up001(db); up002(db); up003(db); up004(db); up005(db); up006(db);
  up007(db); up008(db); up009(db); up010(db); up011(db); up013(db);
  up014(db); up015(db); up016(db); up017(db); up018(db); up019(db);
  up020(db); up021(db); up022(db); up023(db);
}

/**
 * Build a fresh fully-migrated in-memory database.
 * @returns {Database}
 */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid findings for two-service command transport test. */
const FIXTURE = {
  service_name: 'test-repo',
  confidence: 'high',
  services: [
    {
      name: 'svc-a', type: 'service', language: 'node',
      root_path: 'src/a', confidence: 'high', source_file: 'src/a.js',
    },
    {
      name: 'svc-b', type: 'service', language: 'node',
      root_path: 'src/b', confidence: 'high', source_file: 'src/b.js',
    },
  ],
  connections: [
    {
      source: 'svc-a', target: 'svc-b',
      protocol: 'rest', method: 'GET', path: '/api',
      source_file: null, confidence: 'high', evidence: '',
    },
  ],
  schemas: [],
};

/** Three-service fixture for incremental preserve tests. */
const THREE_SVC = {
  service_name: 'test-repo',
  confidence: 'high',
  services: [
    {
      name: 'svc-a', type: 'service', language: 'node',
      root_path: 'src/a', confidence: 'high', source_file: 'src/a.js',
    },
    {
      name: 'svc-b', type: 'service', language: 'node',
      root_path: 'src/b', confidence: 'high', source_file: 'src/b.js',
    },
    {
      name: 'svc-c', type: 'service', language: 'node',
      root_path: 'src/c', confidence: 'high', source_file: 'src/c.js',
    },
  ],
  connections: [],
  schemas: [],
};

/** Incremental update: only svc-b changed. */
const INCREMENTAL_B_ONLY = {
  service_name: 'test-repo',
  confidence: 'high',
  services: [
    {
      name: 'svc-b', type: 'service', language: 'node',
      root_path: 'src/b-updated', confidence: 'high', source_file: 'src/b.js',
    },
  ],
  connections: [],
  schemas: [],
};

// ---------------------------------------------------------------------------
// Task 1: Core persistScanResult — CTR-05, PIPE-03
// ---------------------------------------------------------------------------

describe('Task 1: core persistScanResult pipeline', () => {

  test('CTR-05 command transport: full scan writes services and connections; returns scanVersionId', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: '/tmp/test-repo-cmd', name: 'cmd-repo', type: 'single' });

    const result = persistScanResult(repoId, '/tmp/test-repo-cmd', FIXTURE, 'abc123', { mode: 'full' }, qe);

    assert.ok(typeof result.scanVersionId === 'number', 'returns numeric scanVersionId');

    const services = db.prepare('SELECT name FROM services WHERE repo_id = ? ORDER BY name').all(repoId);
    assert.equal(services.length, 2, 'two services written');
    assert.equal(services[0].name, 'svc-a');
    assert.equal(services[1].name, 'svc-b');

    const sv = db.prepare('SELECT * FROM scan_versions WHERE id = ?').get(result.scanVersionId);
    assert.ok(sv, 'scan_versions row exists');
    assert.ok(sv.completed_at, 'completed_at is non-null (scan completed)');

    db.close();
  });

  test('PIPE-03: calling persistScanResult without a logger does not throw', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: '/tmp/test-repo-nolog', name: 'nolog-repo', type: 'single' });

    // Insert a pending override to exercise the applyPendingOverridesSync code path
    db.prepare(
      `INSERT INTO scan_overrides (kind, action, target_id, payload) VALUES ('service', 'delete', 99999, '{}')`
    ).run();

    // Call with NO 7th argument (slog) — must not throw TypeError
    assert.doesNotThrow(() => {
      persistScanResult(repoId, '/tmp/test-repo-nolog', FIXTURE, null, { mode: 'full' }, qe);
      // No slog passed — safeSlog must be () => {} fallback
    }, 'persistScanResult without slog arg must not throw');

    db.close();
  });

  test('PIPE-03: pending override is stamped exactly once; second scan does not re-apply', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: '/tmp/test-repo-override', name: 'override-repo', type: 'single' });

    // Insert a pending dangling override (target_id 99999 doesn't exist → dangling stamp)
    const ovRow = db.prepare(
      `INSERT INTO scan_overrides (kind, action, target_id, payload) VALUES ('service', 'delete', 99999, '{}')`
    ).run();
    const overrideId = ovRow.lastInsertRowid;

    // First scan: override should be stamped
    const { scanVersionId: sv1 } = persistScanResult(
      repoId, '/tmp/test-repo-override', FIXTURE, 'sha1', { mode: 'full' }, qe
    );

    const ovAfter1 = db.prepare('SELECT applied_in_scan_version_id FROM scan_overrides WHERE override_id = ?').get(overrideId);
    assert.equal(ovAfter1.applied_in_scan_version_id, sv1, 'override stamped with sv1 after first scan');

    // Second scan: override must NOT be re-applied (stamp stays on sv1, not sv2)
    const { scanVersionId: sv2 } = persistScanResult(
      repoId, '/tmp/test-repo-override', FIXTURE, 'sha2', { mode: 'full' }, qe
    );
    assert.ok(sv2 !== sv1, 'second scan creates a new scan_versions id');

    const ovAfter2 = db.prepare('SELECT applied_in_scan_version_id FROM scan_overrides WHERE override_id = ?').get(overrideId);
    assert.equal(ovAfter2.applied_in_scan_version_id, sv1, 'override stamp unchanged on second scan (exactly-once)');

    db.close();
  });

  test('rollback: forced throw inside transaction rolls back scan_versions row and override stamp', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: '/tmp/test-repo-rollback', name: 'rollback-repo', type: 'single' });

    // Insert a pending override to verify it stays pending after rollback
    const ovRow = db.prepare(
      `INSERT INTO scan_overrides (kind, action, target_id, payload) VALUES ('service', 'delete', 99999, '{}')`
    ).run();
    const overrideId = ovRow.lastInsertRowid;

    // Monkey-patch endScan to throw inside the transaction.
    // Use rest params — `arguments` is not available in ES module scope.
    const realEndScan = qe.endScan.bind(qe);
    qe.endScan = (...args) => {
      realEndScan(...args);
      throw new Error('forced failure — rollback proof');
    };

    assert.throws(
      () => persistScanResult(repoId, '/tmp/test-repo-rollback', FIXTURE, 'sha1', { mode: 'full' }, qe),
      /forced failure/,
      'persistScanResult must propagate the throw',
    );

    // scan_versions row must be rolled back
    const svRows = db.prepare('SELECT id FROM scan_versions WHERE repo_id = ?').all(repoId);
    assert.equal(svRows.length, 0, 'scan_versions row rolled back (no completed row)');

    // override must still be pending
    const ov = db.prepare('SELECT applied_in_scan_version_id FROM scan_overrides WHERE override_id = ?').get(overrideId);
    assert.equal(ov.applied_in_scan_version_id, null, 'override stamp rolled back — remains pending');

    db.close();
  });

  test('validateFindings hook: opts.validateFindings throwing aborts before any DB write', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: '/tmp/test-repo-validate', name: 'validate-repo', type: 'single' });

    const badValidator = () => { throw new Error('contract violation: invalid findings'); };

    assert.throws(
      () => persistScanResult(
        repoId, '/tmp/test-repo-validate', FIXTURE, null,
        { mode: 'full', validateFindings: badValidator }, qe
      ),
      /contract violation/,
      'persistScanResult must propagate the validateFindings throw',
    );

    // No services or scan versions should be written
    const services = db.prepare('SELECT id FROM services WHERE repo_id = ?').all(repoId);
    assert.equal(services.length, 0, 'no services written when validateFindings throws');

    const svRows = db.prepare('SELECT id FROM scan_versions WHERE repo_id = ?').all(repoId);
    assert.equal(svRows.length, 0, 'no scan_versions written when validateFindings throws');

    db.close();
  });

});

// ---------------------------------------------------------------------------
// Task 2: PIPE-04 incremental semantics
// ---------------------------------------------------------------------------

describe('Task 2: PIPE-04 incremental preserve and deleted/renamed cleanup', () => {

  test('PIPE-04: incremental scan preserves unchanged services (N-1 untouched)', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: '/tmp/test-incremental', name: 'incr-repo', type: 'single' });

    // Full scan: 3 services
    persistScanResult(repoId, '/tmp/test-incremental', THREE_SVC, 'sha1', { mode: 'full' }, qe);

    // Incremental scan: agent only found svc-b (only src/b.js changed)
    persistScanResult(repoId, '/tmp/test-incremental', INCREMENTAL_B_ONLY, 'sha2', {
      mode: 'incremental',
      changedFiles: { modified: ['src/b.js'], deleted: [], renamed: [] },
    }, qe);

    const services = db.prepare('SELECT name FROM services WHERE repo_id = ? ORDER BY name').all(repoId);
    assert.equal(services.length, 3, 'all 3 services preserved after incremental scan (not just 1)');

    db.close();
  });

  test('PIPE-04: deleted-file services removed after incremental scan', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: '/tmp/test-deleted', name: 'del-repo', type: 'single' });

    // Full scan: svc-a (src/a.js) and svc-b (src/b.js)
    persistScanResult(repoId, '/tmp/test-deleted', FIXTURE, 'sha1', { mode: 'full' }, qe);

    // Incremental scan: src/a.js was deleted; agent returns only svc-b
    const findingsWithoutA = {
      service_name: 'test-repo', confidence: 'high',
      services: [
        { name: 'svc-b', type: 'service', language: 'node', root_path: 'src/b', confidence: 'high', source_file: 'src/b.js' },
      ],
      connections: [], schemas: [],
    };
    persistScanResult(repoId, '/tmp/test-deleted', findingsWithoutA, 'sha2', {
      mode: 'incremental',
      changedFiles: { modified: [], deleted: ['src/a.js'], renamed: [] },
    }, qe);

    const names = db.prepare('SELECT name FROM services WHERE repo_id = ? ORDER BY name').all(repoId).map(r => r.name);
    assert.ok(!names.includes('svc-a'), 'svc-a (src/a.js) removed after src/a.js deletion');
    assert.ok(names.includes('svc-b'), 'svc-b (src/b.js) kept');
    assert.equal(names.length, 1, 'exactly 1 service remains');

    db.close();
  });

  test('PIPE-04: renamed-file services removed; new-path service kept', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: '/tmp/test-renamed', name: 'rename-repo', type: 'single' });

    // Full scan: svc-old at src/old.js, svc-b at src/b.js
    const oldFindings = {
      service_name: 'test-repo', confidence: 'high',
      services: [
        { name: 'svc-old', type: 'service', language: 'node', root_path: 'src/old', confidence: 'high', source_file: 'src/old.js' },
        { name: 'svc-b',   type: 'service', language: 'node', root_path: 'src/b',   confidence: 'high', source_file: 'src/b.js' },
      ],
      connections: [], schemas: [],
    };
    persistScanResult(repoId, '/tmp/test-renamed', oldFindings, 'sha1', { mode: 'full' }, qe);

    // Incremental scan: src/old.js renamed to src/new.js; agent returns svc-new at src/new.js
    const renamedFindings = {
      service_name: 'test-repo', confidence: 'high',
      services: [
        { name: 'svc-new', type: 'service', language: 'node', root_path: 'src/new', confidence: 'high', source_file: 'src/new.js' },
      ],
      connections: [], schemas: [],
    };
    persistScanResult(repoId, '/tmp/test-renamed', renamedFindings, 'sha2', {
      mode: 'incremental',
      changedFiles: { modified: [], deleted: [], renamed: [{ from: 'src/old.js', to: 'src/new.js' }] },
    }, qe);

    const names = db.prepare('SELECT name FROM services WHERE repo_id = ? ORDER BY name').all(repoId).map(r => r.name);
    assert.ok(!names.includes('svc-old'), 'svc-old (src/old.js) removed after rename');
    assert.ok(names.includes('svc-new'), 'svc-new (src/new.js) present');
    assert.ok(names.includes('svc-b'),   'svc-b (src/b.js) kept (unrelated)');
    assert.equal(names.length, 2, 'exactly 2 services remain');

    db.close();
  });

  test('PIPE-04: full mode scan does NOT invoke incremental re-stamp (clean endScan cleanup)', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: '/tmp/test-fullmode', name: 'full-repo', type: 'single' });

    // First full scan: 3 services
    persistScanResult(repoId, '/tmp/test-fullmode', THREE_SVC, 'sha1', { mode: 'full' }, qe);

    // Second full scan: only 2 services (one dropped)
    const twoSvc = {
      service_name: 'test-repo', confidence: 'high',
      services: [
        { name: 'svc-a', type: 'service', language: 'node', root_path: 'src/a', confidence: 'high', source_file: 'src/a.js' },
        { name: 'svc-b', type: 'service', language: 'node', root_path: 'src/b', confidence: 'high', source_file: 'src/b.js' },
      ],
      connections: [], schemas: [],
    };
    persistScanResult(repoId, '/tmp/test-fullmode', twoSvc, 'sha2', { mode: 'full' }, qe);

    // Full mode: endScan cleans up svc-c; only 2 remain
    const names = db.prepare('SELECT name FROM services WHERE repo_id = ? ORDER BY name').all(repoId).map(r => r.name);
    assert.equal(names.length, 2, 'full scan cleans up removed service (no re-stamp interference)');
    assert.ok(!names.includes('svc-c'), 'svc-c removed by endScan stale cleanup (full mode)');

    db.close();
  });

  test('PIPE-04: in-progress guard — re-stamp targets only the latest completed scan', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: '/tmp/test-inprogress', name: 'inprogress-repo', type: 'single' });

    // First completed scan: 3 services
    persistScanResult(repoId, '/tmp/test-inprogress', THREE_SVC, 'sha1', { mode: 'full' }, qe);

    // Manually insert an incomplete scan_versions row (simulates a crashed scan)
    db.prepare(
      `INSERT INTO scan_versions (repo_id, started_at) VALUES (?, datetime('now', '-1 minute'))`
    ).run(repoId);
    const incompleteRow = db.prepare(
      'SELECT id FROM scan_versions WHERE repo_id = ? AND completed_at IS NULL ORDER BY id DESC LIMIT 1'
    ).get(repoId);
    assert.ok(incompleteRow, 'incomplete scan_versions row inserted');

    // Incremental scan: should only re-stamp FROM the latest COMPLETED scan (not the incomplete one)
    // If it tried to re-stamp from the incomplete row, services would be stamped with the wrong id
    // and endScan's DELETE would wipe them. The test verifies all 3 services survive.
    persistScanResult(repoId, '/tmp/test-inprogress', INCREMENTAL_B_ONLY, 'sha2', {
      mode: 'incremental',
      changedFiles: { modified: ['src/b.js'], deleted: [], renamed: [] },
    }, qe);

    const services = db.prepare('SELECT name FROM services WHERE repo_id = ? ORDER BY name').all(repoId);
    assert.equal(services.length, 3, 'all 3 services preserved when in-progress scan exists');

    db.close();
  });

});
