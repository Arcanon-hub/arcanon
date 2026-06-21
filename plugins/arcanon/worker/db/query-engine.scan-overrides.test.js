/**
 * worker/db/query-engine.scan-overrides.test.js —  
 * 
 *
 * Verifies the QueryEngine scan-overrides API landed by :
 *   - upsertOverride({kind, target_id, action, payload, created_by}) writes a
 *     row to scan_overrides and returns override_id (lastInsertRowid).
 *   - getPendingOverrides() reads all rows where applied_in_scan_version_id
 *     IS NULL, sorted created_at ASC, override_id ASC.
 *   - markOverrideApplied(overrideId, scanVersionId) stamps the column and
 *     removes the row from the pending set.
 *   - payload is JSON-stringified on write (caller passes plain object).
 *   - created_by defaults to 'system' when omitted.
 *   - Pre-mig-017 graceful no-op: pre-migration-017 db (table absent) →
 *     upsertOverride returns null without throwing, getPendingOverrides
 *     returns [], markOverrideApplied returns null.
 *   - SQL CHECK constraints on kind / action fire (no JS pre-validation).
 *
 * Run: node --test plugins/arcanon/worker/db/query-engine.scan-overrides.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from './sqlite-adapter.js';
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
import { QueryEngine } from './query-engine.js';

/** Apply migrations 001..016 only (pre-017 baseline, no scan_overrides table). */
function applyMigrationsPre017(db) {
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
  up016(db);
}

/** Apply all migrations through 017 (full head with scan_overrides). */
function applyAllMigrations(db) {
  applyMigrationsPre017(db);
  up017(db);
}

/** Fresh in-memory db at full head + seeded repo + scan_versions row. */
function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyAllMigrations(db);
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  const svId = db
    .prepare('INSERT INTO scan_versions (repo_id, started_at) VALUES (?, ?)')
    .run(repoId, '2026-04-25T12:00:00.000Z').lastInsertRowid;
  return { db, repoId, svId };
}

/** Fresh in-memory db at pre-017 head (no scan_overrides table) + seeded repo. */
function freshDbPre017() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrationsPre017(db);
  const repoId = db
    .prepare("INSERT INTO repos (path, name, type) VALUES ('/tmp/r', 'r', 'single')")
    .run().lastInsertRowid;
  const svId = db
    .prepare('INSERT INTO scan_versions (repo_id, started_at) VALUES (?, ?)')
    .run(repoId, '2026-04-25T12:00:00.000Z').lastInsertRowid;
  return { db, repoId, svId };
}

describe('QueryEngine scan-overrides API', () => {
  it('Test 1 — upsertOverride round-trip: insert one of each kind/action; getPendingOverrides returns 4 rows in stable order', () => {
    const { db } = freshDb();
    const qe = new QueryEngine(db);

    const id1 = qe.upsertOverride({
      kind: 'connection', target_id: 1, action: 'delete',
      payload: {}, created_by: 'op1',
    });
    const id2 = qe.upsertOverride({
      kind: 'connection', target_id: 2, action: 'update',
      payload: { method: 'POST' }, created_by: 'op2',
    });
    const id3 = qe.upsertOverride({
      kind: 'service', target_id: 3, action: 'rename',
      payload: { new_name: 'auth-svc' }, created_by: 'op3',
    });
    const id4 = qe.upsertOverride({
      kind: 'service', target_id: 4, action: 'set-base-path',
      payload: { base_path: '/api/v2' }, created_by: 'op4',
    });

    assert.equal(typeof id1, 'number');
    assert.ok(id1 > 0, 'override_id is positive');
    // IDs are AUTOINCREMENT-assigned in insert order.
    assert.ok(id2 > id1, 'id2 > id1');
    assert.ok(id3 > id2, 'id3 > id2');
    assert.ok(id4 > id3, 'id4 > id3');

    const rows = qe.getPendingOverrides();
    assert.equal(rows.length, 4, 'all 4 pending rows returned');
    // Stable order: created_at ASC, override_id ASC. created_at granularity
    // is 1s so within this test the override_id tie-breaker dominates.
    assert.equal(rows[0].override_id, id1);
    assert.equal(rows[1].override_id, id2);
    assert.equal(rows[2].override_id, id3);
    assert.equal(rows[3].override_id, id4);

    // Spot-check shape: row 1.
    assert.equal(rows[0].kind, 'connection');
    assert.equal(rows[0].target_id, 1);
    assert.equal(rows[0].action, 'delete');
    assert.equal(rows[0].created_by, 'op1');
    assert.equal(typeof rows[0].payload, 'string', 'payload returned as raw TEXT (caller JSON.parse)');
    assert.equal(typeof rows[0].created_at, 'string');
  });

  it('Test 2 — payload is JSON-stringified on write (raw SELECT shows JSON text)', () => {
    const { db } = freshDb();
    const qe = new QueryEngine(db);
    qe.upsertOverride({
      kind: 'service', target_id: 7, action: 'rename',
      payload: { new_name: 'foo' },
    });
    const row = db
      .prepare('SELECT payload FROM scan_overrides WHERE target_id = 7')
      .get();
    assert.equal(row.payload, '{"new_name":"foo"}');
  });

  it("Test 2b — payload defaults to '{}' when omitted on the JS call", () => {
    const { db } = freshDb();
    const qe = new QueryEngine(db);
    qe.upsertOverride({ kind: 'connection', target_id: 8, action: 'delete' });
    const row = db
      .prepare('SELECT payload FROM scan_overrides WHERE target_id = 8')
      .get();
    assert.equal(row.payload, '{}');
  });

  it("Test 2c — created_by defaults to 'system' when omitted on the JS call", () => {
    const { db } = freshDb();
    const qe = new QueryEngine(db);
    qe.upsertOverride({ kind: 'connection', target_id: 9, action: 'delete' });
    const row = db
      .prepare('SELECT created_by FROM scan_overrides WHERE target_id = 9')
      .get();
    assert.equal(row.created_by, 'system');
  });

  it('Test 3 — markOverrideApplied stamps the row and removes it from getPendingOverrides', () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    const id1 = qe.upsertOverride({ kind: 'connection', target_id: 1, action: 'delete' });
    const id2 = qe.upsertOverride({ kind: 'connection', target_id: 2, action: 'delete' });
    assert.equal(qe.getPendingOverrides().length, 2);

    const changes = qe.markOverrideApplied(id1, svId);
    assert.equal(changes, 1, 'one row updated');

    const pending = qe.getPendingOverrides();
    assert.equal(pending.length, 1, 'one fewer pending row');
    assert.equal(pending[0].override_id, id2, 'unmarked row is still pending');

    // Verify the stamped row carries the scan_version_id.
    const stamped = db
      .prepare('SELECT applied_in_scan_version_id FROM scan_overrides WHERE override_id = ?')
      .get(id1);
    assert.equal(stamped.applied_in_scan_version_id, svId);
  });

  it('Test 4 — markOverrideApplied returns 0 changes for unknown id (no error)', () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    let result;
    assert.doesNotThrow(() => { result = qe.markOverrideApplied(99999, svId); });
    assert.equal(result, 0, '0 changes for unknown override_id');
  });

  it('Test 5 — pre-mig-017 fallback: helpers no-op cleanly without throwing', () => {
    const { db } = freshDbPre017();
    const qe = new QueryEngine(db);

    let upsertResult, pendingResult, markResult;
    assert.doesNotThrow(() => {
      upsertResult = qe.upsertOverride({
        kind: 'connection', target_id: 1, action: 'delete',
      });
    });
    assert.equal(upsertResult, null, 'upsertOverride returns null on pre-017 db');

    assert.doesNotThrow(() => { pendingResult = qe.getPendingOverrides(); });
    assert.ok(Array.isArray(pendingResult));
    assert.equal(pendingResult.length, 0, 'getPendingOverrides returns [] on pre-017 db');

    assert.doesNotThrow(() => { markResult = qe.markOverrideApplied(1, 1); });
    assert.equal(markResult, null, 'markOverrideApplied returns null on pre-017 db');
  });

  it('Test 6 — SQL CHECK on kind fires for invalid values (no JS pre-validation)', () => {
    const { db } = freshDb();
    const qe = new QueryEngine(db);
    assert.throws(
      () => qe.upsertOverride({ kind: 'nope', target_id: 1, action: 'delete' }),
      /CHECK|constraint/,
      'SQL CHECK fires on invalid kind',
    );
  });

  it('Test 7 — SQL CHECK on action fires for invalid values (no JS pre-validation)', () => {
    const { db } = freshDb();
    const qe = new QueryEngine(db);
    assert.throws(
      () => qe.upsertOverride({ kind: 'connection', target_id: 1, action: 'nope' }),
      /CHECK|constraint/,
      'SQL CHECK fires on invalid action',
    );
  });

  it('Test 8 — applied rows survive FK ON DELETE SET NULL when scan_versions row is deleted', () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    const id1 = qe.upsertOverride({ kind: 'connection', target_id: 1, action: 'delete' });
    qe.markOverrideApplied(id1, svId);

    // Delete the parent scan_versions row.
    db.prepare('DELETE FROM scan_versions WHERE id = ?').run(svId);

    // Override row still exists (no CASCADE), and applied_in_scan_version_id
    // is now NULL — which means it re-enters the pending set.
    const row = db
      .prepare('SELECT applied_in_scan_version_id FROM scan_overrides WHERE override_id = ?')
      .get(id1);
    assert.ok(row, 'override row still exists after parent scan_versions deletion');
    assert.equal(row.applied_in_scan_version_id, null, 'applied_in_scan_version_id reset to NULL');

    // Re-enters the pending set.
    const pending = qe.getPendingOverrides();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].override_id, id1);
  });
});
