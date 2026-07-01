/**
 * query-engine-reconcile.test.js — ISO-08 four-table child reconciliation tests
 *
 * Proves that removed child state (exposed_endpoints, actor_connections,
 * node_metadata, service_dependencies) disappears after a successful re-scan,
 * and that repo-scoping holds (repo A's scan never touches repo B's child rows).
 *
 * Table placement (per RESEARCH §Q5 + plan's <deviation_from_D09>):
 *   - exposed_endpoints:    pre-wipe inside persistFindings  (in-transaction)
 *   - actor_connections:    pre-wipe inside persistFindings  (in-transaction)
 *   - node_metadata:        pre-wipe before enrichment loop  (post-bracket)
 *   - service_dependencies: stale sweep after dep-upsert loop (post-bracket)
 *
 * For node_metadata + service_dependencies the plan permits exercising the
 * exact reconcile SQL against a QueryEngine-built DB when direct manager.js
 * invocation is impractical in a unit test.
 *
 * Run: node --test worker/db/query-engine-reconcile.test.js
 *      (from plugins/arcanon/)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDb } from './database.js';
import { QueryEngine } from './query-engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fully-migrated on-disk DB (openDb runs all migrations including
 * 007 exposed_endpoints CASCADE, 008 actors/actor_connections/node_metadata,
 * 010 service_dependencies with scan_version_id).
 */
function makeTestDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcanon-reconcile-'));
  const db = openDb(root);
  return { db, root };
}

/**
 * Minimal service fixture accepted by persistFindings.
 * If `exposes` is provided it must be an array of "METHOD /path" strings
 * (for type:'service') — these populate exposed_endpoints.
 */
function mkSvc(name, exposes = []) {
  return {
    name,
    root_path: name + '/',
    language: 'js',
    type: 'service',
    exposes,
  };
}

/**
 * External actor connection fixture — triggers _upsertActorEdge.
 */
function mkExtConn(sourceName, actorName) {
  return {
    source: sourceName,
    target: actorName,
    protocol: 'rest',
    method: 'POST',
    path: `/call-${actorName}`,
    crossing: 'external',
    source_file: 'index.js',
    target_file: null,
  };
}

// ---------------------------------------------------------------------------
// Test group 1: exposed_endpoints — in-transaction pre-wipe (ISO-08)
// ---------------------------------------------------------------------------

describe('ISO-08: exposed_endpoints pre-wipe in persistFindings', () => {
  let db, qe, repoId;

  before(() => {
    ({ db } = makeTestDb());
    qe = new QueryEngine(db);
    repoId = qe.upsertRepo({ path: '/test/repo-A', name: 'repo-A', type: 'single' });
  });

  after(() => {
    try { db?.close(); } catch { /* ignore */ }
  });

  it('scan N records two endpoints /foo and /bar', () => {
    const sv1 = qe.beginScan(repoId);
    qe.persistFindings(
      repoId,
      { services: [mkSvc('svc-a', ['GET /foo', 'POST /bar'])], connections: [] },
      'sha-001',
      sv1,
    );
    qe.endScan(repoId, sv1);

    const rows = db
      .prepare('SELECT path FROM exposed_endpoints WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?) ORDER BY path')
      .all(repoId);
    assert.equal(rows.length, 2, 'scan N: two endpoints stored');
    assert.deepEqual(rows.map(r => r.path), ['/bar', '/foo'], 'both /bar and /foo present');
  });

  it('scan N+1 with only /foo removes the stale /bar endpoint', () => {
    const sv2 = qe.beginScan(repoId);
    qe.persistFindings(
      repoId,
      { services: [mkSvc('svc-a', ['GET /foo'])], connections: [] },
      'sha-002',
      sv2,
    );
    qe.endScan(repoId, sv2);

    const rows = db
      .prepare('SELECT path FROM exposed_endpoints WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?) ORDER BY path')
      .all(repoId);
    assert.equal(rows.length, 1, 'scan N+1: only one endpoint remains');
    assert.equal(rows[0].path, '/foo', '/foo survives the re-scan');

    const barRow = db
      .prepare("SELECT id FROM exposed_endpoints WHERE path = '/bar'")
      .get();
    assert.equal(barRow, undefined, '/bar is gone after re-scan');
  });
});

// ---------------------------------------------------------------------------
// Test group 2: actor_connections — in-transaction pre-wipe (ISO-08)
// ---------------------------------------------------------------------------

describe('ISO-08: actor_connections pre-wipe in persistFindings', () => {
  let db, qe, repoId;

  before(() => {
    ({ db } = makeTestDb());
    qe = new QueryEngine(db);
    repoId = qe.upsertRepo({ path: '/test/repo-B', name: 'repo-B', type: 'single' });
  });

  after(() => {
    try { db?.close(); } catch { /* ignore */ }
  });

  it('scan N records an actor_connections row for an external actor', () => {
    const sv1 = qe.beginScan(repoId);
    qe.persistFindings(
      repoId,
      { services: [mkSvc('svc-b')], connections: [mkExtConn('svc-b', 'stripe')] },
      'sha-010',
      sv1,
    );
    qe.endScan(repoId, sv1);

    const acRow = db
      .prepare('SELECT ac.id FROM actor_connections ac JOIN actors a ON ac.actor_id = a.id WHERE a.name = ?')
      .get('stripe');
    assert.ok(acRow, 'scan N: actor_connections row for stripe exists');

    const actorRow = db.prepare("SELECT id FROM actors WHERE name = ?").get('stripe');
    assert.ok(actorRow, 'actors row for stripe exists');
  });

  it('scan N+1 without the external actor drops the actor_connections join row, but keeps the actors row', () => {
    const sv2 = qe.beginScan(repoId);
    qe.persistFindings(
      repoId,
      { services: [mkSvc('svc-b')], connections: [] },
      'sha-011',
      sv2,
    );
    qe.endScan(repoId, sv2);

    const acRow = db
      .prepare('SELECT ac.id FROM actor_connections ac JOIN actors a ON ac.actor_id = a.id WHERE a.name = ?')
      .get('stripe');
    assert.equal(acRow, undefined, 'actor_connections join row for stripe is gone after re-scan');

    // The shared actors row must survive — only the join is pre-wiped
    const actorRow = db.prepare("SELECT id FROM actors WHERE name = ?").get('stripe');
    assert.ok(actorRow, 'actors row persists (shared rows are NOT deleted)');
  });
});

// ---------------------------------------------------------------------------
// Test group 3: two-repo isolation for exposed_endpoints + actor_connections
// ---------------------------------------------------------------------------

describe('ISO-08: two-repo isolation — exposed_endpoints and actor_connections', () => {
  let db, qe, repoIdA, repoIdB;

  before(() => {
    ({ db } = makeTestDb());
    qe = new QueryEngine(db);
    repoIdA = qe.upsertRepo({ path: '/test/repo-iso-A', name: 'repo-iso-A', type: 'single' });
    repoIdB = qe.upsertRepo({ path: '/test/repo-iso-B', name: 'repo-iso-B', type: 'single' });
  });

  after(() => {
    try { db?.close(); } catch { /* ignore */ }
  });

  it('scan repo B first — sets up its exposed_endpoints and actor_connections rows', () => {
    const sv = qe.beginScan(repoIdB);
    qe.persistFindings(
      repoIdB,
      {
        services: [mkSvc('svc-b', ['GET /b-endpoint'])],
        connections: [mkExtConn('svc-b', 'external-b')],
      },
      'sha-b1',
      sv,
    );
    qe.endScan(repoIdB, sv);

    const eps = db
      .prepare('SELECT path FROM exposed_endpoints WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?)')
      .all(repoIdB);
    assert.equal(eps.length, 1, 'repo B has 1 exposed endpoint after its scan');

    const acs = db
      .prepare('SELECT ac.id FROM actor_connections ac JOIN services s ON ac.service_id = s.id WHERE s.repo_id = ?')
      .all(repoIdB);
    assert.equal(acs.length, 1, 'repo B has 1 actor_connection after its scan');
  });

  it('scan repo A twice — its pre-wipes leave repo B child rows intact', () => {
    // First scan of repo A
    const sv1 = qe.beginScan(repoIdA);
    qe.persistFindings(
      repoIdA,
      {
        services: [mkSvc('svc-a', ['GET /a-v1', 'POST /a-v1-post'])],
        connections: [mkExtConn('svc-a', 'external-a')],
      },
      'sha-a1',
      sv1,
    );
    qe.endScan(repoIdA, sv1);

    // Second scan of repo A (drops one endpoint and the actor edge)
    const sv2 = qe.beginScan(repoIdA);
    qe.persistFindings(
      repoIdA,
      {
        services: [mkSvc('svc-a', ['GET /a-v2'])],
        connections: [],
      },
      'sha-a2',
      sv2,
    );
    qe.endScan(repoIdA, sv2);

    // Repo A assertions: only the current endpoint survives
    const epsA = db
      .prepare('SELECT path FROM exposed_endpoints WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?)')
      .all(repoIdA);
    assert.equal(epsA.length, 1, 'repo A has 1 endpoint after re-scan');
    assert.equal(epsA[0].path, '/a-v2', 'repo A endpoint is the new /a-v2');

    const acsA = db
      .prepare('SELECT ac.id FROM actor_connections ac JOIN services s ON ac.service_id = s.id WHERE s.repo_id = ?')
      .all(repoIdA);
    assert.equal(acsA.length, 0, 'repo A has 0 actor_connections after re-scan (edge dropped)');

    // Repo B assertions: untouched by repo A's scans
    const epsB = db
      .prepare('SELECT path FROM exposed_endpoints WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?)')
      .all(repoIdB);
    assert.equal(epsB.length, 1, 'repo B exposed_endpoints untouched after repo A re-scan');
    assert.equal(epsB[0].path, '/b-endpoint', 'repo B endpoint /b-endpoint intact');

    const acsB = db
      .prepare('SELECT ac.id FROM actor_connections ac JOIN services s ON ac.service_id = s.id WHERE s.repo_id = ?')
      .all(repoIdB);
    assert.equal(acsB.length, 1, 'repo B actor_connections untouched after repo A re-scan');
  });
});

// ---------------------------------------------------------------------------
// Test group 4: node_metadata pre-wipe SQL (post-bracket, ISO-08, D-09 deviation)
//
// manager.js runs:
//   DELETE FROM node_metadata WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?)
// before the enrichment loop. We exercise this SQL directly against a QE-built
// DB to prove the repo-scoped predicate semantics.
// ---------------------------------------------------------------------------

describe('ISO-08: node_metadata pre-wipe SQL (post-bracket predicate semantics)', () => {
  let db, qe, repoIdA, repoIdB, svcIdA, svcIdB;

  before(() => {
    ({ db } = makeTestDb());
    qe = new QueryEngine(db);
    repoIdA = qe.upsertRepo({ path: '/test/nm-repo-A', name: 'nm-repo-A', type: 'single' });
    repoIdB = qe.upsertRepo({ path: '/test/nm-repo-B', name: 'nm-repo-B', type: 'single' });

    // Seed one service in each repo so we can insert node_metadata rows
    const sv = qe.beginScan(repoIdA);
    qe.persistFindings(repoIdA, { services: [mkSvc('svc-nm-a')], connections: [] }, 'sha-nm-a', sv);
    qe.endScan(repoIdA, sv);

    const svB = qe.beginScan(repoIdB);
    qe.persistFindings(repoIdB, { services: [mkSvc('svc-nm-b')], connections: [] }, 'sha-nm-b', svB);
    qe.endScan(repoIdB, svB);

    svcIdA = db.prepare("SELECT id FROM services WHERE name = ?").get('svc-nm-a').id;
    svcIdB = db.prepare("SELECT id FROM services WHERE name = ?").get('svc-nm-b').id;
  });

  after(() => {
    try { db?.close(); } catch { /* ignore */ }
  });

  it('node_metadata rows exist for both repos before wipe', () => {
    // Simulate enricher writing keys for repo A (scan N keys — one will be stale next scan)
    qe.upsertNodeMetadata(svcIdA, 'ownership', 'owner', 'team-alpha');
    qe.upsertNodeMetadata(svcIdA, 'auth', 'mechanism', 'jwt');
    // Repo B also has a key
    qe.upsertNodeMetadata(svcIdB, 'ownership', 'owner', 'team-beta');

    const rowsA = db.prepare('SELECT * FROM node_metadata WHERE service_id = ?').all(svcIdA);
    const rowsB = db.prepare('SELECT * FROM node_metadata WHERE service_id = ?').all(svcIdB);
    assert.equal(rowsA.length, 2, 'repo A has 2 node_metadata rows before wipe');
    assert.equal(rowsB.length, 1, 'repo B has 1 node_metadata row before wipe');
  });

  it('pre-wipe SQL removes all node_metadata rows for repo A only — repo B untouched', () => {
    // This is exactly what manager.js runs before the enrichment loop
    db.prepare('DELETE FROM node_metadata WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?)')
      .run(repoIdA);

    const rowsA = db.prepare('SELECT * FROM node_metadata WHERE service_id = ?').all(svcIdA);
    const rowsB = db.prepare('SELECT * FROM node_metadata WHERE service_id = ?').all(svcIdB);
    assert.equal(rowsA.length, 0, 'repo A node_metadata fully cleared by pre-wipe');
    assert.equal(rowsB.length, 1, 'repo B node_metadata untouched by repo A pre-wipe');
  });

  it('after enrichers re-write, only current keys remain (no stale keys)', () => {
    // Simulate the post-wipe enrichment re-writing only the current key (not 'auth')
    qe.upsertNodeMetadata(svcIdA, 'ownership', 'owner', 'team-alpha-v2');
    // 'auth'/'mechanism' is intentionally NOT re-written — it was stale

    const rowsA = db.prepare('SELECT view, key, value FROM node_metadata WHERE service_id = ?').all(svcIdA);
    assert.equal(rowsA.length, 1, 'only the re-written key survives (no stale auth key)');
    assert.equal(rowsA[0].key, 'owner', 'surviving key is the re-written owner');
    assert.equal(rowsA[0].value, 'team-alpha-v2', 'value is the fresh enricher value');
  });
});

// ---------------------------------------------------------------------------
// Test group 5: service_dependencies stale sweep SQL (post-bracket, ISO-08, D-09 deviation)
//
// manager.js runs (after the dep-upsert loop):
//   DELETE FROM service_dependencies
//   WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?)
//     AND (scan_version_id != ? OR scan_version_id IS NULL)
// We exercise this SQL directly to prove scan_version_id-aware repo-scoped semantics.
// ---------------------------------------------------------------------------

describe('ISO-08: service_dependencies stale sweep SQL (post-bracket predicate semantics)', () => {
  let db, qe, repoIdA, repoIdB, svcIdA, svcIdB, sv1, sv2;

  before(() => {
    ({ db } = makeTestDb());
    qe = new QueryEngine(db);
    repoIdA = qe.upsertRepo({ path: '/test/sd-repo-A', name: 'sd-repo-A', type: 'single' });
    repoIdB = qe.upsertRepo({ path: '/test/sd-repo-B', name: 'sd-repo-B', type: 'single' });

    // Scan N for repo A — establishes sv1
    sv1 = qe.beginScan(repoIdA);
    qe.persistFindings(repoIdA, { services: [mkSvc('svc-sd-a')], connections: [] }, 'sha-sd-a1', sv1);
    qe.endScan(repoIdA, sv1);
    svcIdA = db.prepare("SELECT id FROM services WHERE name = ?").get('svc-sd-a').id;

    // Scan N for repo B — establishes its own scanVersionId
    const svB = qe.beginScan(repoIdB);
    qe.persistFindings(repoIdB, { services: [mkSvc('svc-sd-b')], connections: [] }, 'sha-sd-b1', svB);
    qe.endScan(repoIdB, svB);
    svcIdB = db.prepare("SELECT id FROM services WHERE name = ?").get('svc-sd-b').id;
  });

  after(() => {
    try { db?.close(); } catch { /* ignore */ }
  });

  it('insert dep rows at sv1 for repo A and a dep for repo B', () => {
    // Simulate dep-collection for repo A scan N
    qe.upsertDependency({
      service_id: svcIdA,
      scan_version_id: sv1,
      ecosystem: 'npm',
      package_name: 'express',
      version_spec: '^4.18.0',
      manifest_file: 'package.json',
    });
    qe.upsertDependency({
      service_id: svcIdA,
      scan_version_id: sv1,
      ecosystem: 'npm',
      package_name: 'lodash',
      version_spec: '^4.17.0',
      manifest_file: 'package.json',
    });
    // Repo B dep
    const svB = db.prepare('SELECT MAX(id) as id FROM scan_versions WHERE repo_id = ?').get(repoIdB).id;
    qe.upsertDependency({
      service_id: svcIdB,
      scan_version_id: svB,
      ecosystem: 'npm',
      package_name: 'axios',
      version_spec: '^1.0.0',
      manifest_file: 'package.json',
    });

    const depsA = db.prepare('SELECT package_name FROM service_dependencies WHERE service_id = ? ORDER BY package_name').all(svcIdA);
    assert.equal(depsA.length, 2, 'repo A has 2 dep rows after scan N dep-collection');
  });

  it('scan N+1 for repo A re-collects only express — lodash becomes stale', () => {
    // Scan N+1 — begin a new scan to get sv2
    sv2 = qe.beginScan(repoIdA);
    qe.persistFindings(repoIdA, { services: [mkSvc('svc-sd-a')], connections: [] }, 'sha-sd-a2', sv2);
    qe.endScan(repoIdA, sv2);

    // Simulate dep-collection re-collecting only express at sv2
    qe.upsertDependency({
      service_id: svcIdA,
      scan_version_id: sv2,
      ecosystem: 'npm',
      package_name: 'express',
      version_spec: '^4.18.2',
      manifest_file: 'package.json',
    });
    // lodash is intentionally NOT re-collected in scan N+1

    // Now run the post-bracket stale sweep (exactly what manager.js runs)
    db.prepare(
      'DELETE FROM service_dependencies WHERE service_id IN (SELECT id FROM services WHERE repo_id = ?) AND (scan_version_id != ? OR scan_version_id IS NULL)'
    ).run(repoIdA, sv2);

    // Only the sv2 express row should survive
    const depsA = db.prepare('SELECT package_name, scan_version_id FROM service_dependencies WHERE service_id = ?').all(svcIdA);
    assert.equal(depsA.length, 1, 'stale lodash row swept — only express at sv2 survives');
    assert.equal(depsA[0].package_name, 'express', 'surviving dep is express');
    assert.equal(depsA[0].scan_version_id, sv2, 'surviving dep has current scan_version_id (sv2)');
  });

  it('stale sweep for repo A leaves repo B dep rows untouched', () => {
    const depsB = db.prepare('SELECT package_name FROM service_dependencies WHERE service_id = ?').all(svcIdB);
    assert.equal(depsB.length, 1, 'repo B dep row (axios) is untouched by repo A stale sweep');
    assert.equal(depsB[0].package_name, 'axios', 'repo B dep is axios');
  });
});
