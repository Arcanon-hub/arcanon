/**
 * worker/db/query-engine.enrichment-log.test.js — Phase 111 Plan 03 (TRUST-06, TRUST-14)
 *
 * Verifies the QueryEngine enrichment-log API landed by Plan 111-03:
 *   - logEnrichment(scanVersionId, enricher, targetKind, targetId, field,
 *     fromValue, toValue, reason) writes a row to enrichment_log and returns
 *     the lastInsertRowid (TRUST-06).
 *   - getEnrichmentLog(scanVersionId, opts?) reads rows for a scan_version,
 *     supports `enricher` filter, and returns [] (not null/error) for an
 *     unknown scan_version_id.
 *   - Sort order: by created_at ASC then id ASC.
 *   - Pre-015 graceful no-op: pre-migration-016 db (table absent) → logEnrichment
 *     returns null without throwing; getEnrichmentLog returns [].
 *   - SQL CHECK constraint on target_kind fires (no JS pre-validation per
 *     CONTEXT D-04).
 *   - FK to scan_versions(id) ON DELETE CASCADE works through the JS API.
 *
 * Run: node --test plugins/arcanon/worker/db/query-engine.enrichment-log.test.js
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
import { up as up016 } from './migrations/016_enrichment_log.js';
import { QueryEngine } from './query-engine.js';

/** Apply migrations 001..015 only (pre-016 baseline, no enrichment_log table). */
function applyMigrationsPre016(db) {
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

/** Apply all migrations through 016 (full head with enrichment_log). */
function applyAllMigrations(db) {
  applyMigrationsPre016(db);
  up016(db);
}

/** Fresh in-memory db at full head + seeded repo + scan_versions row id=1. */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  // Seed scan_versions id=1 for FK referencing inserts.
  const svId = db
    .prepare('INSERT INTO scan_versions (repo_id, started_at) VALUES (?, ?)')
    .run(repoId, '2026-04-25T12:00:00.000Z').lastInsertRowid;
  return { db, repoId, svId };
}

/** Fresh in-memory db at pre-016 head (no enrichment_log table) + seeded repo. */
function freshDbPre016() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrationsPre016(db);
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  const svId = db
    .prepare('INSERT INTO scan_versions (repo_id, started_at) VALUES (?, ?)')
    .run(repoId, '2026-04-25T12:00:00.000Z').lastInsertRowid;
  return { db, repoId, svId };
}

describe('QueryEngine enrichment-log API (Plan 111-03 / TRUST-06, TRUST-14)', () => {
  it('Test 1 — logEnrichment writes a row matching all fields, with created_at populated', () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    const id = qe.logEnrichment(
      svId,
      'reconciliation',
      'connection',
      42,
      'crossing',
      'external',
      'cross-service',
      'target matches known service: auth',
    );
    assert.equal(typeof id, 'number');
    assert.ok(id > 0, 'lastInsertRowid is a positive integer');

    const row = db
      .prepare('SELECT * FROM enrichment_log WHERE id = ?')
      .get(id);
    assert.equal(row.scan_version_id, svId);
    assert.equal(row.enricher, 'reconciliation');
    assert.equal(row.target_kind, 'connection');
    assert.equal(row.target_id, 42);
    assert.equal(row.field, 'crossing');
    assert.equal(row.from_value, 'external');
    assert.equal(row.to_value, 'cross-service');
    assert.equal(row.reason, 'target matches known service: auth');
    assert.ok(row.created_at, 'created_at populated by SQL default');
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('Test 2 — getEnrichmentLog returns inserted row for scan_version_id', () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    qe.logEnrichment(
      svId, 'reconciliation', 'connection', 42, 'crossing',
      'external', 'cross-service', 'target matches known service: auth',
    );
    const rows = qe.getEnrichmentLog(svId);
    assert.ok(Array.isArray(rows), 'returns an array');
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.scan_version_id, svId);
    assert.equal(r.enricher, 'reconciliation');
    assert.equal(r.target_kind, 'connection');
    assert.equal(r.target_id, 42);
    assert.equal(r.field, 'crossing');
    assert.equal(r.from_value, 'external');
    assert.equal(r.to_value, 'cross-service');
    assert.equal(r.reason, 'target matches known service: auth');
    assert.ok(typeof r.created_at === 'string');
    assert.ok(typeof r.id === 'number');
  });

  it('Test 3 — getEnrichmentLog with enricher filter returns only matching rows', () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    qe.logEnrichment(svId, 'reconciliation', 'connection', 1, 'crossing', 'external', 'cross-service', 'r1');
    qe.logEnrichment(svId, 'codeowners', 'service', 5, 'owner', null, '@team-a', 'codeowners file');

    const reconciliationRows = qe.getEnrichmentLog(svId, { enricher: 'reconciliation' });
    assert.equal(reconciliationRows.length, 1);
    assert.equal(reconciliationRows[0].enricher, 'reconciliation');
    assert.equal(reconciliationRows[0].target_id, 1);

    const codeownersRows = qe.getEnrichmentLog(svId, { enricher: 'codeowners' });
    assert.equal(codeownersRows.length, 1);
    assert.equal(codeownersRows[0].enricher, 'codeowners');
    assert.equal(codeownersRows[0].target_id, 5);

    // No filter → both rows.
    const allRows = qe.getEnrichmentLog(svId);
    assert.equal(allRows.length, 2);
  });

  it('Test 4 — getEnrichmentLog returns [] (not null, not error) for unknown scan_version_id', () => {
    const { db } = freshDb();
    const qe = new QueryEngine(db);
    const rows = qe.getEnrichmentLog(99999);
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 0);
    // Also with a filter:
    const filtered = qe.getEnrichmentLog(99999, { enricher: 'reconciliation' });
    assert.ok(Array.isArray(filtered));
    assert.equal(filtered.length, 0);
  });

  it('Test 5 — getEnrichmentLog returns rows in created_at ASC, id ASC order', () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    // Insert 3 rows in sequence. created_at granularity is 1s — id is the
    // tie-breaker that guarantees insertion order.
    const id1 = qe.logEnrichment(svId, 'reconciliation', 'connection', 1, 'crossing', 'external', 'cross-service', 'r1');
    const id2 = qe.logEnrichment(svId, 'reconciliation', 'connection', 2, 'crossing', 'external', 'cross-service', 'r2');
    const id3 = qe.logEnrichment(svId, 'reconciliation', 'connection', 3, 'crossing', 'external', 'cross-service', 'r3');
    const rows = qe.getEnrichmentLog(svId);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].id, id1);
    assert.equal(rows[1].id, id2);
    assert.equal(rows[2].id, id3);
    assert.equal(rows[0].target_id, 1);
    assert.equal(rows[1].target_id, 2);
    assert.equal(rows[2].target_id, 3);
  });

  it('Test 6 — pre-016 db: logEnrichment returns null without throwing; getEnrichmentLog returns []', () => {
    const { db, svId } = freshDbPre016();
    const qe = new QueryEngine(db);
    let result;
    assert.doesNotThrow(() => {
      result = qe.logEnrichment(
        svId, 'reconciliation', 'connection', 1, 'crossing',
        'external', 'cross-service', 'pre-016 no-op',
      );
    });
    assert.equal(result, null, 'logEnrichment is a no-op on pre-016 db (table absent)');
    const rows = qe.getEnrichmentLog(svId);
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 0);
  });

  it('Test 7 — SQL CHECK on target_kind fires for invalid values (no JS pre-validation)', () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    assert.throws(
      () => qe.logEnrichment(svId, 'x', 'invalid', 1, 'f', null, null, null),
      /CHECK|constraint/,
      'SQL CHECK fires on invalid target_kind',
    );
    // And empty string is also rejected by the CHECK.
    assert.throws(
      () => qe.logEnrichment(svId, 'x', '', 1, 'f', null, null, null),
      /CHECK|constraint/,
    );
  });

  it('Test 8 — FK CASCADE on scan_versions DELETE removes audit rows (via JS API)', () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    qe.logEnrichment(svId, 'reconciliation', 'connection', 1, 'crossing', 'external', 'cross-service', 'r');
    qe.logEnrichment(svId, 'reconciliation', 'connection', 2, 'crossing', 'external', 'cross-service', 'r');
    assert.equal(qe.getEnrichmentLog(svId).length, 2);

    db.prepare('DELETE FROM scan_versions WHERE id = ?').run(svId);
    const after = qe.getEnrichmentLog(svId);
    assert.ok(Array.isArray(after));
    assert.equal(after.length, 0, 'CASCADE removed audit rows when parent scan_versions row deleted');
  });
});
