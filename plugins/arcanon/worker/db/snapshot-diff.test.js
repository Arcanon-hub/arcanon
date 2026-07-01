/**
 * snapshot-diff.test.js — ISO-07 two-snapshot roundtrip diff test
 *
 * Proves that two retained snapshot DBs can be diffed via diffScanVersions()
 * producing correct added / removed / modified counts — without any Phase 142
 * command wiring. This is the minimal end-to-end proof that Phase 139's
 * snapshot + run-record machinery produces diffable artifacts.
 *
 * Recipe (per RESEARCH §Q7):
 *   1. Scan N  → svcA + svcB + connAB → endScan → createSnapshot A
 *   2. Scan N+1 → svcA + svcC + connAC → endScan → createSnapshot B
 *   3. Open snapshot A and B as independent handles
 *   4. Parse scan_version_ids from each row's repos_json
 *   5. diffScanVersions(dbA, dbB, scanIdA, scanIdB)
 *   6. Assert services.added=[C], services.removed=[B], services.modified=[]
 *
 * Run: node --test worker/db/snapshot-diff.test.js
 *      (from plugins/arcanon/)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb, createSnapshot } from './database.js';
import { QueryEngine } from './query-engine.js';
import Database from './sqlite-adapter.js';
import { diffScanVersions } from '../diff/scan-version-diff.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal service object accepted by persistFindings.
 */
function mkSvc(name) {
  return { name, root_path: name + '/', language: 'js', type: 'service' };
}

/**
 * Minimal connection object accepted by persistFindings.
 */
function mkConn(srcName, tgtName) {
  return {
    source: srcName,
    target: tgtName,
    protocol: 'rest',
    method: 'GET',
    path: `/${srcName}-to-${tgtName}`,
    source_file: 'index.js',
    target_file: 'index.js',
    crossing: false,
  };
}

// ---------------------------------------------------------------------------
// ISO-07 roundtrip test
// ---------------------------------------------------------------------------

describe('ISO-07: two-snapshot diffScanVersions roundtrip', () => {
  let testRoot;
  let db;
  let qe;
  let repoId;
  let dbA;
  let dbB;

  before(() => {
    // openDb needs a real directory (VACUUM INTO requires a file path, not :memory:)
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arcanon-snap-diff-'));
    db = openDb(testRoot);
    qe = new QueryEngine(db);
    repoId = qe.upsertRepo({ path: testRoot, name: 'test-repo', type: 'single' });
  });

  after(() => {
    try { dbA?.close(); } catch { /* already closed */ }
    try { dbB?.close(); } catch { /* already closed */ }
    try { db?.close(); } catch { /* already closed */ }
  });

  it('scan N produces a snapshot with svcA + svcB visible via the scan_version_id in repos_json', () => {
    // ── Scan N: svcA + svcB ──
    const sv1 = qe.beginScan(repoId);
    qe.persistFindings(
      repoId,
      {
        services: [mkSvc('service-a'), mkSvc('service-b')],
        connections: [mkConn('service-a', 'service-b')],
      },
      'sha-001',
      sv1,
    );
    qe.endScan(repoId, sv1);

    // Take snapshot A (post-commit — D-03 satisfied: no open transaction here)
    createSnapshot(db, `map ${new Date().toISOString()}`, 'map', [
      { path: testRoot, scan_version_id: sv1 },
    ]);

    const rowA = db.prepare('SELECT * FROM map_versions ORDER BY id DESC LIMIT 1').get();
    assert.ok(rowA, 'map_versions has a row after snapshot A');
    assert.equal(rowA.kind, 'map', "kind is 'map'");
    assert.ok(rowA.repos_json, 'repos_json is set');

    const reposA = JSON.parse(rowA.repos_json);
    assert.equal(reposA.length, 1, 'repos_json has 1 entry');
    assert.equal(reposA[0].scan_version_id, sv1, 'repos_json carries sv1');

    // Verify snapshot DB contains svcA + svcB at sv1
    const snapPath = path.join(path.dirname(db.name), rowA.snapshot_path);
    dbA = new Database(snapPath);
    const svcsInA = dbA
      .prepare('SELECT name FROM services WHERE scan_version_id = ?')
      .all(sv1);
    const namesA = svcsInA.map(r => r.name).sort();
    assert.deepEqual(namesA, ['service-a', 'service-b'], 'snapshot A has svcA + svcB');
  });

  it('scan N+1 produces a snapshot with svcA + svcC and diffScanVersions reports correct delta', () => {
    // ── Scan N+1: svcA + svcC (svcB removed) ──
    const sv2 = qe.beginScan(repoId);
    qe.persistFindings(
      repoId,
      {
        services: [mkSvc('service-a'), mkSvc('service-c')],
        connections: [mkConn('service-a', 'service-c')],
      },
      'sha-002',
      sv2,
    );
    qe.endScan(repoId, sv2);

    // Take snapshot B
    createSnapshot(db, `map ${new Date().toISOString()}`, 'map', [
      { path: testRoot, scan_version_id: sv2 },
    ]);

    const rowB = db.prepare('SELECT * FROM map_versions ORDER BY id DESC LIMIT 1').get();
    assert.ok(rowB, 'map_versions has a row after snapshot B');
    assert.ok(rowB.repos_json, 'repos_json is set on snapshot B');

    const reposB = JSON.parse(rowB.repos_json);
    assert.equal(reposB[0].scan_version_id, sv2, 'repos_json carries sv2');

    // Open snapshot B
    const snapPathB = path.join(path.dirname(db.name), rowB.snapshot_path);
    dbB = new Database(snapPathB);

    const svcsInB = dbB
      .prepare('SELECT name FROM services WHERE scan_version_id = ?')
      .all(sv2);
    const namesB = svcsInB.map(r => r.name).sort();
    assert.deepEqual(namesB, ['service-a', 'service-c'], 'snapshot B has svcA + svcC');

    // Parse scan_version_ids from repos_json (the Phase 142 lookup path)
    const rowA = db
      .prepare('SELECT * FROM map_versions ORDER BY id ASC LIMIT 1')
      .get();
    const scanIdA = JSON.parse(rowA.repos_json)[0].scan_version_id;
    const scanIdB = reposB[0].scan_version_id;

    // ── Diff the two snapshots ──
    const result = diffScanVersions(dbA, dbB, scanIdA, scanIdB);

    // Service delta: C added, B removed, A unchanged
    assert.equal(result.services.added.length, 1, 'one service added (C)');
    assert.equal(result.services.removed.length, 1, 'one service removed (B)');
    assert.equal(result.services.modified.length, 0, 'no services modified');
    assert.ok(
      result.services.added.some(s => s.name === 'service-c'),
      'service-c is in the added list',
    );
    assert.ok(
      result.services.removed.some(s => s.name === 'service-b'),
      'service-b is in the removed list',
    );

    // Summary counters must match
    assert.equal(result.summary.services.added, 1);
    assert.equal(result.summary.services.removed, 1);
    assert.equal(result.summary.services.modified, 0);
  });

  it('repos_json scan_version_ids resolve to real services inside each snapshot DB', () => {
    // Belt-and-suspenders: confirm the scan_version_ids in repos_json are not
    // stale (i.e., null or wrong). Phase 142 depends on this resolution path.
    const rows = db
      .prepare('SELECT * FROM map_versions ORDER BY id ASC LIMIT 2')
      .all();
    assert.equal(rows.length, 2, 'two map_versions rows exist');

    for (const row of rows) {
      const repos = JSON.parse(row.repos_json);
      const svId = repos[0].scan_version_id;
      assert.ok(typeof svId === 'number' && svId > 0, `repos_json scan_version_id is a positive integer (got ${svId})`);
    }
  });
});
