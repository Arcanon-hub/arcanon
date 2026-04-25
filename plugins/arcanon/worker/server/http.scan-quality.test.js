/**
 * worker/server/http.scan-quality.test.js — Phase 111 Plan 02 (TRUST-05, D-05)
 *
 * Verifies the GET /api/scan-quality endpoint:
 *   - 200 + breakdown shape on a populated DB
 *   - "Latest scan" selection (most recent completed_at wins)
 *   - 503 on no scan data
 *   - 404 on a project that cannot be resolved (resolveQueryEngine → null)
 *   - Honors ?project= param via the existing resolveQueryEngine path
 *
 * The endpoint contract is locked in CONTEXT.md D-05:
 *   {
 *     scan_version_id, completed_at, quality_score, total_connections,
 *     high_confidence, low_confidence, null_confidence,
 *     prose_evidence_warnings, service_count
 *   }
 *
 * Run: node --test plugins/arcanon/worker/server/http.scan-quality.test.js
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
 * the given confidence). Returns { db, qe, scanVersionId }.
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
  // Pass null as the static query engine; rely on resolveQueryEngine for the
  // ?project= param path. Port 0 = inject-only (no real listen).
  return await createHttpServer(null, {
    port: 0,
    resolveQueryEngine: resolveFn,
  });
}

// ---------------------------------------------------------------------------
// Test 1 — 200 latest scan with the documented contract shape
// ---------------------------------------------------------------------------

test('GET /api/scan-quality — 200 with breakdown shape (D-05)', async () => {
  // Mix: 38 high + 9 low + 0 null = 47 total → quality_score = (38 + 4.5) / 47 ≈ 0.9043
  // We force 12 services and pick connection counts to match the contract example.
  const conns = [];
  for (let i = 0; i < 38; i++) conns.push({ confidence: 'high' });
  for (let i = 0; i < 9; i++) conns.push({ confidence: 'low' });
  const { qe } = buildPopulatedDb({ serviceCount: 12, connections: conns });

  const server = await makeServer(() => qe);
  const res = await server.inject({
    method: 'GET',
    url: '/api/scan-quality?project=/tmp/test-repo',
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);

  assert.equal(typeof body.scan_version_id, 'number');
  assert.equal(typeof body.completed_at, 'string');
  // Quality score ≈ 0.9043; allow tiny floating-point delta.
  assert.ok(Math.abs(body.quality_score - 0.9042553191489362) < 1e-6,
    `quality_score=${body.quality_score}`);
  assert.equal(body.total_connections, 47);
  assert.equal(body.high_confidence, 38);
  assert.equal(body.low_confidence, 9);
  assert.equal(body.null_confidence, 0);
  assert.equal(body.prose_evidence_warnings, 0, 'D-01 placeholder for v0.1.3');
  assert.equal(body.service_count, 12);

  await server.close();
});

// ---------------------------------------------------------------------------
// Test 2 — Latest selection — newer scan wins
// ---------------------------------------------------------------------------

test('GET /api/scan-quality — picks latest scan when multiple exist', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const qe = new QueryEngine(db);

  const repoId = qe.upsertRepo({
    path: '/tmp/test-repo',
    name: 'test-repo',
    type: 'single',
  });

  // Scan 1: 5 high → score 1.0
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

  // Scan 2: 4 low → score 0.5. completed_at must be strictly later than sv1.
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

  // Force sv2 to have a strictly-later completed_at to make the test
  // independent of timer resolution.
  db.prepare("UPDATE scan_versions SET completed_at = '2026-04-25T12:00:00Z' WHERE id = ?").run(sv1);
  db.prepare("UPDATE scan_versions SET completed_at = '2026-04-25T13:00:00Z' WHERE id = ?").run(sv2);

  const server = await makeServer(() => qe);
  const res = await server.inject({
    method: 'GET',
    url: '/api/scan-quality?project=/tmp/test-repo',
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.payload);
  assert.equal(body.scan_version_id, sv2, 'must select the newer scan');
  assert.equal(body.quality_score, 0.5);
  assert.equal(body.total_connections, 4);

  await server.close();
});

// ---------------------------------------------------------------------------
// Test 3 — 503 when DB has no scan_versions rows
// ---------------------------------------------------------------------------

test('GET /api/scan-quality — 503 no_scan_data on empty db', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const qe = new QueryEngine(db);

  const server = await makeServer(() => qe);
  const res = await server.inject({
    method: 'GET',
    url: '/api/scan-quality?project=/tmp/empty-repo',
  });
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.payload);
  assert.equal(body.error, 'no_scan_data');
  await server.close();
});

// ---------------------------------------------------------------------------
// Test 4 — 404 when project cannot be resolved (resolver returns null)
// ---------------------------------------------------------------------------

test('GET /api/scan-quality — 404 project_not_found when project param fails to resolve', async () => {
  // resolver always returns null; this simulates "project not indexed"
  const server = await makeServer(() => null);
  const res = await server.inject({
    method: 'GET',
    url: '/api/scan-quality?project=/nonexistent/path',
  });
  assert.equal(res.statusCode, 404);
  const body = JSON.parse(res.payload);
  assert.equal(body.error, 'project_not_found');
  await server.close();
});

// ---------------------------------------------------------------------------
// Test 5 — ?project= param resolution dispatches to the right QE
// ---------------------------------------------------------------------------

test('GET /api/scan-quality — ?project= param routes to the matching QueryEngine', async () => {
  // Two projects: one populated, one empty. Resolver returns the right QE
  // based on the ?project= query.
  const repoA = '/tmp/repo-a';
  const repoB = '/tmp/repo-b';

  const populated = (() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyAllMigrations(db);
    const qe = new QueryEngine(db);
    const repoId = qe.upsertRepo({ path: repoA, name: 'a', type: 'single' });
    const sv = qe.beginScan(repoId);
    const svc = qe.upsertService({
      repo_id: repoId, name: 'svc', root_path: repoA, language: 'js', scan_version_id: sv,
    });
    qe.upsertConnection({
      source_service_id: svc, target_service_id: svc,
      protocol: 'rest', method: 'GET', path: '/x',
      scan_version_id: sv, confidence: 'high',
    });
    qe.endScan(repoId, sv);
    return qe;
  })();

  const empty = (() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyAllMigrations(db);
    return new QueryEngine(db);
  })();

  const resolver = (project) => {
    if (project === repoA) return populated;
    if (project === repoB) return empty;
    return null;
  };

  const server = await makeServer(resolver);

  // Hit project A → 200 with quality_score = 1.0 (one high-confidence conn)
  let res = await server.inject({ method: 'GET', url: `/api/scan-quality?project=${encodeURIComponent(repoA)}` });
  assert.equal(res.statusCode, 200);
  let body = JSON.parse(res.payload);
  assert.equal(body.quality_score, 1.0);
  assert.equal(body.total_connections, 1);

  // Hit project B → 503 no_scan_data (empty db)
  res = await server.inject({ method: 'GET', url: `/api/scan-quality?project=${encodeURIComponent(repoB)}` });
  assert.equal(res.statusCode, 503);
  body = JSON.parse(res.payload);
  assert.equal(body.error, 'no_scan_data');

  // Unknown project → 404 project_not_found
  res = await server.inject({ method: 'GET', url: '/api/scan-quality?project=/nope' });
  assert.equal(res.statusCode, 404);
  body = JSON.parse(res.payload);
  assert.equal(body.error, 'project_not_found');

  await server.close();
});
