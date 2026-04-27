/**
 * worker/server/http.scan-freshness.test.js — Phase 116 Plan 02 (FRESH-03)
 *
 * Verifies the new GET /api/scan-freshness endpoint:
 *   - 200 + documented shape on a populated DB
 *   - "Latest scan" selection (most recent completed_at wins)
 *   - 503 on no scan data
 *   - 404 on a project that cannot be resolved
 *   - Per-repo `last_scanned_sha` is surfaced when repo_state is populated
 *
 * Mirrors http.scan-quality.test.js. Helpers (applyAllMigrations,
 * buildPopulatedDb, makeServer) are copied verbatim per the codebase's
 * tolerance for test-file copy (preferred over a shared helper extract).
 *
 * The endpoint contract is documented in the route handler:
 *   {
 *     last_scan_iso,             // string ISO-8601 UTC
 *     last_scan_age_seconds,     // number >= 0
 *     scan_quality_pct,          // number 0-100 | null
 *     repos: [{ name, path, last_scanned_sha, new_commits }]
 *   }
 *
 * Run: node --test plugins/arcanon/worker/server/http.scan-freshness.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHttpServer } from './http.js';
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
import { QueryEngine } from '../db/query-engine.js';

function applyAllMigrations(db) {
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
  up013(db);
  up014(db);
  up015(db);
}

/**
 * Build a fully-migrated in-memory db with a populated scan: one repo,
 * `serviceCount` services, and `connections` connections (each annotated with
 * the given confidence). Returns { db, qe, scanVersionId, repoId }.
 */
function buildPopulatedDb({ serviceCount = 12, connections = [] } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const qe = new QueryEngine(db);

  const repoId = qe.upsertRepo({
    path: '/tmp/test-repo',
    name: 'test-repo',
    type: 'single',
  });
  const scanVersionId = qe.beginScan(repoId);

  const serviceIds = [];
  for (let i = 0; i < serviceCount; i++) {
    serviceIds.push(
      qe.upsertService({
        repo_id: repoId,
        name: `svc-${i}`,
        root_path: `/tmp/test-repo/svc-${i}`,
        language: 'js',
        scan_version_id: scanVersionId,
      }),
    );
  }

  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i];
    qe.upsertConnection({
      source_service_id: serviceIds[i % serviceIds.length],
      target_service_id: serviceIds[(i + 1) % serviceIds.length],
      protocol: 'rest',
      method: 'GET',
      path: `/p/${i}`,
      scan_version_id: scanVersionId,
      confidence: conn.confidence,
    });
  }

  qe.endScan(repoId, scanVersionId);
  return { db, qe, scanVersionId, repoId };
}

async function makeServer(resolveFn) {
  return await createHttpServer(null, {
    port: 0,
    resolveQueryEngine: resolveFn,
  });
}

// ---------------------------------------------------------------------------
// Test 1 — 200 with shape (FRESH-03)
// ---------------------------------------------------------------------------

test('GET /api/scan-freshness — 200 with shape (FRESH-03)', async () => {
  // Mix matches http.scan-quality.test.js Test 1: 38 high + 9 low → 0.9043 → 90.
  const conns = [];
  for (let i = 0; i < 38; i++) conns.push({ confidence: 'high' });
  for (let i = 0; i < 9; i++) conns.push({ confidence: 'low' });
  const { qe } = buildPopulatedDb({ serviceCount: 12, connections: conns });
  const server = await makeServer(() => qe);

  const res = await server.inject({
    method: 'GET',
    url: '/api/scan-freshness?project=/tmp/test-repo',
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);

  assert.equal(typeof body.last_scan_iso, 'string');
  // Tolerate both 'YYYY-MM-DDTHH:MM:SSZ' (normalized) and 'YYYY-MM-DDTHH:MM:SS.sssZ' (Date.toISOString()).
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(body.last_scan_iso),
    `last_scan_iso=${body.last_scan_iso}`);
  assert.equal(typeof body.last_scan_age_seconds, 'number');
  assert.ok(body.last_scan_age_seconds >= 0);
  assert.equal(body.scan_quality_pct, 90); // round(0.9043 * 100) = 90
  assert.ok(Array.isArray(body.repos));
  assert.equal(body.repos.length, 1);
  assert.equal(body.repos[0].name, 'test-repo');
  assert.equal(body.repos[0].path, '/tmp/test-repo');
  // No repo_state row was seeded; no real git repo on disk → both null.
  assert.equal(body.repos[0].last_scanned_sha, null);
  assert.equal(body.repos[0].new_commits, null);

  await server.close();
});

// ---------------------------------------------------------------------------
// Test 2 — 503 on empty db
// ---------------------------------------------------------------------------

test('GET /api/scan-freshness — 503 no_scan_data on empty db', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const qe = new QueryEngine(db);
  const server = await makeServer(() => qe);
  const res = await server.inject({
    method: 'GET',
    url: '/api/scan-freshness?project=/tmp/test-repo',
  });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(JSON.parse(res.payload), { error: 'no_scan_data' });
  await server.close();
});

// ---------------------------------------------------------------------------
// Test 3 — 404 project_not_found when resolver returns null
// ---------------------------------------------------------------------------

test('GET /api/scan-freshness — 404 project_not_found when resolver returns null', async () => {
  const server = await makeServer(() => null);
  const res = await server.inject({
    method: 'GET',
    url: '/api/scan-freshness?project=/tmp/does-not-exist',
  });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(JSON.parse(res.payload), { error: 'project_not_found' });
  await server.close();
});

// ---------------------------------------------------------------------------
// Test 4 — picks latest scan when multiple exist
// ---------------------------------------------------------------------------

test('GET /api/scan-freshness — picks latest scan when multiple exist', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const qe = new QueryEngine(db);

  const repoId = qe.upsertRepo({
    path: '/tmp/test-repo',
    name: 'test-repo',
    type: 'single',
  });

  // Scan 1 — older
  const sv1 = qe.beginScan(repoId);
  const svcA = qe.upsertService({
    repo_id: repoId, name: 'a', root_path: '/tmp/test-repo/a', language: 'js',
    scan_version_id: sv1,
  });
  const svcB = qe.upsertService({
    repo_id: repoId, name: 'b', root_path: '/tmp/test-repo/b', language: 'js',
    scan_version_id: sv1,
  });
  for (let i = 0; i < 5; i++) {
    qe.upsertConnection({
      source_service_id: svcA, target_service_id: svcB,
      protocol: 'rest', method: 'GET', path: `/old/${i}`,
      scan_version_id: sv1, confidence: 'high',
    });
  }
  qe.endScan(repoId, sv1);

  // Scan 2 — newer
  const sv2 = qe.beginScan(repoId);
  const svcC = qe.upsertService({
    repo_id: repoId, name: 'c', root_path: '/tmp/test-repo/c', language: 'js',
    scan_version_id: sv2,
  });
  const svcD = qe.upsertService({
    repo_id: repoId, name: 'd', root_path: '/tmp/test-repo/d', language: 'js',
    scan_version_id: sv2,
  });
  for (let i = 0; i < 4; i++) {
    qe.upsertConnection({
      source_service_id: svcC, target_service_id: svcD,
      protocol: 'rest', method: 'GET', path: `/new/${i}`,
      scan_version_id: sv2, confidence: 'low',
    });
  }
  qe.endScan(repoId, sv2);

  // Force completed_at ordering independent of timer resolution.
  db.prepare("UPDATE scan_versions SET completed_at = '2026-04-25T12:00:00Z' WHERE id = ?").run(sv1);
  db.prepare("UPDATE scan_versions SET completed_at = '2026-04-25T13:00:00Z' WHERE id = ?").run(sv2);

  const server = await makeServer(() => qe);
  const res = await server.inject({
    method: 'GET',
    url: '/api/scan-freshness?project=/tmp/test-repo',
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  // Newer scan: 4 low → quality_score = 0.5 → 50%
  assert.equal(body.scan_quality_pct, 50, 'must reflect the newer scan');
  // ISO equals the forced timestamp on sv2 (already has 'T' so normalizer is a no-op).
  assert.equal(body.last_scan_iso, '2026-04-25T13:00:00Z');

  await server.close();
});

// ---------------------------------------------------------------------------
// Test 5 — repos array surfaces last_scanned_sha when repo_state populated
// ---------------------------------------------------------------------------

test('GET /api/scan-freshness — repos array surfaces last_scanned_sha when repo_state populated', async () => {
  const { qe, repoId } = buildPopulatedDb({ serviceCount: 1, connections: [] });
  qe.setRepoState(repoId, 'abc1234567890abcdef1234567890abcdef1234');
  const server = await makeServer(() => qe);
  const res = await server.inject({
    method: 'GET',
    url: '/api/scan-freshness?project=/tmp/test-repo',
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.repos[0].last_scanned_sha, 'abc1234567890abcdef1234567890abcdef1234');
  // Path doesn't exist on disk → new_commits null (distinct from 0).
  assert.equal(body.repos[0].new_commits, null);
  await server.close();
});
