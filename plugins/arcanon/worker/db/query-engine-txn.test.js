/**
 * worker/db/query-engine-txn.test.js — ISO-03/04/05/10 transaction proofs
 *
 * Uses a two-repo fixture and the real db.transaction() wrapper (sqlite-adapter.js
 * lines 302-339) to prove the four Phase-138 requirements:
 *
 *   ISO-03: A forced throw inside a write transaction rolls back ALL DB writes,
 *           including the scan_versions INSERT from beginScan.
 *
 *   ISO-04: completed_at is the LAST write in endScan — a forced cleanup failure
 *           leaves completed_at NULL; a clean run stamps it only after all cleanup.
 *
 *   ISO-05: endScan's schema/field cleanup is scoped by repo_id — repo A's scan
 *           does NOT delete repo B's schema or field rows.
 *
 *   ISO-10: cleanupAbandonedScanVersions removes pre-138 stale (>5min) NULL-completed
 *           scan_versions rows; fresh NULL-completed rows are preserved.
 *
 * Run: node --test plugins/arcanon/worker/db/query-engine-txn.test.js
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from './sqlite-adapter.js';
import { QueryEngine } from './query-engine.js';

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
import { up as up015 } from './migrations/015_scan_versions_quality_score.js';
import { up as up016 } from './migrations/016_enrichment_log.js';
import { up as up017 } from './migrations/017_scan_overrides.js';
import { up as up018 } from './migrations/018_actors_label.js';
import { up as up019 } from './migrations/019_connections_protocol_raw.js';
import { up as up020 } from './migrations/020_actor_connections_protocol_raw.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyAllMigrations(db) {
  up001(db); up002(db); up003(db); up004(db); up005(db); up006(db);
  up007(db); up008(db); up009(db); up010(db); up011(db); up013(db);
  up014(db); up015(db); up016(db); up017(db); up018(db); up019(db); up020(db);
}

/** Build a fresh fully-migrated in-memory database. */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  return db;
}

/** Insert a repos row and return its integer id. */
function upsertRepo(db, repoPath) {
  return db.prepare(
    "INSERT INTO repos (path, name, type) VALUES (?, ?, 'single')"
  ).run(repoPath, repoPath.replace(/\//g, '-')).lastInsertRowid;
}

/**
 * Minimal findings object that passes evidence validation (source_file=null
 * short-circuits the evidence check — case 2 in _validateEvidence).
 */
function makeFindings(svcPrefix, includeConnection = true) {
  return {
    services: [
      { name: svcPrefix + '-api', root_path: '.', language: 'typescript', type: 'service' },
      { name: svcPrefix + '-web', root_path: '.', language: 'javascript', type: 'service' },
    ],
    connections: includeConnection ? [{
      source: svcPrefix + '-web',
      target: svcPrefix + '-api',
      protocol: 'http',
      method: 'GET',
      path: '/items',
      source_file: null,  // null → evidence check is a safe no-op (_validateEvidence case 2)
      target_file: null,
    }] : [],
    schemas: [],
  };
}

/**
 * Seed a repo with a completed scan (beginScan → persistFindings → attach
 * a schema + field directly to the newest connection → endScan).
 * Returns { svId, schemaId } from the seeded scan.
 */
function seedCompletedScan(qe, db, repoId, svcPrefix) {
  const svId = qe.beginScan(repoId);
  qe.persistFindings(repoId, makeFindings(svcPrefix), 'seed-commit', svId);

  // Manually attach a schema + field to the most-recently inserted connection
  // (mirrors the approach in query-engine-graph.test.js:398-400).
  const conn = db.prepare('SELECT id FROM connections ORDER BY id DESC LIMIT 1').get();
  const schemaId = db.prepare(
    "INSERT INTO schemas (connection_id, role, name, file) VALUES (?, 'request', ?, NULL)"
  ).run(conn.id, svcPrefix + '-RequestSchema').lastInsertRowid;
  db.prepare(
    "INSERT INTO fields (schema_id, name, type, required) VALUES (?, 'id', 'integer', 1)"
  ).run(schemaId);

  qe.endScan(repoId, svId);
  return { svId, schemaId };
}

// ---------------------------------------------------------------------------
// ISO-03 + ISO-10: transaction rollback
// ---------------------------------------------------------------------------

describe('ISO-03 / ISO-10: forced-throw transaction rolls back all writes', () => {
  test('aborted transaction leaves zero new rows and no orphaned scan_versions row', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);

    // Seed two repos with completed prior scans.
    const repoA = upsertRepo(db, '/project/repo-a');
    const repoB = upsertRepo(db, '/project/repo-b');
    seedCompletedScan(qe, db, repoA, 'svc-a');
    seedCompletedScan(qe, db, repoB, 'svc-b');

    // Capture pre-transaction state for repo A.
    const svCountBefore = db.prepare(
      'SELECT COUNT(*) AS n FROM scan_versions WHERE repo_id = ?'
    ).get(repoA).n;
    const svcCountBefore = db.prepare(
      'SELECT COUNT(*) AS n FROM services WHERE repo_id = ?'
    ).get(repoA).n;
    const connCountBefore = db.prepare(
      'SELECT COUNT(*) AS n FROM connections'
    ).get().n;  // total — a rollback must not affect ANY connection

    // Attempt a write transaction that ends with a forced throw.
    // beginScan is inside the transaction so its scan_versions INSERT is rolled back too (ISO-10).
    let threw = false;
    try {
      qe._db.transaction(() => {
        const svId = qe.beginScan(repoA);
        qe.persistFindings(repoA, makeFindings('svc-a-v2'), 'aborted-commit', svId);
        throw new Error('forced rollback — ISO-03 proof');
      })();
    } catch (err) {
      if (err.message === 'forced rollback — ISO-03 proof') threw = true;
      else throw err; // unexpected error — surface it
    }

    assert.ok(threw, 'transaction threw as expected');

    // All writes must be rolled back.
    const svCountAfter = db.prepare(
      'SELECT COUNT(*) AS n FROM scan_versions WHERE repo_id = ?'
    ).get(repoA).n;
    assert.equal(svCountAfter, svCountBefore,
      'ISO-10: no orphaned scan_versions row — the beginScan INSERT was rolled back');

    const svcCountAfter = db.prepare(
      'SELECT COUNT(*) AS n FROM services WHERE repo_id = ?'
    ).get(repoA).n;
    assert.equal(svcCountAfter, svcCountBefore,
      'ISO-03: repo A service count unchanged');

    const connCountAfter = db.prepare('SELECT COUNT(*) AS n FROM connections').get().n;
    assert.equal(connCountAfter, connCountBefore,
      'ISO-03: total connection count unchanged (no partial writes from aborted scan)');

    // Explicit check: no NULL-completed scan_versions row exists for repo A.
    const nullSvRow = db.prepare(
      'SELECT id FROM scan_versions WHERE repo_id = ? AND completed_at IS NULL'
    ).get(repoA);
    assert.equal(nullSvRow, undefined,
      'ISO-10: no NULL-completed scan_versions row (beginScan INSERT was inside tx → rolled back)');

    db.close();
  });
});

// ---------------------------------------------------------------------------
// ISO-04: completed_at stamped LAST
// ---------------------------------------------------------------------------

describe('ISO-04: completed_at is the last write in endScan', () => {
  test('clean endScan stamps completed_at non-NULL after all cleanup', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = upsertRepo(db, '/iso04/clean');

    // First scan — just services + connection, no manually-attached schema
    // (avoid FK complications from INSERT OR REPLACE on the second scan).
    const sv1 = qe.beginScan(repoId);
    qe.persistFindings(repoId, makeFindings('svc-clean-v1'), 'commit-1', sv1);
    qe.endScan(repoId, sv1);

    const row1 = db.prepare(
      'SELECT completed_at FROM scan_versions WHERE id = ?'
    ).get(sv1);
    assert.notEqual(row1.completed_at, null, 'first scan completed_at is set');

    // Second scan: different service names so sv1's services become stale.
    // No connections — narrowed findings.
    const sv2 = qe.beginScan(repoId);
    qe.persistFindings(repoId, makeFindings('svc-clean-v2', false), 'commit-2', sv2);
    qe.endScan(repoId, sv2);

    const row2 = db.prepare(
      'SELECT completed_at FROM scan_versions WHERE id = ?'
    ).get(sv2);
    assert.notEqual(row2.completed_at, null,
      'ISO-04: second scan completed_at is non-NULL after clean endScan');

    // Stale sv1 services must be gone (different names → not re-upserted in sv2).
    const staleServices = db.prepare(
      'SELECT COUNT(*) AS n FROM services WHERE scan_version_id = ?'
    ).get(sv1).n;
    assert.equal(staleServices, 0,
      'stale sv1 services cleaned up — proves cleanup ran before the completed_at stamp');

    db.close();
  });

  test('forced cleanup failure inside endScan leaves completed_at NULL', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = upsertRepo(db, '/iso04/forced');

    // Open a scan bracket.
    const svId = qe.beginScan(repoId);
    qe.persistFindings(repoId, makeFindings('svc-forced'), 'partial-commit', svId);

    // Replace a non-try/catch statement that endScan calls BEFORE _stmtEndScan.run().
    // _stmtDeleteStaleConnections runs before the completed_at stamp.
    const origStmt = qe._stmtDeleteStaleConnections;
    qe._stmtDeleteStaleConnections = {
      run: () => { throw new Error('simulated cleanup failure — ISO-04 proof'); },
    };

    let threw = false;
    try {
      qe.endScan(repoId, svId);
    } catch (err) {
      if (err.message === 'simulated cleanup failure — ISO-04 proof') threw = true;
      else throw err;
    } finally {
      qe._stmtDeleteStaleConnections = origStmt; // always restore
    }

    assert.ok(threw, 'endScan threw from simulated cleanup failure');

    // completed_at must still be NULL — the stamp runs only after all cleanup.
    const row = db.prepare(
      'SELECT completed_at FROM scan_versions WHERE id = ?'
    ).get(svId);
    assert.equal(row.completed_at, null,
      'ISO-04: completed_at is NULL because the stamp is the last write and cleanup threw before it');

    db.close();
  });
});

// ---------------------------------------------------------------------------
// ISO-05: cross-repo schema isolation
// ---------------------------------------------------------------------------

describe('ISO-05: repo-scoped schema/field cleanup', () => {
  test('repo A scan does not delete repo B schemas or fields', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);

    const repoA = upsertRepo(db, '/iso05/repo-a');
    const repoB = upsertRepo(db, '/iso05/repo-b');

    // Seed both repos with completed scans that include schemas + fields.
    seedCompletedScan(qe, db, repoA, 'svc-a');
    seedCompletedScan(qe, db, repoB, 'svc-b');

    // Capture repo B's schema + field counts after seeding (before repo A's next scan).
    const bSchemasBefore = db.prepare(
      `SELECT COUNT(*) AS n FROM schemas s
       JOIN connections c ON c.id = s.connection_id
       JOIN services svc ON svc.id = c.source_service_id
       WHERE svc.repo_id = ?`
    ).get(repoB).n;
    assert.ok(bSchemasBefore > 0, 'repo B has at least one schema (test pre-condition)');

    const bFieldsBefore = db.prepare(
      `SELECT COUNT(*) AS n FROM fields f
       JOIN schemas s ON s.id = f.schema_id
       JOIN connections c ON c.id = s.connection_id
       JOIN services svc ON svc.id = c.source_service_id
       WHERE svc.repo_id = ?`
    ).get(repoB).n;
    assert.ok(bFieldsBefore > 0, 'repo B has at least one field (test pre-condition)');

    // Second scan for repo A uses DIFFERENT service names ('svc-a-v2') so that:
    //   (a) the old svc-a-* services become stale (scan_version_id still=sv_a1),
    //   (b) the old connection is not replaced via INSERT OR REPLACE (avoids FK
    //       violation from the still-attached schema), and
    //   (c) endScan's repo-scoped schema cleanup deletes the sv_a1 schema
    //       (c.scan_version_id != svA2) before stale-connection cleanup removes
    //       the connection itself.
    const svA2 = qe.beginScan(repoA);
    qe.persistFindings(repoA, makeFindings('svc-a-v2'), 'commit-a-v2', svA2);

    // Seed a schema on repo A's NEW connection so there IS something to keep.
    const connA2 = db.prepare('SELECT id FROM connections ORDER BY id DESC LIMIT 1').get();
    const schemaA2 = db.prepare(
      "INSERT INTO schemas (connection_id, role, name, file) VALUES (?, 'response', 'svc-a-v2-Schema', NULL)"
    ).run(connA2.id).lastInsertRowid;
    db.prepare(
      "INSERT INTO fields (schema_id, name, type, required) VALUES (?, 'result', 'string', 0)"
    ).run(schemaA2);

    // endScan for repo A's second scan — this triggers the repo-scoped schema
    // cleanup that previously (with the unscoped SQL) would have deleted repo B's schemas.
    qe.endScan(repoA, svA2);

    // Repo B schema + field counts must be UNCHANGED.
    const bSchemasAfter = db.prepare(
      `SELECT COUNT(*) AS n FROM schemas s
       JOIN connections c ON c.id = s.connection_id
       JOIN services svc ON svc.id = c.source_service_id
       WHERE svc.repo_id = ?`
    ).get(repoB).n;
    assert.equal(bSchemasAfter, bSchemasBefore,
      'ISO-05: repo B schema count unchanged after repo A endScan (cross-repo isolation)');

    const bFieldsAfter = db.prepare(
      `SELECT COUNT(*) AS n FROM fields f
       JOIN schemas s ON s.id = f.schema_id
       JOIN connections c ON c.id = s.connection_id
       JOIN services svc ON svc.id = c.source_service_id
       WHERE svc.repo_id = ?`
    ).get(repoB).n;
    assert.equal(bFieldsAfter, bFieldsBefore,
      'ISO-05: repo B field count unchanged after repo A endScan (cross-repo isolation)');

    db.close();
  });
});

// ---------------------------------------------------------------------------
// ISO-10: abandoned scan recovery
// ---------------------------------------------------------------------------

describe('ISO-10: cleanupAbandonedScanVersions recovery', () => {
  test('stale NULL-completed row (>5min) deleted; fresh NULL-completed row preserved', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = upsertRepo(db, '/iso10/recovery');

    // Insert a stale NULL-completed row directly — started_at is 10 minutes in the past.
    // Use a fixed old timestamp so it is definitively older than the 5-minute threshold.
    const staleTs = '2020-01-01T00:00:00.000Z';
    const staleId = db.prepare(
      'INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (?, ?, NULL)'
    ).run(repoId, staleTs).lastInsertRowid;

    // Insert a fresh NULL-completed row — started_at is the current moment.
    const freshTs = new Date().toISOString();
    const freshId = db.prepare(
      'INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (?, ?, NULL)'
    ).run(repoId, freshTs).lastInsertRowid;

    // Verify both rows exist before cleanup.
    const beforeCount = db.prepare(
      'SELECT COUNT(*) AS n FROM scan_versions WHERE repo_id = ? AND completed_at IS NULL'
    ).get(repoId).n;
    assert.equal(beforeCount, 2, 'pre-condition: 2 NULL-completed rows exist');

    // Run recovery directly (also called at the start of every beginScan).
    qe.cleanupAbandonedScanVersions(repoId);

    // Stale row must be gone.
    const staleRow = db.prepare(
      'SELECT id FROM scan_versions WHERE id = ?'
    ).get(staleId);
    assert.equal(staleRow, undefined,
      'ISO-10: stale NULL-completed row (started_at >5min ago) was deleted');

    // Fresh row must still exist.
    const freshRow = db.prepare(
      'SELECT id FROM scan_versions WHERE id = ?'
    ).get(freshId);
    assert.ok(freshRow, 'ISO-10: fresh NULL-completed row (started_at ~now) was preserved');

    db.close();
  });

  test('cleanupAbandonedScanVersions is called by beginScan (recovery fires automatically)', () => {
    const db = freshDb();
    const qe = new QueryEngine(db);
    const repoId = upsertRepo(db, '/iso10/auto');

    // Insert a stale NULL-completed row.
    const staleTs = '2021-06-01T10:00:00.000Z';
    const staleId = db.prepare(
      'INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (?, ?, NULL)'
    ).run(repoId, staleTs).lastInsertRowid;

    // beginScan triggers cleanupAbandonedScanVersions before inserting the new row.
    const newSvId = qe.beginScan(repoId);

    // Stale row must be gone.
    const staleRow = db.prepare(
      'SELECT id FROM scan_versions WHERE id = ?'
    ).get(staleId);
    assert.equal(staleRow, undefined,
      'ISO-10: stale row deleted as a side-effect of beginScan()');

    // The new row from beginScan must exist.
    const newRow = db.prepare(
      'SELECT id FROM scan_versions WHERE id = ?'
    ).get(newSvId);
    assert.ok(newRow, 'beginScan inserted a new scan_versions row after cleanup');

    db.close();
  });
});
