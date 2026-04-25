/**
 * worker/db/query-engine.quality-score.test.js — Phase 111 Plan 02 (TRUST-05, TRUST-13)
 *
 * Verifies the QueryEngine quality-score wiring landed by Plan 111-02:
 *   - endScan() computes quality_score = (high + 0.5 * low) / total and
 *     persists it on the scan_versions row (TRUST-05).
 *   - getQualityScore(scanVersionId) returns the persisted scalar.
 *   - getScanQualityBreakdown(scanVersionId) returns the breakdown object.
 *   - NULL semantics: total == 0 → quality_score IS NULL (D-02).
 *   - confidence IS NULL rows count toward total but contribute 0 to numerator
 *     (D-02 — "agent omissions do not count as 'low'").
 *   - endScan() does NOT throw on a pre-015 db (best-effort).
 *   - Per-scan_version_id scoping — endScan(A) ignores connections from scan B.
 *
 * Run: node --test plugins/arcanon/worker/db/query-engine.quality-score.test.js
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
import { up as up015 } from './migrations/015_scan_versions_quality_score.js';
import { QueryEngine } from './query-engine.js';

/** Apply migrations 001..013 only (pre-015 baseline, no quality_score column) */
function applyMigrationsPre015(db) {
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
}

/** Apply all migrations through 015 (full head with quality_score) */
function applyAllMigrations(db) {
  applyMigrationsPre015(db);
  up015(db);
}

/** Fresh in-memory db at full head + seeded repo */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  return { db, repoId };
}

/** Fresh in-memory db at pre-015 head (no quality_score column) + seeded repo */
function freshDbPre015() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrationsPre015(db);
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  return { db, repoId };
}

/**
 * Helper: seed a service + N connections with the given confidence distribution.
 * Returns { serviceA: id, serviceB: id, scanVersionId }.
 *
 * Counts: { high, low, nullCount } — all connections have source = serviceA,
 * target = serviceB. confidence is set per the requested mix.
 */
function seedScan(qe, repoId, { high = 0, low = 0, nullCount = 0 } = {}) {
  const scanVersionId = qe.beginScan(repoId);
  const serviceA = qe.upsertService({
    repo_id: repoId, name: 'svc-a', root_path: '/tmp/r/a', language: 'js',
    scan_version_id: scanVersionId,
  });
  const serviceB = qe.upsertService({
    repo_id: repoId, name: 'svc-b', root_path: '/tmp/r/b', language: 'js',
    scan_version_id: scanVersionId,
  });
  const insertConn = (confidence, idx) => {
    qe.upsertConnection({
      source_service_id: serviceA,
      target_service_id: serviceB,
      protocol: 'rest',
      method: 'GET',
      path: `/p/${confidence ?? 'null'}/${idx}`,
      scan_version_id: scanVersionId,
      confidence: confidence,
    });
  };
  for (let i = 0; i < high; i++) insertConn('high', i);
  for (let i = 0; i < low; i++) insertConn('low', i);
  for (let i = 0; i < nullCount; i++) insertConn(null, i);
  return { serviceA, serviceB, scanVersionId };
}

describe('QueryEngine quality-score wiring (Plan 111-02 / TRUST-05, TRUST-13)', () => {
  it('Test 1 — mixed (8 high + 2 low) → quality_score === 0.9', () => {
    const { db, repoId } = freshDb();
    const qe = new QueryEngine(db);
    const { scanVersionId } = seedScan(qe, repoId, { high: 8, low: 2 });
    qe.endScan(repoId, scanVersionId);
    const row = db
      .prepare('SELECT quality_score FROM scan_versions WHERE id = ?')
      .get(scanVersionId);
    assert.equal(row.quality_score, 0.9, '(8 + 0.5*2) / 10 === 0.9');
  });

  it('Test 2 — all high (5/0/0) → quality_score === 1.0', () => {
    const { db, repoId } = freshDb();
    const qe = new QueryEngine(db);
    const { scanVersionId } = seedScan(qe, repoId, { high: 5, low: 0 });
    qe.endScan(repoId, scanVersionId);
    const row = db
      .prepare('SELECT quality_score FROM scan_versions WHERE id = ?')
      .get(scanVersionId);
    assert.equal(row.quality_score, 1.0);
  });

  it('Test 3 — all low (0/4/0) → quality_score === 0.5', () => {
    const { db, repoId } = freshDb();
    const qe = new QueryEngine(db);
    const { scanVersionId } = seedScan(qe, repoId, { high: 0, low: 4 });
    qe.endScan(repoId, scanVersionId);
    const row = db
      .prepare('SELECT quality_score FROM scan_versions WHERE id = ?')
      .get(scanVersionId);
    assert.equal(row.quality_score, 0.5);
  });

  it('Test 4 — with NULL confidence (5 high + 2 low + 3 null) → quality_score === 0.6 (NULL contributes 0)', () => {
    const { db, repoId } = freshDb();
    const qe = new QueryEngine(db);
    const { scanVersionId } = seedScan(qe, repoId, { high: 5, low: 2, nullCount: 3 });
    qe.endScan(repoId, scanVersionId);
    const row = db
      .prepare('SELECT quality_score FROM scan_versions WHERE id = ?')
      .get(scanVersionId);
    // (5 + 0.5*2) / 10 = 6 / 10 = 0.6 — NULLs count in total only.
    assert.equal(row.quality_score, 0.6);
  });

  it('Test 4b — code comment documents the NULL-confidence rule verbatim', async () => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'query-engine.js'), 'utf8');
    // The comment must include the lock phrase from CONTEXT D-02.
    const expected =
      "NULL confidence is counted in `total` but contributes 0 to the numerator";
    assert.ok(
      src.includes(expected),
      'query-engine.js must contain the NULL-confidence rule comment verbatim',
    );
    assert.ok(
      src.includes("agent omissions do not count as 'low'"),
      'query-engine.js must explain why agent omissions do not count as low-confidence',
    );
  });

  it('Test 5 — zero connections → quality_score IS NULL', () => {
    const { db, repoId } = freshDb();
    const qe = new QueryEngine(db);
    const scanVersionId = qe.beginScan(repoId);
    // No connections inserted.
    qe.endScan(repoId, scanVersionId);
    const row = db
      .prepare('SELECT quality_score FROM scan_versions WHERE id = ?')
      .get(scanVersionId);
    assert.equal(row.quality_score, null, 'NULL — not 0, not 1.0');
  });

  it('Test 6 — getQualityScore returns persisted value (0.9), and null for zero-connection scan', () => {
    const { db, repoId } = freshDb();
    const qe = new QueryEngine(db);
    // First scan: mixed → 0.9
    const { scanVersionId: svA } = seedScan(qe, repoId, { high: 8, low: 2 });
    qe.endScan(repoId, svA);
    assert.equal(qe.getQualityScore(svA), 0.9);

    // Second scan: zero connections → null
    const svB = qe.beginScan(repoId);
    qe.endScan(repoId, svB);
    assert.equal(qe.getQualityScore(svB), null);
  });

  it('Test 7 — getScanQualityBreakdown returns full shape with prose_evidence_warnings: 0', () => {
    const { db, repoId } = freshDb();
    const qe = new QueryEngine(db);
    const { scanVersionId } = seedScan(qe, repoId, { high: 5, low: 2, nullCount: 3 });
    qe.endScan(repoId, scanVersionId);
    const breakdown = qe.getScanQualityBreakdown(scanVersionId);
    assert.equal(typeof breakdown, 'object');
    assert.equal(breakdown.scan_version_id, scanVersionId);
    assert.equal(breakdown.total, 10);
    assert.equal(breakdown.high, 5);
    assert.equal(breakdown.low, 2);
    assert.equal(breakdown.null_count, 3);
    assert.equal(breakdown.prose_evidence_warnings, 0, 'D-01 placeholder for v0.1.3');
    assert.equal(breakdown.service_count, 2, '2 services upserted in this scan');
    assert.equal(breakdown.quality_score, 0.6);
    assert.ok(typeof breakdown.completed_at === 'string');
  });

  it('Test 8 — endScan does NOT throw on pre-015 db (best-effort write)', () => {
    const { db, repoId } = freshDbPre015();
    const qe = new QueryEngine(db);
    const scanVersionId = qe.beginScan(repoId);
    // Seed minimal scan data. Use the pre-015 path (no quality_score column).
    const serviceId = qe.upsertService({
      repo_id: repoId, name: 'svc-a', root_path: '/tmp/r/a', language: 'js',
      scan_version_id: scanVersionId,
    });
    qe.upsertConnection({
      source_service_id: serviceId,
      target_service_id: serviceId,
      protocol: 'rest', method: 'GET', path: '/x',
      scan_version_id: scanVersionId,
      confidence: 'high',
    });
    // Must NOT throw — quality_score write is best-effort.
    assert.doesNotThrow(() => qe.endScan(repoId, scanVersionId));
    // The bracket close is observable via completed_at.
    const row = db
      .prepare('SELECT completed_at FROM scan_versions WHERE id = ?')
      .get(scanVersionId);
    assert.ok(row.completed_at, 'completed_at must be set even when quality_score column is absent');
    // getQualityScore returns null on a pre-015 db (column absent).
    assert.equal(qe.getQualityScore(scanVersionId), null);
    assert.equal(qe.getScanQualityBreakdown(scanVersionId), null);
  });

  it('Test 9 — quality_score scoped to its own scan_version_id (A vs B)', () => {
    const { db, repoId } = freshDb();
    const qe = new QueryEngine(db);

    // Scan A: 8 high + 2 low (10 total) → expect 0.9
    const { scanVersionId: svA } = seedScan(qe, repoId, { high: 8, low: 2 });
    qe.endScan(repoId, svA);
    const scoreA = qe.getQualityScore(svA);

    // Scan B: 0 high + 5 low (5 total) → expect 0.5
    // Use a separate scanVersionId so the per-scan filter is exercised.
    const svB = qe.beginScan(repoId);
    const serviceA = qe.upsertService({
      repo_id: repoId, name: 'svc-a', root_path: '/tmp/r/a', language: 'js',
      scan_version_id: svB,
    });
    const serviceB = qe.upsertService({
      repo_id: repoId, name: 'svc-b', root_path: '/tmp/r/b', language: 'js',
      scan_version_id: svB,
    });
    for (let i = 0; i < 5; i++) {
      qe.upsertConnection({
        source_service_id: serviceA,
        target_service_id: serviceB,
        protocol: 'rest', method: 'GET', path: `/b/${i}`,
        scan_version_id: svB,
        confidence: 'low',
      });
    }
    qe.endScan(repoId, svB);

    assert.equal(scoreA, 0.9, 'scan A unchanged after scan B writes');
    assert.equal(qe.getQualityScore(svB), 0.5);
    // And re-checking A AFTER B's endScan still reads its own value:
    assert.equal(qe.getQualityScore(svA), 0.9);
  });
});
