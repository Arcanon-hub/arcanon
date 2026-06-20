/**
 * worker/scan/overrides.test.js —   .
 *
 * Verifies the apply-hook (`applyPendingOverrides`) shipped in
 * `worker/scan/overrides.js`:
 *
 *   - Dispatch matrix routes each (kind, action) to the correct mutator.
 *   - Per-override try/catch: a SqliteError on row N does NOT prevent rows
 *     N+1..M from processing.
 *   Per-override stamp granularity : markOverrideApplied is invoked
 *     after each successful mutation, NOT batched at the end.
 *   Dangling target : UPDATE/DELETE that hits 0 rows logs WARN AND
 *     stamps the row (avoids WARN-loop on every future scan).
 *   - Matrix violation: invalid (kind, action) is logged WARN, NOT applied,
 *     NOT stamped — the operator can fix and retry.
 *   - Malformed JSON payload: caught, logged WARN, NOT stamped.
 *   - Counters: {applied, skipped, errors} reflect each per-override outcome.
 *   - Idempotency: a second invocation with no fresh overrides processes 0
 *     rows (already-stamped are filtered by getPendingOverrides).
 *
 * Run: node --test plugins/arcanon/worker/scan/overrides.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from '../db/sqlite-adapter.js';

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
import { QueryEngine } from '../db/query-engine.js';

import { applyPendingOverrides } from './overrides.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyAllMigrations(db) {
  up001(db); up002(db); up003(db); up004(db); up005(db); up006(db);
  up007(db); up008(db); up009(db); up010(db); up011(db); up013(db);
  up014(db); up015(db); up016(db); up017(db);
}

/**
 * Fresh in-memory db at full head + seeded repo + scan_versions row +
 * 2 services (api id=1, web id=2) + 1 connection (id=1) between them.
 */
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

  const apiId = db.prepare(
    "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, ?, ?, ?)"
  ).run(repoId, 'api', 'services/api', 'javascript').lastInsertRowid;
  const webId = db.prepare(
    "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, ?, ?, ?)"
  ).run(repoId, 'web', 'services/web', 'typescript').lastInsertRowid;

  const connId = db.prepare(
    "INSERT INTO connections (source_service_id, target_service_id, protocol, method, path, evidence) " +
    "VALUES (?, ?, ?, ?, ?, ?)"
  ).run(webId, apiId, 'http', 'GET', '/users', 'fetch("/users")').lastInsertRowid;

  return { db, repoId, svId, apiId, webId, connId };
}

/** Slog stub that records every call into an array. */
function makeSlog() {
  const calls = [];
  const slog = (level, msg, extra = {}) => {
    calls.push({ level, msg, extra });
  };
  return { slog, calls };
}

function warnCount(calls) { return calls.filter((c) => c.level === 'WARN').length; }
function errorCount(calls) { return calls.filter((c) => c.level === 'ERROR').length; }
function infoCount(calls) { return calls.filter((c) => c.level === 'INFO').length; }

function isStamped(db, overrideId) {
  const row = db.prepare(
    'SELECT applied_in_scan_version_id FROM scan_overrides WHERE override_id = ?'
  ).get(overrideId);
  return row && row.applied_in_scan_version_id !== null;
}

// ---------------------------------------------------------------------------
// Dispatch tests — happy path per (kind, action)
// ---------------------------------------------------------------------------

describe('applyPendingOverrides — dispatch matrix happy path', () => {
  it('Test 1 — connection|delete removes the row, stamps, applied++', async () => {
    const { db, svId, connId } = freshDb();
    const qe = new QueryEngine(db);
    const id = qe.upsertOverride({ kind: 'connection', target_id: connId, action: 'delete' });
    const { slog, calls } = makeSlog();

    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 1);
    assert.equal(counters.skipped, 0);
    assert.equal(counters.errors, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM connections WHERE id = ?').get(connId).n,
      0,
      'connection row deleted',
    );
    assert.ok(isStamped(db, id), 'override stamped');
    assert.equal(warnCount(calls), 0, 'no WARN logs');
  });

  it('Test 2 — service|delete removes the row + dependent connections, stamps', async () => {
    const { db, svId, apiId, connId } = freshDb();
    const qe = new QueryEngine(db);
    const id = qe.upsertOverride({ kind: 'service', target_id: apiId, action: 'delete' });
    const { slog, calls } = makeSlog();

    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 1);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM services WHERE id = ?').get(apiId).n,
      0,
      'service row deleted',
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM connections WHERE id = ?').get(connId).n,
      0,
      'dependent connection deleted before service row',
    );
    assert.ok(isStamped(db, id));
    assert.equal(warnCount(calls), 0);
  });

  it('Test 3 — service|rename updates services.name, stamps', async () => {
    const { db, svId, webId } = freshDb();
    const qe = new QueryEngine(db);
    const id = qe.upsertOverride({
      kind: 'service', target_id: webId, action: 'rename',
      payload: { new_name: 'frontend' },
    });
    const { slog, calls } = makeSlog();

    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 1);
    const name = db.prepare('SELECT name FROM services WHERE id = ?').get(webId).name;
    assert.equal(name, 'frontend');
    assert.ok(isStamped(db, id));
    assert.equal(warnCount(calls), 0);
  });

  it('Test 4 — service|set-base-path updates services.base_path, stamps', async () => {
    const { db, svId, apiId } = freshDb();
    const qe = new QueryEngine(db);
    const id = qe.upsertOverride({
      kind: 'service', target_id: apiId, action: 'set-base-path',
      payload: { base_path: '/api/v2' },
    });
    const { slog } = makeSlog();

    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 1);
    const bp = db.prepare('SELECT base_path FROM services WHERE id = ?').get(apiId).base_path;
    assert.equal(bp, '/api/v2');
    assert.ok(isStamped(db, id));
  });

  it('Test 5 — service|set-base-path with empty string clears base_path to NULL', async () => {
    const { db, svId, apiId } = freshDb();
    // Pre-set a base_path so we can observe it being cleared.
    db.prepare('UPDATE services SET base_path = ? WHERE id = ?').run('/old', apiId);
    const qe = new QueryEngine(db);
    const id = qe.upsertOverride({
      kind: 'service', target_id: apiId, action: 'set-base-path',
      payload: { base_path: '' },
    });
    const { slog } = makeSlog();

    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 1);
    const bp = db.prepare('SELECT base_path FROM services WHERE id = ?').get(apiId).base_path;
    assert.equal(bp, null);
    assert.ok(isStamped(db, id));
  });

  it('Test 6 — connection|update updates source/target/evidence columns, stamps', async () => {
    const { db, svId, apiId, webId, connId } = freshDb();
    // Add a third service to swap source onto.
    const otherId = db.prepare(
      "INSERT INTO services (repo_id, name, root_path, language) VALUES (?, ?, ?, ?)"
    ).run(1, 'cli', 'services/cli', 'go').lastInsertRowid;

    const qe = new QueryEngine(db);
    const id = qe.upsertOverride({
      kind: 'connection', target_id: connId, action: 'update',
      payload: {
        source_service_id: otherId,
        target_service_id: apiId,
        evidence: 'corrected by operator',
      },
    });
    const { slog } = makeSlog();

    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 1);
    const row = db.prepare(
      'SELECT source_service_id, target_service_id, evidence FROM connections WHERE id = ?'
    ).get(connId);
    assert.equal(row.source_service_id, otherId);
    assert.equal(row.target_service_id, apiId);
    assert.equal(row.evidence, 'corrected by operator');
    assert.ok(isStamped(db, id));
  });
});

// ---------------------------------------------------------------------------
// Dangling-target / log+skip+stamp 
// ---------------------------------------------------------------------------

describe('applyPendingOverrides — dangling target paths (D-04)', () => {
  it('Test 7 — connection|update with empty payload (no fields) — dangling, stamped, WARN logged', async () => {
    const { db, svId, connId } = freshDb();
    const qe = new QueryEngine(db);
    const id = qe.upsertOverride({
      kind: 'connection', target_id: connId, action: 'update',
      payload: {},
    });
    const { slog, calls } = makeSlog();

    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 1, 'D-04: stamped counts as applied');
    assert.equal(counters.skipped, 0);
    assert.ok(isStamped(db, id), 'D-04: stamped to avoid WARN-loop');
    assert.equal(warnCount(calls), 1, 'one WARN logged');
    const warn = calls.find((c) => c.level === 'WARN');
    assert.match(warn.msg, /target missing/);
  });

  it('Test 8 — service|rename with empty new_name — dangling, stamped, WARN logged', async () => {
    const { db, svId, webId } = freshDb();
    const qe = new QueryEngine(db);
    const id = qe.upsertOverride({
      kind: 'service', target_id: webId, action: 'rename',
      payload: { new_name: '   ' },
    });
    const { slog, calls } = makeSlog();

    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 1);
    assert.ok(isStamped(db, id));
    assert.equal(warnCount(calls), 1);
    // services.name unchanged.
    assert.equal(
      db.prepare('SELECT name FROM services WHERE id = ?').get(webId).name,
      'web',
    );
  });

  it('Test 9 — connection|delete on non-existent target_id — dangling, stamped, WARN logged', async () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    const id = qe.upsertOverride({
      kind: 'connection', target_id: 99999, action: 'delete',
    });
    const { slog, calls } = makeSlog();

    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 1, 'stamped path increments applied');
    assert.ok(isStamped(db, id));
    assert.equal(warnCount(calls), 1);
  });
});

// ---------------------------------------------------------------------------
// Matrix violations + malformed payload — skipped, NOT stamped
// ---------------------------------------------------------------------------

describe('applyPendingOverrides — invalid input paths (skipped, not stamped)', () => {
  it('Test 10 — invalid kind x action (connection|rename) — skipped, NOT stamped, WARN logged', async () => {
    const { db, svId, connId } = freshDb();
    const qe = new QueryEngine(db);
    // Bypass the SQL CHECK: insert directly with a value that passes the
    // CHECK on action (rename is allowed by the CHECK) but fails the
    // dispatch matrix because connection|rename is not a valid combo.
    qe.upsertOverride({
      kind: 'connection', target_id: connId, action: 'rename',
      payload: { new_name: 'whatever' },
    });
    const id = db.prepare(
      'SELECT override_id FROM scan_overrides WHERE kind = ? AND action = ?'
    ).get('connection', 'rename').override_id;

    const { slog, calls } = makeSlog();
    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 0);
    assert.equal(counters.skipped, 1);
    assert.equal(counters.errors, 0);
    assert.ok(!isStamped(db, id), 'NOT stamped — operator can fix + retry');
    assert.equal(warnCount(calls), 1);
    const warn = calls.find((c) => c.level === 'WARN');
    assert.match(warn.msg, /invalid kind x action/);
  });

  it('Test 11 — malformed payload JSON — skipped, NOT stamped, WARN logged', async () => {
    const { db, svId, connId } = freshDb();
    const qe = new QueryEngine(db);
    // Insert a raw row with a deliberately broken JSON payload — bypasses
    // upsertOverride's JSON.stringify guard.
    db.prepare(
      "INSERT INTO scan_overrides (kind, target_id, action, payload) VALUES (?, ?, ?, ?)"
    ).run('connection', connId, 'delete', '{not valid json');
    const id = db.prepare(
      'SELECT override_id FROM scan_overrides WHERE payload = ?'
    ).get('{not valid json').override_id;

    const { slog, calls } = makeSlog();
    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 0);
    assert.equal(counters.skipped, 1);
    assert.equal(counters.errors, 0);
    assert.ok(!isStamped(db, id));
    assert.equal(warnCount(calls), 1);
    const warn = calls.find((c) => c.level === 'WARN');
    assert.match(warn.msg, /not valid JSON/);
  });
});

// ---------------------------------------------------------------------------
// Mid-loop SqliteError isolation
// ---------------------------------------------------------------------------

describe('applyPendingOverrides — error isolation', () => {
  it('Test 12 — SqliteError mid-loop: errors++, override NOT stamped, other overrides still process', async () => {
    const { db, svId, apiId, webId, connId } = freshDb();
    const qe = new QueryEngine(db);

    // Override A: a successful delete.
    const idA = qe.upsertOverride({
      kind: 'connection', target_id: connId, action: 'delete',
    });
    // Override B: a connection|update that will fail due to an FK violation
    // (target_service_id references a service that does not exist).
    const idB = qe.upsertOverride({
      kind: 'connection', target_id: connId, action: 'update',
      payload: { target_service_id: 99999 },
    });
    // Override C: a successful rename on `web`.
    const idC = qe.upsertOverride({
      kind: 'service', target_id: webId, action: 'rename',
      payload: { new_name: 'frontend' },
    });

    // Re-add a connection so override B targets an existing row, and so that
    // its FK violation comes from the bogus target_service_id rather than a
    // missing connection. Override A already deletes connId, so swap order:
    // re-insert the connection AFTER the delete by giving B a fresh target.
    // Simplest: change A to a service rename that succeeds + add another
    // connection so B has a real target_id with a bogus payload FK.
    // Reset and use a cleaner flow:
    db.prepare('DELETE FROM scan_overrides').run();
    db.prepare('DELETE FROM connections').run();
    const conn1 = db.prepare(
      "INSERT INTO connections (source_service_id, target_service_id, protocol, method, path) " +
      "VALUES (?, ?, 'http', 'GET', '/a')"
    ).run(webId, apiId).lastInsertRowid;
    const conn2 = db.prepare(
      "INSERT INTO connections (source_service_id, target_service_id, protocol, method, path) " +
      "VALUES (?, ?, 'http', 'GET', '/b')"
    ).run(webId, apiId).lastInsertRowid;

    const idA2 = qe.upsertOverride({ kind: 'connection', target_id: conn1, action: 'delete' });
    const idB2 = qe.upsertOverride({
      kind: 'connection', target_id: conn2, action: 'update',
      payload: { target_service_id: 99999 },
    });
    const idC2 = qe.upsertOverride({
      kind: 'service', target_id: webId, action: 'rename',
      payload: { new_name: 'frontend' },
    });

    const { slog, calls } = makeSlog();
    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.equal(counters.applied, 2, 'A and C succeed');
    assert.equal(counters.errors, 1, 'B raises FK error');
    assert.equal(counters.skipped, 0);

    assert.ok(isStamped(db, idA2), 'A stamped');
    assert.ok(!isStamped(db, idB2), 'B NOT stamped — pending for retry');
    assert.ok(isStamped(db, idC2), 'C stamped — loop continued past B');

    assert.equal(errorCount(calls), 1);
  });
});

// ---------------------------------------------------------------------------
// Empty + idempotency
// ---------------------------------------------------------------------------

describe('applyPendingOverrides — empty + idempotent', () => {
  it('Test 13 — empty pending list: returns zero counters; single INFO BEGIN + INFO DONE pair; no DB writes', async () => {
    const { db, svId } = freshDb();
    const qe = new QueryEngine(db);
    const beforeServices = db.prepare('SELECT * FROM services').all();
    const beforeConns = db.prepare('SELECT * FROM connections').all();
    const { slog, calls } = makeSlog();

    const counters = await applyPendingOverrides(svId, qe, slog);

    assert.deepEqual(counters, { applied: 0, skipped: 0, errors: 0 });
    assert.deepEqual(db.prepare('SELECT * FROM services').all(), beforeServices);
    assert.deepEqual(db.prepare('SELECT * FROM connections').all(), beforeConns);
    assert.equal(infoCount(calls), 2, 'INFO BEGIN + INFO DONE');
    assert.equal(warnCount(calls), 0);
    assert.equal(errorCount(calls), 0);
  });

  it('Test 14b — defensive guard: queryEngine without helpers is a fast no-op (pre-mig-017 / test-stub contract)', async () => {
    const stubQe = {
      // Mimics the test-stub queryEngine in manager.test.js (and the pre-017
      // QueryEngine where the constructor try/catch left helper statements
      // disabled and the methods absent on the prototype).
      beginScan: () => {},
      persistFindings: () => {},
      endScan: () => {},
    };
    const { slog, calls } = makeSlog();
    const counters = await applyPendingOverrides(1, stubQe, slog);
    assert.deepEqual(counters, { applied: 0, skipped: 0, errors: 0 });
    assert.equal(infoCount(calls), 2, 'INFO BEGIN + INFO DONE');
    assert.equal(warnCount(calls), 0);
    assert.equal(errorCount(calls), 0);
  });

  it('Test 14 — already-applied overrides not re-processed on second invocation', async () => {
    const { db, svId, webId } = freshDb();
    const qe = new QueryEngine(db);
    qe.upsertOverride({
      kind: 'service', target_id: webId, action: 'rename',
      payload: { new_name: 'frontend' },
    });

    const { slog: slog1 } = makeSlog();
    const counters1 = await applyPendingOverrides(svId, qe, slog1);
    assert.equal(counters1.applied, 1);

    // Second invocation: nothing pending.
    const { slog: slog2, calls: calls2 } = makeSlog();
    const counters2 = await applyPendingOverrides(svId, qe, slog2);
    assert.deepEqual(counters2, { applied: 0, skipped: 0, errors: 0 });
    // BEGIN log shows count=0.
    const begin = calls2.find((c) => c.msg === 'overrides apply BEGIN');
    assert.equal(begin.extra.count, 0);
  });
});
